const {
  PHASES, WORD_LIMITS, ROUND_TIMERS, VOTE_TIMER,
  ROUNDS_PER_SET, SETS_PER_GAME, RESULTS_PAUSE,
  SET_SCORES_PAUSE, MATCHUP_RESULTS_PAUSE
} = require('../shared/constants');
const { createPromptPool, pickPrompts } = require('./prompts');
const { createMatchups, recordOpponents } = require('./matchmaking');
const { scoreMatchup } = require('./scoring');

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function createRoom(hostSocketId) {
  const code = generateRoomCode();
  const room = {
    code,
    phase: PHASES.LOBBY,
    host: hostSocketId,
    players: [],
    settings: {
      setsPerGame: SETS_PER_GAME,
      roundsPerSet: ROUNDS_PER_SET,
      wordLimits: [...WORD_LIMITS],
      timers: [...ROUND_TIMERS],
      voteTimer: VOTE_TIMER
    },
    currentSet: 0,
    currentRound: 0,
    matchups: [],
    promptPool: createPromptPool(),
    opponentHistory: {},
    timerInterval: null,
    currentMatchupIndex: 0
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.host === socketId) return room;
    if (room.players.some(p => p.id === socketId)) return room;
  }
  return null;
}

function destroyRoom(code) {
  const room = rooms.get(code);
  if (room && room.timerInterval) clearInterval(room.timerInterval);
  rooms.delete(code);
}

function addPlayer(room, socketId, name) {
  if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: 'Name already taken' };
  }
  if (!name || !name.trim()) {
    return { ok: false, reason: 'Name cannot be blank' };
  }
  room.players.push({
    id: socketId,
    name: name.trim().substring(0, 16),
    score: 0,
    connected: true,
    currentAnswer: null,
    hasSubmitted: false
  });
  return { ok: true };
}

function removePlayer(room, socketId) {
  room.players = room.players.filter(p => p.id !== socketId);
}

function getPlayerList(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, score: p.score }));
}

function getStandings(room) {
  return room.players
    .map(p => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function startGame(room, io) {
  if (room.players.length < 2) return false;
  room.currentSet = 0;
  room.currentRound = 0;
  room.opponentHistory = {};
  room.promptPool = createPromptPool();
  for (const p of room.players) p.score = 0;
  startRound(room, io);
  return true;
}

function startRound(room, io) {
  room.phase = PHASES.PROMPT_WRITE;
  const roundIndex = room.currentRound;
  const wordLimit = room.settings.wordLimits[roundIndex];
  const timer = room.settings.timers[roundIndex];

  for (const p of room.players) {
    p.currentAnswer = null;
    p.hasSubmitted = false;
  }

  const activeIds = room.players.map(p => p.id);
  const groups = createMatchups(activeIds, room.opponentHistory);
  recordOpponents(groups, room.opponentHistory);

  const prompts = pickPrompts(room.promptPool, groups.length);
  room.matchups = groups.map((playerIds, i) => ({
    id: `m_${room.currentSet}_${room.currentRound}_${i}`,
    prompt: prompts[i],
    playerIds,
    answers: {},
    votes: {},
    revealed: false
  }));

  io.to(room.code + ':host').emit('round_start', {
    roundNum: roundIndex + 1,
    setNum: room.currentSet + 1,
    wordLimit,
    timer,
    totalPlayers: room.players.length
  });

  for (const matchup of room.matchups) {
    for (const pid of matchup.playerIds) {
      io.to(pid).emit('round_start', {
        roundNum: roundIndex + 1,
        setNum: room.currentSet + 1,
        wordLimit,
        prompt: matchup.prompt,
        timer
      });
    }
  }

  startTimer(room, io, timer, () => {
    for (const matchup of room.matchups) {
      for (const pid of matchup.playerIds) {
        if (!matchup.answers[pid]) {
          matchup.answers[pid] = '(No answer submitted)';
          const player = room.players.find(p => p.id === pid);
          if (player) player.hasSubmitted = true;
        }
      }
    }
    beginVoting(room, io);
  });
}

function submitAnswer(room, socketId, text, io) {
  if (room.phase !== PHASES.PROMPT_WRITE) return { ok: false, reason: 'Not in writing phase' };

  const matchup = room.matchups.find(m => m.playerIds.includes(socketId));
  if (!matchup) return { ok: false, reason: 'Not in a matchup' };

  const player = room.players.find(p => p.id === socketId);
  if (!player || player.hasSubmitted) return { ok: false, reason: 'Already submitted' };

  const wordLimit = room.settings.wordLimits[room.currentRound];
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'Answer cannot be blank' };
  if (countWords(trimmed) > wordLimit) return { ok: false, reason: 'Over word limit' };

  matchup.answers[socketId] = trimmed;
  player.hasSubmitted = true;
  player.currentAnswer = trimmed;

  const submittedCount = room.players.filter(p => p.hasSubmitted).length;
  io.to(room.code + ':host').emit('submission_update', {
    submitted: submittedCount,
    total: room.players.length
  });

  const allSubmitted = room.matchups.every(m =>
    m.playerIds.every(pid => m.answers[pid])
  );
  if (allSubmitted) {
    clearTimer(room);
    beginVoting(room, io);
  }

  return { ok: true };
}

function beginVoting(room, io) {
  room.phase = PHASES.MATCHUP_VOTE;
  room.currentMatchupIndex = 0;
  showNextMatchup(room, io);
}

function showNextMatchup(room, io) {
  const idx = room.currentMatchupIndex;
  if (idx >= room.matchups.length) {
    showRoundResults(room, io);
    return;
  }

  const matchup = room.matchups[idx];
  const answers = matchup.playerIds.map(pid => matchup.answers[pid] || '(No answer submitted)');

  io.to(room.code + ':host').emit('matchup_show', {
    matchupId: matchup.id,
    prompt: matchup.prompt,
    answers,
    timer: room.settings.voteTimer,
    matchupIndex: idx,
    totalMatchups: room.matchups.length
  });

  for (const p of room.players) {
    const inMatchup = matchup.playerIds.includes(p.id);
    io.to(p.id).emit('matchup_show', {
      matchupId: matchup.id,
      prompt: matchup.prompt,
      answers,
      timer: room.settings.voteTimer,
      canVote: !inMatchup,
      matchupIndex: idx,
      totalMatchups: room.matchups.length
    });
  }

  startTimer(room, io, room.settings.voteTimer, () => {
    revealMatchupResult(room, io);
  });
}

function submitVote(room, socketId, matchupId, choice) {
  if (room.phase !== PHASES.MATCHUP_VOTE) return { ok: false, reason: 'Not in voting phase' };

  const matchup = room.matchups.find(m => m.id === matchupId);
  if (!matchup) return { ok: false, reason: 'Invalid matchup' };
  if (matchup.playerIds.includes(socketId)) return { ok: false, reason: 'Cannot vote on own matchup' };
  if (choice < 0 || choice >= matchup.playerIds.length) return { ok: false, reason: 'Invalid choice' };
  if (matchup.votes[socketId] !== undefined) return { ok: false, reason: 'Already voted' };

  matchup.votes[socketId] = choice;
  return { ok: true };
}

function revealMatchupResult(room, io) {
  clearTimer(room);
  const matchup = room.matchups[room.currentMatchupIndex];
  const isFinalRound = room.currentRound === ROUNDS_PER_SET - 1;
  const { scores, voteCounts, totalVotes } = scoreMatchup(matchup, isFinalRound);

  for (const [pid, pts] of Object.entries(scores)) {
    const player = room.players.find(p => p.id === pid);
    if (player) player.score += pts;
  }

  const playerNames = {};
  for (const pid of matchup.playerIds) {
    const player = room.players.find(p => p.id === pid);
    playerNames[pid] = player ? player.name : 'Unknown';
  }

  const resultPayload = {
    matchupId: matchup.id,
    prompt: matchup.prompt,
    answers: matchup.playerIds.map(pid => matchup.answers[pid] || '(No answer submitted)'),
    playerNames: matchup.playerIds.map(pid => playerNames[pid]),
    voteCounts,
    totalVotes,
    scores: matchup.playerIds.map(pid => scores[pid] || 0),
    isFinalRound,
    standings: getStandings(room)
  };

  io.to(room.code + ':host').emit('matchup_result', resultPayload);
  for (const p of room.players) {
    io.to(p.id).emit('matchup_result', resultPayload);
  }

  matchup.revealed = true;

  setTimeout(() => {
    room.currentMatchupIndex++;
    showNextMatchup(room, io);
  }, MATCHUP_RESULTS_PAUSE);
}

function showRoundResults(room, io) {
  room.phase = PHASES.MATCHUP_RESULTS;
  const standings = getStandings(room);

  io.to(room.code + ':host').emit('round_end', {
    roundNum: room.currentRound + 1,
    setNum: room.currentSet + 1,
    standings
  });
  for (const p of room.players) {
    io.to(p.id).emit('round_end', {
      roundNum: room.currentRound + 1,
      setNum: room.currentSet + 1,
      standings
    });
  }

  setTimeout(() => {
    room.currentRound++;
    if (room.currentRound < ROUNDS_PER_SET) {
      startRound(room, io);
    } else {
      showSetScores(room, io);
    }
  }, RESULTS_PAUSE);
}

function showSetScores(room, io) {
  room.phase = PHASES.SET_SCORES;
  const standings = getStandings(room);

  io.to(room.code + ':host').emit('set_end', {
    setNum: room.currentSet + 1,
    standings
  });
  for (const p of room.players) {
    io.to(p.id).emit('set_end', {
      setNum: room.currentSet + 1,
      standings,
      yourScore: p.score
    });
  }

  setTimeout(() => {
    room.currentSet++;
    if (room.currentSet < room.settings.setsPerGame) {
      room.currentRound = 0;
      room.opponentHistory = {};
      startRound(room, io);
    } else {
      showFinalScores(room, io);
    }
  }, SET_SCORES_PAUSE);
}

function showFinalScores(room, io) {
  room.phase = PHASES.FINAL_SCORES;
  const standings = getStandings(room);

  io.to(room.code + ':host').emit('game_end', { finalStandings: standings });
  for (const p of room.players) {
    io.to(p.id).emit('game_end', {
      finalStandings: standings,
      yourScore: p.score
    });
  }
}

function playAgain(room, io) {
  room.phase = PHASES.LOBBY;
  room.currentSet = 0;
  room.currentRound = 0;
  room.matchups = [];
  room.opponentHistory = {};
  room.promptPool = createPromptPool();
  clearTimer(room);
  for (const p of room.players) {
    p.score = 0;
    p.currentAnswer = null;
    p.hasSubmitted = false;
  }
  const players = getPlayerList(room);
  io.to(room.code + ':host').emit('return_to_lobby', { players });
  for (const p of room.players) {
    io.to(p.id).emit('return_to_lobby', { players });
  }
}

function startTimer(room, io, seconds, onExpire) {
  clearTimer(room);
  let remaining = seconds;

  const tick = () => {
    io.to(room.code + ':host').emit('time_update', { secondsLeft: remaining });
    for (const p of room.players) {
      io.to(p.id).emit('time_update', { secondsLeft: remaining });
    }
    if (remaining <= 0) {
      clearTimer(room);
      onExpire();
      return;
    }
    remaining--;
  };

  tick();
  room.timerInterval = setInterval(tick, 1000);
}

function clearTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
}

module.exports = {
  rooms, createRoom, getRoom, getRoomBySocket, destroyRoom,
  addPlayer, removePlayer, getPlayerList, getStandings,
  startGame, submitAnswer, submitVote, playAgain
};
