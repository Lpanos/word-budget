const promptBank = require('./prompts.json');

function createPromptPool() {
  return {
    available: [...promptBank],
    used: []
  };
}

function pickPrompts(pool, count) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    if (pool.available.length === 0) {
      pool.available = [...pool.used];
      pool.used = [];
    }
    const idx = Math.floor(Math.random() * pool.available.length);
    const prompt = pool.available.splice(idx, 1)[0];
    pool.used.push(prompt);
    picked.push(prompt);
  }
  return picked;
}

module.exports = { createPromptPool, pickPrompts };
