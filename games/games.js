/* Lo-Life Games — shared score + log helper (localStorage, no backend, any browser).
   Each game records plays: { game, player, score, detail, ts }.
   The Games landing page reads these to show high scores. */
window.LoLifeGames = (function () {
  const PREFIX = 'lolife_games_';

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch (e) { return []; }
  }
  function write(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {} }

  // High scores per game — array sorted desc by score, capped.
  function getScores(game, cap) {
    const arr = read(PREFIX + 'hs_' + game).filter(r => r && typeof r.score === 'number');
    arr.sort((a, b) => b.score - a.score);
    return arr.slice(0, cap || 10);
  }
  // Add a score; returns the new high-score list and whether it's a new #1.
  function addScore(game, player, score, detail) {
    const list = read(PREFIX + 'hs_' + game);
    const rec = {
      game: game,
      player: (player || '').trim() || 'Player',
      score: Math.round(score),
      detail: detail || '',
      ts: Date.now(),
      when: new Date().toLocaleString()
    };
    list.push(rec);
    // sort the in-memory list and keep the top 10
    const sorted = list
      .filter(r => r && typeof r.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    write(PREFIX + 'hs_' + game, sorted);
    // also append to the data log
    addLog(game, {
      type: 'score',
      player: rec.player, score: rec.score, detail: rec.detail,
      when: rec.when
    });
    const isTop = sorted.length && sorted[0].ts === rec.ts;
    return { scores: sorted, isNewHigh: isTop };
  }
  // Data log — chronological list of events per game.
  function getLog(game, limit) {
    const arr = read(PREFIX + 'log_' + game);
    return arr.slice(-(limit || 100));
  }
  function addLog(game, entry) {
    const arr = read(PREFIX + 'log_' + game);
    arr.push(Object.assign({ ts: Date.now() }, entry));
    write(PREFIX + 'log_' + game, arr.slice(-200));
  }
  // All games that have recorded data.
  function gamesWithData() {
    const games = new Set();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PREFIX + 'hs_') === 0) games.add(k.slice(PREFIX.length + 3));
    }
    return [...games];
  }
  // Times Played — increments on every game launch/start, whether finished or not.
  function getPlays(game) {
    var n = 0;
    try { n = parseInt(localStorage.getItem(PREFIX + 'plays_' + game) || '0', 10); }
    catch (e) {}
    return isNaN(n) ? 0 : n;
  }
  function countPlay(game) {
    write(PREFIX + 'plays_' + game, getPlays(game) + 1);
    return getPlays(game);
  }
  return { getScores, addScore, getLog, addLog, gamesWithData, getPlays, countPlay };
})();
