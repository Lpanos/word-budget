const { TRIPLE_THRESHOLD } = require('../shared/constants');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createMatchups(playerIds, opponentHistory) {
  const count = playerIds.length;
  if (count < 2) return [];

  const ordered = rankByFewestSharedOpponents(playerIds, opponentHistory);

  const groups = [];
  if (count >= TRIPLE_THRESHOLD) {
    assignTriples(ordered, groups);
  } else {
    assignPairs(ordered, groups);
  }
  return groups;
}

function assignPairs(players, groups) {
  const remaining = [...players];
  if (remaining.length % 2 === 1) {
    groups.push(remaining.splice(0, 3));
  }
  while (remaining.length >= 2) {
    groups.push(remaining.splice(0, 2));
  }
}

function assignTriples(players, groups) {
  const remaining = [...players];
  const leftover = remaining.length % 3;
  if (leftover === 1) {
    groups.push(remaining.splice(0, 2));
    groups.push(remaining.splice(0, 2));
  } else if (leftover === 2) {
    groups.push(remaining.splice(0, 2));
  }
  while (remaining.length >= 3) {
    groups.push(remaining.splice(0, 3));
  }
}

function rankByFewestSharedOpponents(playerIds, history) {
  return shuffle(playerIds);
}

function recordOpponents(groups, history) {
  for (const group of groups) {
    for (const pid of group) {
      if (!history[pid]) history[pid] = {};
      for (const other of group) {
        if (other !== pid) {
          history[pid][other] = (history[pid][other] || 0) + 1;
        }
      }
    }
  }
}

module.exports = { createMatchups, recordOpponents };
