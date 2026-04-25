const socket = io();
let roomCode = '';

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderStandings(container, standings) {
  container.innerHTML = standings.map((p, i) =>
    `<div class="standing-row${i < 3 ? ' top-three' : ''}">
      <span class="standing-rank">${i + 1}</span>
      <span class="standing-name">${esc(p.name)}</span>
      <span class="standing-score">${p.score.toLocaleString()}</span>
    </div>`
  ).join('');
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

socket.emit('create_room');

socket.on('room_created', ({ code }) => {
  roomCode = code;
  const loc = window.location;
  const joinUrl = `${loc.hostname}${loc.port ? ':' + loc.port : ''}/play`;
  document.getElementById('lobby-code').textContent = code;
  document.getElementById('lobby-room-code-badge').textContent = code;
  document.getElementById('join-url').textContent = joinUrl;
  setRoomBadges(code);
  showScreen('screen-lobby');
});

function setRoomBadges(code) {
  document.querySelectorAll('[id$="-room-code"]').forEach(el => {
    el.textContent = code;
  });
}

socket.on('player_joined', ({ players }) => renderLobby(players));
socket.on('player_left', ({ players }) => renderLobby(players));

function renderLobby(players) {
  const grid = document.getElementById('player-list');
  grid.innerHTML = players.map(p =>
    `<div class="player-tag">${esc(p.name)}</div>`
  ).join('');
  const btn = document.getElementById('btn-start');
  btn.disabled = players.length < 2;
  document.getElementById('start-hint').textContent =
    players.length < 2 ? 'Need at least 2 players' : `${players.length} players ready`;
}

document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('start_game');
});

socket.on('round_start', ({ roundNum, setNum, wordLimit, timer, totalPlayers }) => {
  document.getElementById('round-info').textContent = `Set ${setNum} — Round ${roundNum} of 4`;
  document.getElementById('word-limit-display').textContent = wordLimit;
  document.getElementById('write-timer').textContent = formatTime(timer);
  document.getElementById('submission-status').textContent = 'Waiting for answers...';
  document.getElementById('submission-progress').style.width = '0%';
  showScreen('screen-prompt-write');
});

socket.on('submission_update', ({ submitted, total }) => {
  document.getElementById('submission-status').textContent = `${submitted}/${total} submitted`;
  document.getElementById('submission-progress').style.width = `${(submitted / total) * 100}%`;
});

socket.on('time_update', ({ secondsLeft }) => {
  const text = formatTime(secondsLeft);
  document.querySelectorAll('.timer').forEach(el => {
    if (el.closest('.screen.active')) el.textContent = text;
  });
});

socket.on('matchup_show', ({ matchupId, prompt, answers, timer, matchupIndex, totalMatchups }) => {
  document.getElementById('matchup-counter').textContent = `Matchup ${matchupIndex + 1} of ${totalMatchups}`;
  document.getElementById('vote-prompt').textContent = `"${prompt}"`;
  const labels = ['A', 'B', 'C'];
  document.getElementById('answers-display').innerHTML = answers.map((a, i) =>
    `<div class="answer-card">
      <div class="answer-label">${labels[i]}</div>
      <div class="answer-text">${esc(a)}</div>
    </div>`
  ).join('');
  document.getElementById('vote-timer').textContent = formatTime(timer);
  showScreen('screen-matchup-vote');
});

socket.on('matchup_result', ({ prompt, answers, playerNames, voteCounts, totalVotes, scores, isFinalRound }) => {
  document.getElementById('result-prompt').textContent = `"${prompt}"`;
  const maxVotes = Math.max(...voteCounts);
  document.getElementById('results-display').innerHTML = answers.map((a, i) => {
    const isWinner = voteCounts[i] === maxVotes && voteCounts.filter(v => v === maxVotes).length === 1;
    return `<div class="answer-card${isWinner ? ' winner-card' : ''}">
      <div class="answer-text">${esc(a)}</div>
      <div class="result-votes">${voteCounts[i]} vote${voteCounts[i] !== 1 ? 's' : ''}</div>
      <div class="result-author">— ${esc(playerNames[i])} —</div>
      <div class="result-points">${scores[i] > 0 ? '+' + scores[i] : '0'} pts${isFinalRound ? ' (2x)' : ''}</div>
    </div>`;
  }).join('');
  showScreen('screen-matchup-result');
});

socket.on('round_end', ({ roundNum, setNum, standings }) => {
  document.getElementById('round-end-title').textContent = `Round ${roundNum} Complete`;
  renderStandings(document.getElementById('round-standings'), standings);
  showScreen('screen-round-end');
});

socket.on('set_end', ({ setNum, standings }) => {
  document.getElementById('set-end-title').textContent = `Set ${setNum} Complete`;
  renderStandings(document.getElementById('set-standings'), standings);
  showScreen('screen-set-end');
});

socket.on('game_end', ({ finalStandings }) => {
  const podium = document.getElementById('podium');
  const places = [
    { cls: 'second', idx: 1 },
    { cls: 'first', idx: 0 },
    { cls: 'third', idx: 2 }
  ];
  podium.innerHTML = places.map(({ cls, idx }) => {
    const p = finalStandings[idx];
    if (!p) return '';
    return `<div class="podium-place ${cls}">
      <div class="podium-name">${esc(p.name)}</div>
      <div class="podium-bar">
        <div class="podium-rank">${idx + 1}</div>
        <div class="podium-score">${p.score.toLocaleString()}</div>
      </div>
    </div>`;
  }).join('');
  renderStandings(document.getElementById('final-standings'), finalStandings.slice(3));
  showScreen('screen-final');
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  socket.emit('play_again');
});

socket.on('return_to_lobby', ({ players }) => {
  renderLobby(players);
  showScreen('screen-lobby');
});

socket.on('error', ({ message }) => {
  console.error('Server error:', message);
});
