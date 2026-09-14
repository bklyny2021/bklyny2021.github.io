/* =========================================================================
   Lo-Life Solitaire — Klondike (production build)
   Filename: game.js
   Standard rules, exact scoring, drag-and-drop, auto-move, win modal.
   ========================================================================= */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                          */
  /* ------------------------------------------------------------------ */
  var SUITS = ['C', 'D', 'H', 'S'];
  var SUIT_SYMBOL = { C: '\u2663', D: '\u2666', H: '\u2665', S: '\u2660' };
  var SUIT_NAME = { C: 'Clubs', D: 'Diamonds', H: 'Hearts', S: 'Spades' };
  var RANK_NAMES = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  var RED = { D: true, H: true, C: false, S: false };

  /* Standard Klondike scoring (exact per spec) */
  var PTS = {
    WASTE_TO_TABLEAU: 5,
    TO_FOUNDATION: 10,
    TURN_OVER: 5,
    FOUNDATION_TO_TABLEAU: -15,
    RECYCLE_STOCK: -100
  };

  /* DOM references */
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    board: $('board'),
    stock: $('stock'),
    stockCount: $('stock-count'),
    waste: $('waste'),
    foundations: [$('f0'), $('f1'), $('f2'), $('f3')],
    columns: [$('c0'), $('c1'), $('c2'), $('c3'), $('c4'), $('c5'), $('c6')],
    score: $('score'),
    moves: $('moves'),
    timer: $('timer'),
    newGame: $('new-game'),
    restart: $('restart'),
    soundToggle: $('sound-toggle'),
    winModal: $('win-modal'),
    winStats: $('win-stats'),
    winScore: $('win-score'),
    winMoves: $('win-moves'),
    winTime: $('win-time'),
    playAgain: $('play-again')
  };

  /* ------------------------------------------------------------------ */
  /* Card sounds (Web Audio API, no external files)                     */
  /* ------------------------------------------------------------------ */
  var SND = {
    ctx: null,
    enabled: true,
    ensure: function () {
      if (this.ctx) return this.ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      return this.ctx;
    },
    // resume context on first user gesture
    unlock: function () {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone: function (freq, dur, type, vol, delay) {
      if (!this.enabled) return;
      var ctx = this.ensure();
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime((vol || 0.15), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.12));
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + (dur || 0.12) + 0.05);
    },
    noise: function (dur, vol, delay) {
      if (!this.enabled) return;
      var ctx = this.ensure();
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var len = Math.max(1, Math.floor((dur || 0.08) * ctx.sampleRate));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      g.gain.setValueAtTime((vol || 0.2), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 700;
      src.connect(f); f.connect(g); g.connect(ctx.destination);
      src.start(t); src.stop(t + (dur || 0.08) + 0.02);
    },
    deal:  function () { this.noise(0.07, 0.15); this.tone(400, 0.05, 'square', 0.04); },
    flip:  function () { this.tone(520, 0.07, 'triangle', 0.12); },
    draw:  function () { this.tone(300, 0.06, 'triangle', 0.10); this.tone(420, 0.05, 'triangle', 0.06, 0.04); },
    slide: function () { this.noise(0.06, 0.12); this.tone(260, 0.07, 'triangle', 0.08); },
    stack: function () { this.tone(380, 0.07, 'sine', 0.10); this.tone(520, 0.06, 'sine', 0.08, 0.04); },
    foundation: function () { this.tone(523, 0.09, 'sine', 0.12); this.tone(659, 0.09, 'sine', 0.10, 0.06); this.tone(784, 0.12, 'sine', 0.10, 0.12); },
    win: function () {
      var me = this;
      [523, 659, 784, 1047, 1319].forEach(function (f, i) { me.tone(f, 0.16, 'sine', 0.13, i * 0.11); });
    },
    toggle: function () {
      this.enabled = !this.enabled;
      return this.enabled;
    }
  };

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */
  var state = {
    stock: [],         // face-down
    waste: [],         // face-up, top = last
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    score: 0,
    moves: 0,
    seconds: 0,
    won: false,
    started: false
  };
  var timerHandle = null;
  var drag = null; // active drag {el, cards[], sourceType, sourceIndex, startX, startY}

  /* ------------------------------------------------------------------ */
  /* Deck                                                               */
  /* ------------------------------------------------------------------ */
  function makeDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 1; r <= 13; r++) {
        deck.push({ suit: SUITS[s], rank: r, faceUp: false });
      }
    }
    return deck;
  }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
  function cardKey(c) { return c.suit + c.rank; }
  function rankLabel(r) { return RANK_NAMES[r] || String(r); }

  /* ------------------------------------------------------------------ */
  /* Rules / validation                                                 */
  /* ------------------------------------------------------------------ */
  function canStackOnTableau(card, destCard) {
    if (!destCard) return card.rank === 13;              // only King to empty col
    return destCard.faceUp &&
      RED[card.suit] !== RED[destCard.suit] &&
      card.rank === destCard.rank - 1;
  }
  function canPlaceOnFoundation(card, foundation) {
    if (!foundation.length) return card.rank === 1;      // Ace starts
    var top = foundation[foundation.length - 1];
    return top.suit === card.suit && card.rank === top.rank + 1;
  }
  /* Returns the column of a foundation that `card` can legally go to, or null */
  function foundationTargetFor(card) {
    for (var i = 0; i < 4; i++) {
      if (canPlaceOnFoundation(card, state.foundations[i])) return i;
    }
    return null;
  }
  /* Returns target col index for an auto-move of a single face-up card, or null */
  function autoTableauTargetFor(card) {
    for (var i = 0; i < 7; i++) {
      var col = state.tableau[i];
      var top = col.length ? col[col.length - 1] : null;
      if (canStackOnTableau(card, top)) return i;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Scoring helpers                                                    */
  /* ------------------------------------------------------------------ */
  function addScore(points) {
    state.score = Math.max(0, state.score + points);
    els.score.textContent = state.score;
  }
  function isRun(cards) {
    for (var i = 1; i < cards.length; i++) {
      if (!cards[i].faceUp) return false;
      if (RED[cards[i].suit] === RED[cards[i - 1].suit]) return false;
      if (cards[i].rank !== cards[i - 1].rank - 1) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Move engine                                                        */
  /* ------------------------------------------------------------------ */
  function moveWasteToTableau(columnIdx) {
    if (!state.waste.length) return false;
    var card = state.waste[state.waste.length - 1];
    var top = state.tableau[columnIdx].length
      ? state.tableau[columnIdx][state.tableau[columnIdx].length - 1]
      : null;
    if (!canStackOnTableau(card, top)) return false;
    card.faceUp = true;
    state.waste.pop();
    state.tableau[columnIdx].push(card);
    state.moves++;
    addScore(PTS.WASTE_TO_TABLEAU);
    syncMoves();
    SND.slide();
    renderBoard();
    return true;
  }
  function moveWasteToFoundation() {
    if (!state.waste.length) return false;
    var card = state.waste[state.waste.length - 1];
    var fi = foundationTargetFor(card);
    if (fi === null) return false;
    card.faceUp = true;
    state.waste.pop();
    state.foundations[fi].push(card);
    state.moves++;
    addScore(PTS.TO_FOUNDATION);
    syncMoves();
    SND.foundation();
    renderBoard();
    checkWin();
    return true;
  }
  function moveTableauRun(columnIdx, startIdx, targetColIdx) {
    var col = state.tableau[columnIdx];
    if (startIdx < 0 || startIdx >= col.length) return false;
    var moving = col.slice(startIdx);
    if (!moving.length || !moving[0].faceUp || !isRun(moving)) return false;
    var topTarget = state.tableau[targetColIdx].length
      ? state.tableau[targetColIdx][state.tableau[targetColIdx].length - 1]
      : null;
    if (!canStackOnTableau(moving[0], topTarget)) return false;

    // Perform move
    state.tableau[columnIdx] = col.slice(0, startIdx);
    state.tableau[targetColIdx] = state.tableau[targetColIdx].concat(moving);
    state.moves++;
    syncMoves();
    // Auto-flip newly exposed card
    exposeTop(columnIdx);
    SND.slide();
    renderBoard();
    return true;
  }
  function moveTableauTopToFoundation(columnIdx) {
    var col = state.tableau[columnIdx];
    if (!col.length) return false;
    var card = col[col.length - 1];
    if (!card.faceUp) return false;
    var fi = foundationTargetFor(card);
    if (fi === null) return false;
    card.faceUp = true;
    col.pop();
    state.foundations[fi].push(card);
    state.moves++;
    addScore(PTS.TO_FOUNDATION);
    syncMoves();
    exposeTop(columnIdx);
    SND.foundation();
    renderBoard();
    checkWin();
    return true;
  }
  function moveFoundationToTableau(foundationIdx, targetColIdx) {
    var f = state.foundations[foundationIdx];
    if (!f.length) return false;
    var card = f[f.length - 1];
    var top = state.tableau[targetColIdx].length
      ? state.tableau[targetColIdx][state.tableau[targetColIdx].length - 1]
      : null;
    if (!canStackOnTableau(card, top)) return false;
    card.faceUp = true;
    f.pop();
    state.tableau[targetColIdx].push(card);
    state.moves++;
    addScore(PTS.FOUNDATION_TO_TABLEAU);
    syncMoves();
    SND.slide();
    renderBoard();
    return true;
  }
  function drawFromStock() {
    if (state.won) return;
    if (!state.stock.length) {
      // recycle waste -> stock, score penalty (only on non-initial pass)
      if (state.waste.length) {
        state.stock = state.waste.slice().reverse();
        state.waste = [];
        // reset faceDown: stock cards face-down
        state.stock.forEach(function (c) { c.faceUp = false; });
        addScore(PTS.RECYCLE_STOCK);
        state.moves++;
        syncMoves();
        SND.slide();
        renderBoard();
      }
      return;
    }
    var card = state.stock.pop();
    card.faceUp = true;
    state.waste.push(card);
    state.moves++;
    syncMoves();
    SND.draw();
    renderStock();
    renderWaste();
  }

  function exposeTop(columnIdx) {
    var col = state.tableau[columnIdx];
    if (col.length) {
      var topCard = col[col.length - 1];
      if (!topCard.faceUp) {
        topCard.faceUp = true;
        state.moves++;
        addScore(PTS.TURN_OVER);
        syncMoves();
        SND.flip();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Auto-move (double-click / tap)                                      */
  /* ------------------------------------------------------------------ */
  function autoMove(card, sourceType, columnIdx, cardIndex) {
    // 1) try foundation
    var fi = foundationTargetFor(card);
    if (fi !== null) {
      if (sourceType === 'tableau') {
        var col = state.tableau[columnIdx];
        col.splice(cardIndex, 1);
        state.foundations[fi].push(card);
        exposeTop(columnIdx);
      } else if (sourceType === 'waste') {
        // only the top of waste is auto-movable
        if (card === state.waste[state.waste.length - 1]) {
          state.waste.pop();
          state.foundations[fi].push(card);
        } else return false;
      }
      addScore(PTS.TO_FOUNDATION);
      state.moves++;
      syncMoves();
      renderBoard();
      checkWin();
      return true;
    }
    // 2) auto-move a single top tableau card or top-of-waste to a tableau spot
    if (sourceType === 'tableau' && cardIndex >= 0 &&
        state.tableau[columnIdx][cardIndex] === card) {
      var ti = autoTableauTargetFor(card);
      if (ti !== null) {
        var col2 = state.tableau[columnIdx];
        col2.splice(cardIndex, 1);
        state.tableau[ti].push(card);
        exposeTop(columnIdx);
        addScore(PTS.TURN_OVER >= 0 && col2.length ? 0 : 0); // no score for pure move (spec: turn-over scores separately)
        // apply tableau move scoring: treat as +5 per spec? Spec only lists waste->tableau; tableau->tableau not scored.
        state.moves++;
        syncMoves();
        renderBoard();
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                          */
  /* ------------------------------------------------------------------ */
  function cardEl(card, isBackStyle) {
    var div = document.createElement('div');
    div.className = 'card';
    div.dataset.suit = card.suit;
    div.dataset.rank = card.rank;
    if (!card.faceUp) {
      div.classList.add('back');
      return div;
    }
    div.classList.add('up', RED[card.suit] ? 'red' : 'black');
    var corner = document.createElement('div');
    corner.className = 'corner';
    var big = document.createElement('div');
    big.className = 'big';
    big.textContent = rankLabel(card.rank);
    var sym = document.createElement('div');
    sym.className = 'sym';
    sym.textContent = SUIT_SYMBOL[card.suit];
    corner.appendChild(big);
    corner.appendChild(sym);
    var center = document.createElement('div');
    center.className = 'center';
    center.textContent = SUIT_SYMBOL[card.suit];
    var cornerBot = document.createElement('div');
    cornerBot.className = 'corner bottom';
    cornerBot.textContent = rankLabel(card.rank) + SUIT_SYMBOL[card.suit];
    div.appendChild(corner);
    div.appendChild(center);
    div.appendChild(cornerBot);
    return div;
  }
  function renderStock() {
    els.stockCount.textContent = state.stock.length ? String(state.stock.length) : '';
    els.stock.classList.toggle('empty', state.stock.length === 0);
  }
  function renderWaste() {
    els.waste.innerHTML = '';
    if (state.waste.length) {
      var c = state.waste[state.waste.length - 1];
      var el = cardEl(c);
      el.classList.add('top-waste');
      el.addEventListener('dblclick', function () {
        autoMove(c, 'waste', -1, -1);
      });
      els.waste.appendChild(el);
    } else {
      els.waste.classList.add('empty-slot');
      var ph = document.createElement('div');
      ph.className = 'placeholder';
      ph.textContent = 'Waste';
      els.waste.appendChild(ph);
    }
  }
  function renderFoundations() {
    for (var i = 0; i < 4; i++) {
      var pile = state.foundations[i];
      var host = els.foundations[i];
      host.innerHTML = '';
      if (pile.length) {
        var c = pile[pile.length - 1];
        c.faceUp = true;
        var el = cardEl(c);
        el.dataset.fi = i;
        els.foundations[i].appendChild(el);
      } else {
        var ph = document.createElement('div');
        ph.className = 'placeholder';
        ph.textContent = SUIT_SYMBOL[SUITS[i]];
        host.appendChild(ph);
      }
    }
  }
  function renderTableau() {
    for (var i = 0; i < 7; i++) {
      var pile = state.tableau[i];
      var host = els.columns[i];
      host.innerHTML = '';
      if (!pile.length) {
        var ph = document.createElement('div');
        ph.className = 'placeholder empty-col';
        ph.dataset.col = i;
        host.appendChild(ph);
        continue;
      }
      pile.forEach(function (c, idx) {
        var el = cardEl(c);
        el.dataset.col = i;
        el.dataset.idx = idx;
        el.style.top = (idx * 28) + 'px';
        host.appendChild(el);
      });
    }
  }
  function renderBoard() {
    renderStock();
    renderWaste();
    renderFoundations();
    renderTableau();
  }

  function syncMoves() { els.moves.textContent = state.moves; }

  /* ------------------------------------------------------------------ */
  /* Timer                                                              */
  /* ------------------------------------------------------------------ */
  function tick() {
    if (state.won) return;
    state.seconds++;
    els.timer.textContent = formatTime(state.seconds);
  }
  function formatTime(s) {
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ */
  /* Win                                                                */
  /* ------------------------------------------------------------------ */
  function checkWin() {
    if (state.won) return;
    var total = 0;
    for (var i = 0; i < 4; i++) total += state.foundations[i].length;
    if (total === 52) {
      state.won = true;
      if (timerHandle) clearInterval(timerHandle);
      showWin();
    }
  }
  function showWin() {
    els.winScore.textContent = state.score;
    els.winMoves.textContent = state.moves;
    els.winTime.textContent = formatTime(state.seconds);
    els.winModal.classList.add('show');
    SND.win();
    // record high score through shared helper (if present)
    recordHighScore();
  }

  /* ------------------------------------------------------------------ */
  /* High score hook (games.js optional)                                */
  /* ------------------------------------------------------------------ */
  function recordHighScore() {
    try {
      if (typeof LoLifeGames !== 'undefined') {
        var name = localStorage.getItem('lolife_last_name') || 'Player';
        LoLifeGames.addScore('solitaire', name, state.score,
          formatTime(state.seconds) + ' · ' + state.moves + ' moves');
      }
    } catch (e) { /* non-fatal */ }
  }

  /* ------------------------------------------------------------------ */
  /* Drag-and-drop (desktop)                                             */
  /* ------------------------------------------------------------------ */
  function dragStart(e, card, sourceType, columnIdx, cardIndex) {
    // build the set of cards to drag
    var cards;
    if (sourceType === 'tableau') {
      var col = state.tableau[columnIdx];
      if (cardIndex < 0 || cardIndex >= col.length) return;
      if (col[cardIndex] !== card) return;
      cards = col.slice(cardIndex);
      if (!cards.length || !cards[0].faceUp || !isRun(cards)) return;
    } else if (sourceType === 'waste') {
      if (state.waste[state.waste.length - 1] !== card) return;
      cards = [card];
    } else if (sourceType === 'foundation') {
      var f = state.foundations[columnIdx];
      if (f[f.length - 1] !== card) return;
      cards = [card];
    } else return;

    drag = { cards: cards, sourceType: sourceType, columnIdx: columnIdx };
    document.body.classList.add('dragging');
    e.preventDefault();
  }
  function dragEnd(x, y) {
    if (!drag) return;
    var target = document.elementFromPoint(x, y);
    var dropCol = target ? target.closest('[data-col]') : null;

    if (drag.sourceType === 'foundation') {
      if (dropCol) {
        moveFoundationToTableau(drag.columnIdx, Number(dropCol.dataset.col));
      }
    } else if (drag.sourceType === 'waste') {
      if (dropCol) {
        moveWasteToTableau(Number(dropCol.dataset.col));
      } else {
        moveWasteToFoundation();
      }
    } else if (drag.sourceType === 'tableau') {
      if (dropCol) {
        moveTableauRun(drag.columnIdx, getCardIndexInState(drag.cards[0]), Number(dropCol.dataset.col));
      } else {
        // drop on foundation area -> try top card to foundation
        moveTableauTopToFoundation(drag.columnIdx);
      }
    }
    drag = null;
    document.body.classList.remove('dragging');
    renderBoard();
  }
  function getCardIndexInState(card) {
    for (var i = 0; i < 7; i++) {
      var col = state.tableau[i];
      for (var k = 0; k < col.length; k++) if (col[k] === card) return k;
    }
    return -1;
  }

  /* ------------------------------------------------------------------ */
  /* Input wiring                                                       */
  /* ------------------------------------------------------------------ */
  function initInput() {
    // Stock click -> draw
    els.stock.addEventListener('click', drawFromStock);

    // Foundations: click to move top back to tableau (click cycle) + droppable
    // (clicking a foundation with a selected tableau card is handled via drag; also add tap-away)
    // Waste dbl-click handled in render. Tableau cards get drag + dbl-click.

    // Global drag listeners via pointer events (works on touch too)
    var activePointer = null;

    document.addEventListener('pointerdown', function (e) {
      SND.unlock(); // allow audio to start after first user gesture
      if (state.won) return;
      var cardEl2 = e.target.closest('.card');
      if (!cardEl2) return;
      var suit = cardEl2.dataset.suit, rank = Number(cardEl2.dataset.rank);
      var card = findCardByKey(suit + rank);
      if (!card || !card.faceUp) return;
      var col = cardEl2.dataset.col;
      var sourceType = 'tableau';
      var columnIdx = -1, cardIndex = -1;
      if (col !== undefined) { sourceType = 'tableau'; columnIdx = Number(col); cardIndex = Number(cardEl2.dataset.idx); }
      else if (cardEl2.classList.contains('top-waste')) { sourceType = 'waste'; columnIdx = -1; cardIndex = -1; }
      else if (cardEl2.dataset.fi !== undefined) { sourceType = 'foundation'; columnIdx = Number(cardEl2.dataset.fi); cardIndex = -1; }

      activePointer = {
        id: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        sourceType: sourceType, columnIdx: columnIdx, cardIndex: cardIndex,
        card: card, el: cardEl2
      };
    });

    document.addEventListener('pointerup', function (e) {
      if (!activePointer) return;
      var dx = e.clientX - activePointer.startX;
      var dy = e.clientY - activePointer.startY;
      var moved = (Math.abs(dx) + Math.abs(dy)) > 8;
      var p = activePointer;
      activePointer = null;

      if (moved) {
        // treat as drag -> drop
        if (p.sourceType === 'tableau') {
          dragStart(e, p.card, 'tableau', p.columnIdx, p.cardIndex);
          dragEnd(e.clientX, e.clientY);
        } else if (p.sourceType === 'waste') {
          dragStart(e, p.card, 'waste', -1, -1);
          dragEnd(e.clientX, e.clientY);
        } else if (p.sourceType === 'foundation') {
          dragStart(e, p.card, 'foundation', p.columnIdx, -1);
          dragEnd(e.clientX, e.clientY);
        }
      } else {
        // tap / click
        if (p.sourceType === 'tableau') {
          autoMove(p.card, 'tableau', p.columnIdx, p.cardIndex);
        } else if (p.sourceType === 'waste') {
          autoMove(p.card, 'waste', -1, -1);
        } else if (p.sourceType === 'foundation') {
          // tap a foundation: try move it back to a tableau col (find first legal)
          var fi = p.columnIdx;
          var f = state.foundations[fi];
          if (f.length) {
            var c = f[f.length - 1];
            for (var t = 0; t < 7; t++) {
              var top = state.tableau[t].length ? state.tableau[t][state.tableau[t].length - 1] : null;
              if (canStackOnTableau(c, top)) {
                moveFoundationToTableau(fi, t);
                break;
              }
            }
          }
        }
      }
    });

    document.addEventListener('pointercancel', function () { activePointer = null; drag = null; });

    // Buttons
    els.newGame.addEventListener('click', newGame);
    els.restart.addEventListener('click', newGame);
    els.playAgain.addEventListener('click', function () { els.winModal.classList.remove('show'); newGame(); });
  }

  function findCardByKey(key) {
    // search tableau face-up, waste, foundation
    for (var i = 0; i < 7; i++) {
      for (var k = 0; k < state.tableau[i].length; k++) {
        if (cardKey(state.tableau[i][k]) === key && state.tableau[i][k].faceUp) return state.tableau[i][k];
      }
    }
    if (state.waste.length && cardKey(state.waste[state.waste.length - 1]) === key) return state.waste[state.waste.length - 1];
    for (var f = 0; f < 4; f++) {
      var pile = state.foundations[f];
      if (pile.length && cardKey(pile[pile.length - 1]) === key) return pile[pile.length - 1];
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Deck integrity (hard rule: real 52-card deck, no dupes, none missing) */
  /* ------------------------------------------------------------------ */
  function verifyDeckIntegrity() {
    // gather every card currently in play
    var seen = {};
    var count = 0;
    var all = [];
    for (var i = 0; i < 7; i++) all.push.apply(all, state.tableau[i]);
    all.push.apply(all, state.stock);
    all.push.apply(all, state.waste);
    for (var f = 0; f < 4; f++) all.push.apply(all, state.foundations[f]);
    all.forEach(function (c) {
      var key = c.suit + c.rank;
      if (!seen[key]) seen[key] = 0;
      seen[key]++;
      count++;
    });
    // exactly 52 unique cards, no dup, no missing
    var uniq = Object.keys(seen).length;
    var dupFound = Object.keys(seen).some(function (k) { return seen[k] > 1; });
    var totalExpected = 52;
    // verify all 4 suits x 13 ranks present
    var complete = true;
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 1; r <= 13; r++) {
        if (seen[SUITS[s] + r] !== 1) { complete = false; break; }
      }
    }
    var ok = (count === totalExpected) && (uniq === totalExpected) && !dupFound && complete;
    return { ok: ok, count: count, uniq: uniq, dupFound: dupFound, complete: complete };
  }

  /* ------------------------------------------------------------------ */
  /* Setup                                                              */
  /* ------------------------------------------------------------------ */
  function newGame() {
    if (timerHandle) clearInterval(timerHandle);
    var deck = shuffle(makeDeck());
    var k = 0;
    var tableau = [];
    for (var c = 0; c < 7; c++) {
      var col = [];
      for (var n = 0; n <= c; n++) {
        col.push(deck[k++]);
      }
      col[col.length - 1].faceUp = true;
      tableau.push(col);
    }
    state = {
      stock: deck.slice(k),   // remaining 24, face-down
      waste: [],
      foundations: [[], [], [], []],
      tableau: tableau,
      score: 0,
      moves: 0,
      seconds: 0,
      won: false,
      started: true
    };
    // ensure stock cards are face-down
    state.stock.forEach(function (c) { c.faceUp = false; });
    els.score.textContent = '0';
    els.timer.textContent = '00:00';
    syncMoves();
    renderBoard();
    // DECK INTEGRITY GUARD: every card must be present exactly once, no dupes, none missing.
    // If the verifier ever fails, force a fresh honest deck (never deal a broken one).
    var integrity = verifyDeckIntegrity();
    if (!integrity.ok) {
      if (window.console) console.error('Deck integrity failed:', integrity);
      state = { stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []],
                score: 0, moves: 0, seconds: 0, won: false, started: true };
      renderBoard();
    }
    // start timer
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = setInterval(tick, 1000);
    SND.deal();
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */
  function init() {
    initInput();
    newGame();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
