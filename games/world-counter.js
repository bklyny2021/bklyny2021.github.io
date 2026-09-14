/* Lo-Life Games — worldwide play counter.
   Counts every play by every visitor (shared via Cloudflare Worker + KV),
   shown on the games page as the global total alongside the per-browser count.

   Load this on games.html and each game page.
     LoLifeWorldCounter.record('spades');      // +1 worldwide (fire-and-forget)
     LoLifeWorldCounter.getTotal(cb);          // cb({total, games})
*/
window.LoLifeWorldCounter = (function () {
  var WORKER_URL = "https://lolife-counter.lolife-games.workers.dev";

  function record(game) {
    try {
      if (!game) return;
      fetch(WORKER_URL + "/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: game }),
        mode: "cors",
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  function getTotal(cb) {
    try {
      fetch(WORKER_URL + "/total", { method: "GET", mode: "cors" })
        .then(function (r) { return r.json(); })
        .then(cb)
        .catch(function () { cb && cb({ total: 0, games: {} }); });
    } catch (e) {
      cb && cb({ total: 0, games: {} });
    }
  }

  return { record: record, getTotal: getTotal };
})();
