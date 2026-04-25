const socket = io();
let myId = '';
let currentMatchupId = '';

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderStandings(container, standings) {
  container.innerHTML = standings.map((p, i) =>
    `<div class="standing-row${p.id === myId ? ' you' : ''}">
      <span class="standing-rank">${i + 1}</span>
      <span class="standing-name">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</span>
      <span class="standing-score">${p.score.toLocaleString()}</span>
    </div>`
  ).join('');
}

// Join flow
const btnJoin = document.getElementById('btn-join');
const inputCode = document.getElementById('input-code');
const inputName = document.getElementById('input-name');
const joinError = document.getElementById('join-error');

btnJoin.addEventListener('click', () => {
  const code = inputCode.value.trim().toUpperCase();
  const name = inputName.value.trim();
  joinError.textContent = '';
  if (!code || code.length !== 4) { joinError.textContent = 'Enter a 4-letter room code'; return; }
  if (!name) { joinError.textContent = 'Enter your name'; return; }
  btnJoin.disabled = true;
  socket.emit('join_room', { code, name });
});

socket.on('joined', ({ code, players, yourId }) => {
  myId = yourId;
  document.getElementById('lobby-code').textContent = code;
  renderLobbyPlayers(players);
  showScreen('screen-lobby');
});

socket.on('error', ({ message }) => {
  joinError.textContent = message;
  btnJoin.disabled = false;
});

socket.on('player_joined', ({ players }) => renderLobbyPlayers(players));
socket.on('player_left', ({ players }) => renderLobbyPlayers(players));

function renderLobbyPlayers(players) {
  const list = document.getElementById('lobby-players');
  list.innerHTML = players.map(p =>
    `<div class="player-item${p.id === myId ? ' you' : ''}">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</div>`
  ).join('');
}

// Writing phase
let currentWordLimit = 15;

socket.on('round_start', ({ roundNum, setNum, wordLimit, prompt, timer }) => {
  currentWordLimit = wordLimit;
  document.getElementById('write-round-info').textContent = `Set ${setNum} — Round ${roundNum}/4`;
  document.getElementById('write-word-limit').textContent = `${wordLimit} WORDS`;
  document.getElementById('write-prompt').textContent = `"${prompt}"`;
  document.getElementById('word-max').textContent = wordLimit;
  document.getElementById('word-count').textContent = '0';
  document.getElementById('input-answer').value = '';
  document.getElementById('input-answer').disabled = false;
  document.getElementById('btn-submit').disabled = false;
  document.getElementById('write-error').textContent = '';
  document.querySelector('.word-count').classList.remove('over');
  showScreen('screen-writing');
});

const inputAnswer = document.getElementById('input-answer');
const wordCountEl = document.getElementById('word-count');

inputAnswer.addEventListener('input', () => {
  const count = countWords(inputAnswer.value);
  wordCountEl.textContent = count;
  const over = count > currentWordLimit;
  document.querySelector('.word-count').classList.toggle('over', over);
  document.getElementById('btn-submit').disabled = over;
});

document.getElementById('btn-submit').addEventListener('click', () => {
  const text = inputAnswer.value.trim();
  if (!text) { document.getElementById('write-error').textContent = 'Write something!'; return; }
  if (countWords(text) > currentWordLimit) return;
  document.getElementById('btn-submit').disabled = true;
  inputAnswer.disabled = true;
  socket.emit('submit_answer', { text });
});

socket.on('answer_accepted', () => {
  showScreen('screen-submitted');
});

// Timer sync
socket.on('time_update', ({ secondsLeft }) => {
  const text = formatTime(secondsLeft);
  document.querySelectorAll('.timer').forEach(el => {
    if (el.closest('.screen.active')) {
      el.textContent = text;
      el.classList.toggle('urgent', secondsLeft <= 5);
    }
  });
});

// Voting
socket.on('matchup_show', ({ matchupId, prompt, answers, timer, canVote, matchupIndex, totalMatchups }) => {
  currentMatchupId = matchupId;

  if (!canVote) {
    showScreen('screen-own-matchup');
    return;
  }

  document.getElementById('vote-prompt').textContent = `"${prompt}"`;
  const labels = ['A', 'B', 'C'];
  const container = document.getElementById('vote-options');
  container.innerHTML = answers.map((a, i) =>
    `<button class="vote-btn" data-choice="${i}">
      <div class="vote-label">${labels[i]}</div>
      ${esc(a)}
    </button>`
  ).join('');

  container.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const choice = parseInt(btn.dataset.choice);
      socket.emit('submit_vote', { matchupId: currentMatchupId, choice });
      showScreen('screen-voted');
    });
  });

  showScreen('screen-voting');
});

socket.on('vote_accepted', () => {});

// Results
socket.on('matchup_result', ({ prompt, answers, playerNames, voteCounts, totalVotes, scores, isFinalRound }) => {
  document.getElementById('result-prompt').textContent = `"${prompt}"`;
  const maxVotes = Math.max(...voteCounts);
  document.getElementById('result-cards').innerHTML = answers.map((a, i) => {
    const isWinner = voteCounts[i] === maxVotes && voteCounts.filter(v => v === maxVotes).length === 1;
    return `<div class="result-card${isWinner ? ' winner' : ''}">
      <div class="result-answer">${esc(a)}</div>
      <div class="result-votes">${voteCounts[i]} vote${voteCounts[i] !== 1 ? 's' : ''}</div>
      <div class="result-author">— ${esc(playerNames[i])} —</div>
      <div class="result-points">${scores[i] > 0 ? '+' + scores[i] : '0'} pts${isFinalRound ? ' (2x)' : ''}</div>
    </div>`;
  }).join('');
  showScreen('screen-result');
});

socket.on('round_end', ({ roundNum, setNum, standings }) => {
  document.getElementById('phone-round-title').textContent = `Round ${roundNum} Complete`;
  renderStandings(document.getElementById('phone-round-standings'), standings);
  showScreen('screen-round-end');
});

socket.on('set_end', ({ setNum, standings, yourScore }) => {
  document.getElementById('phone-set-title').textContent = `Set ${setNum} Complete`;
  document.getElementById('phone-your-score').textContent = `Your score: ${yourScore.toLocaleString()}`;
  renderStandings(document.getElementById('phone-set-standings'), standings);
  showScreen('screen-set-end');
});

socket.on('game_end', ({ finalStandings, yourScore }) => {
  const me = finalStandings.find(p => p.id === myId);
  document.getElementById('phone-final-score').textContent = me
    ? `Your score: ${me.score.toLocaleString()}`
    : '';
  renderStandings(document.getElementById('phone-final-standings'), finalStandings);
  showScreen('screen-final');
});

socket.on('return_to_lobby', ({ players }) => {
  renderLobbyPlayers(players);
  showScreen('screen-lobby');
});
