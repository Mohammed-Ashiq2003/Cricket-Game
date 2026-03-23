/**
 * ====================================================================
 * MUMBAI INDIANS CRICKET — script.js
 * Production-ready IPL-themed cricket mini-game
 *
 * Modules:
 *   CONFIG      — all tunable constants
 *   Sound       — Web Audio API synthetic sounds
 *   HighScore   — localStorage persistence
 *   Crowd       — decorative stadium crowd dots
 *   FlashFX     — full-screen flash overlay
 *   Sparks      — particle burst system
 *   HUD         — all DOM updates / scoreboard
 *   AIBowler    — delivery variation logic
 *   Ball        — physics, hit window, animation
 *   Game        — top-level flow (toss → play → over)
 *   Input       — unified event bindings
 * ====================================================================
 */

'use strict';

/* ─────────────────────────────────────────────────────────────────
   CONFIG
   ───────────────────────────────────────────────────────────────── */
const CONFIG = {
  difficulty: {
    easy:   { baseMs: 3000, minMs: 1500, accel: 55,  windowMs: 430, label: 'EASY'   },
    medium: { baseMs: 2300, minMs: 1150, accel: 75,  windowMs: 320, label: 'MEDIUM' },
    hard:   { baseMs: 1600, minMs:  800, accel: 100, windowMs: 210, label: 'HARD'   },
  },
  /* weighted scoring pool — 6 appears twice for big-hitting feel */
  runs:       [1, 1, 2, 2, 4, 6, 6],
  maxWickets: 3,
  maxMult:    4.5,
  lsKey:      'miCricketHS_v1',
};

/* ─────────────────────────────────────────────────────────────────
   DOM CACHE — single query per element
   ───────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const DOM = {
  screens:    { toss: $('screen-toss'), game: $('screen-game'), over: $('screen-over') },
  // Toss
  coin:       $('toss-coin'),
  tossResult: $('toss-result-text'),
  tossChoose: $('toss-choose'),
  tossDiff:   $('toss-diff'),
  tossHs:     $('toss-hs'),
  diffBtns:   document.querySelectorAll('.diff-btn'),
  btnHeads:   $('btn-heads'),
  btnTails:   $('btn-tails'),
  btnBat:     $('btn-bat'),
  // HUD
  ssRuns:     $('ss-runs'),
  ssWickets:  $('ss-wickets'),
  ssBalls:    $('ss-balls-display'),
  ssHs:       $('ss-hs'),
  lifeIcons:  [$('l1'), $('l2'), $('l3')],
  dotRow:     $('dot-row'),
  smFill:     $('sm-fill'),
  smVal:      $('sm-val'),
  // Arena
  ball:       $('ball'),
  burst:      $('burst'),
  batsman:    $('batsman'),
  arena:      $('arena'),
  stumps:     $('stumps'),
  bowler:     $('bowler'),
  // Controls
  btnHit:     $('btn-hit'),
  // Over screen
  overHeadline:   $('over-headline'),
  overSub:        $('over-sub'),
  overTrophy:     $('over-trophy'),
  mcScore:        $('mc-score'),
  mcOpp:          $('mc-opp-score'),
  ovBalls:        $('ov-balls'),
  ovHs:           $('ov-hs'),
  ovBoundaries:   $('ov-boundaries'),
  nhBadge:        $('new-hs-badge'),
  btnRestart:     $('btn-restart'),
  btnTossScreen:  $('btn-toss'),
};

/* ─────────────────────────────────────────────────────────────────
   GAME STATE — single source of truth
   ───────────────────────────────────────────────────────────────── */
const State = {
  difficulty:   'easy',
  score:        0,
  wickets:      0,          // wickets LOST
  ballsFaced:   0,
  boundaries:   0,          // 4s and 6s
  speedMult:    1.0,
  canHit:       false,
  ballLive:     false,
  running:      false,
  dropTimer:    null,
  windowTimer:  null,

  reset() {
    this.score      = 0;
    this.wickets    = 0;
    this.ballsFaced = 0;
    this.boundaries = 0;
    this.speedMult  = 1.0;
    this.canHit     = false;
    this.ballLive   = false;
    this.running    = true;
    clearTimeout(this.dropTimer);
    clearTimeout(this.windowTimer);
  },
};

/* ─────────────────────────────────────────────────────────────────
   HIGH SCORE
   ───────────────────────────────────────────────────────────────── */
const HighScore = {
  get()    { try { return parseInt(localStorage.getItem(CONFIG.lsKey)) || 0; } catch { return 0; } },
  save(v)  { try { localStorage.setItem(CONFIG.lsKey, v); } catch {} },
  update(score) {
    if (score > this.get()) { this.save(score); return true; }
    return false;
  },
};

/* ─────────────────────────────────────────────────────────────────
   SOUND ENGINE — Web Audio, no external files
   ───────────────────────────────────────────────────────────────── */
const Sound = (() => {
  let ctx = null;
  const init = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); };

  /** Generic oscillator helper */
  function osc(freq, type, vol, decay, delay = 0, freqEnd = null) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    if (freqEnd) o.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + delay + decay);
    g.gain.setValueAtTime(vol, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + decay);
    o.start(ctx.currentTime + delay);
    o.stop(ctx.currentTime + delay + decay + .05);
  }

  return {
    init,
    /** Bat impact — sharp crack + warm resonance */
    hit(runs) {
      init();
      const f = { 1:300, 2:380, 4:500, 6:640 }[runs] || 400;
      osc(f,       'square',   .22, .1);
      osc(f * .6,  'triangle', .28, .2, .04);
      if (runs >= 4) {
        // Boundary excitement: rising crowd howl
        osc(200, 'sawtooth', .1, .7, .08, 380);
        osc(240, 'sawtooth', .07, .6, .14, 420);
      }
      if (runs === 6) {
        osc(440, 'sine', .12, .5, .2);
        osc(550, 'sine', .08, .4, .28);
      }
    },
    /** Wicket — descending tone + thud */
    wicket() {
      init();
      osc(260, 'sawtooth', .18, .3);
      osc(180, 'sawtooth', .14, .25, .1);
      osc(120, 'triangle', .1,  .4, .22);
    },
    /** Stadium crowd cheer */
    cheer() {
      init();
      [0,.05,.1,.15,.22].forEach((d, i) =>
        osc(280 + i * 38, 'sine', .04, .65, d));
    },
    /** Toss whistle */
    tossWhistle() {
      init();
      osc(880, 'sine', .18, .14);
      osc(1100, 'sine', .16, .14, .17);
    },
    /** Over-completed bell */
    bell() {
      init();
      osc(660, 'sine', .16, .7);
      osc(990, 'sine', .10, .55, .12);
    },
  };
})();

/* ─────────────────────────────────────────────────────────────────
   CROWD — decorative animated dots
   ───────────────────────────────────────────────────────────────── */
function buildCrowd() {
  const wrap   = $('crowd-wrap');
  if (!wrap) return;
  const colors = ['#FFD700','#0047AB','#ffffff','#e63946','#00c9ff','#ffa500'];
  const count  = window.innerWidth < 500 ? 90 : 155;

  for (let i = 0; i < count; i++) {
    const d   = document.createElement('div');
    d.className = 'cdot';
    const sz  = 3 + Math.random() * 5;
    const dur = (1.1 + Math.random() * 1.5).toFixed(2);
    const del = (Math.random() * 2).toFixed(2);
    d.style.cssText = `
      width:${sz}px; height:${sz}px;
      left:${Math.random()*100}%;
      top:${4 + Math.random()*52}%;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      --dur:${dur}s; --del:-${del}s;
    `;
    wrap.appendChild(d);
  }
}

/* ─────────────────────────────────────────────────────────────────
   FLASH FX
   ───────────────────────────────────────────────────────────────── */
const flashEl = (() => {
  const el = document.createElement('div');
  el.id = 'flash';
  document.body.appendChild(el);
  return el;
})();

function flash(type) {
  flashEl.className = '';
  void flashEl.offsetWidth;
  flashEl.className = type;
}

/* ─────────────────────────────────────────────────────────────────
   SPARKS — particle burst
   ───────────────────────────────────────────────────────────────── */
function sparks(x, y, color, n = 20) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'spark';
    const a = Math.random() * Math.PI * 2;
    const r = 50 + Math.random() * 130;
    const s = 4 + Math.random() * 8;
    const d = (.45 + Math.random() * .55).toFixed(2);
    p.style.cssText = `
      width:${s}px; height:${s}px;
      background:${color}; left:${x}px; top:${y}px;
      --dx:${Math.cos(a)*r}px; --dy:${Math.sin(a)*r}px; --dur:${d}s;
    `;
    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

/* ─────────────────────────────────────────────────────────────────
   HUD — all display updates
   ───────────────────────────────────────────────────────────────── */
const HUD = {
  /** Refresh scoreboard strip */
  refresh() {
    DOM.ssRuns.textContent    = State.score;
    DOM.ssWickets.textContent = State.wickets;
    DOM.ssHs.textContent      = HighScore.get();
    // balls display: overs.balls e.g. 1.3
    const ov  = Math.floor(State.ballsFaced / 6);
    const bl  = State.ballsFaced % 6;
    DOM.ssBalls.textContent   = `${ov}.${bl}`;
    // Wicket life icons
    DOM.lifeIcons.forEach((icon, i) =>
      icon.classList.toggle('gone', i >= CONFIG.maxWickets - State.wickets
        ? i >= (CONFIG.maxWickets - State.wickets) : false));
    // Invert: icons left = lives remaining
    DOM.lifeIcons.forEach((icon, i) => {
      icon.classList.toggle('gone', i >= (CONFIG.maxWickets - State.wickets));
    });
  },

  /** Flash score gold */
  flashScore() {
    DOM.ssRuns.style.color = '#FFD700';
    setTimeout(() => { DOM.ssRuns.style.color = ''; }, 350);
  },

  /** Add an over dot */
  addDot(type) {
    const dot = document.createElement('div');
    dot.className = `over-dot ${type}`;
    DOM.dotRow.appendChild(dot);
    // Keep rolling window of last 6
    const dots = DOM.dotRow.querySelectorAll('.over-dot');
    if (dots.length > 6) dots[0].remove();
  },

  /** Update speed bar */
  updateSpeed() {
    const pct = Math.min(100,
      ((State.speedMult - 1) / (CONFIG.maxMult - 1)) * 100);
    DOM.smFill.style.width = `${Math.max(8, pct)}%`;
    DOM.smVal.textContent  = `${State.speedMult.toFixed(1)}x`;
    // Colour shift: gold → red at high speed
    DOM.smFill.style.background = pct > 55
      ? 'linear-gradient(90deg,#FFD700,#e63946)'
      : 'linear-gradient(90deg,#FFD700,#ff6b35)';
  },

  /** Shake score for big shot */
  bigShot() {
    DOM.ssRuns.style.transform = 'scale(1.4)';
    setTimeout(() => { DOM.ssRuns.style.transform = ''; }, 300);
  },
};

/* ─────────────────────────────────────────────────────────────────
   AI BOWLER — delivery variation
   ───────────────────────────────────────────────────────────────── */
const AIBowler = {
  /** Randomise ball's horizontal position each delivery */
  setDelivery() {
    const arenaW = DOM.arena.getBoundingClientRect().width;
    const types  = ['straight', 'wide_off', 'wide_leg', 'short', 'full'];
    const type   = types[Math.floor(Math.random() * types.length)];
    const mid    = arenaW / 2 - 19; // half ball width
    const diffs  = { easy: .5, medium: .78, hard: 1.0 };
    const scale  = diffs[State.difficulty] || .7;

    let offset = 0;
    if (type === 'wide_off') offset = -(16 + Math.random() * 26) * scale;
    if (type === 'wide_leg') offset =  (16 + Math.random() * 26) * scale;
    if (type === 'short')    offset =  (Math.random() - .5) * 18 * scale;
    if (type === 'full')     offset =  (Math.random() - .5) * 10 * scale;

    DOM.ball.style.left      = `${mid + offset}px`;
    DOM.ball.style.transform = 'none';
  },

  /** Animate bowler run-up */
  runUp() {
    DOM.bowler.style.animation = 'none';
    void DOM.bowler.offsetWidth;
    DOM.bowler.style.animation = '';
  },
};

/* ─────────────────────────────────────────────────────────────────
   BALL — drop physics + hit/miss logic
   ───────────────────────────────────────────────────────────────── */
const Ball = {
  reset() {
    DOM.ball.style.transition = 'none';
    DOM.ball.style.top        = '-48px';
    DOM.ball.classList.remove('glowing', 'hit-gold');
    void DOM.ball.offsetWidth;
  },

  drop() {
    if (!State.running) return;
    State.ballLive = true;
    State.canHit   = false;

    const cfg      = CONFIG.difficulty[State.difficulty];
    const arenaH   = DOM.arena.getBoundingClientRect().height;
    const landY    = arenaH - 72;
    const duration = Math.max(cfg.minMs, cfg.baseMs / State.speedMult);

    // Ball glow during flight
    DOM.ball.classList.add('glowing');
    DOM.ball.style.transition = `top ${duration}ms linear`;
    DOM.ball.style.top        = `${landY}px`;

    // AI bowler animation
    AIBowler.runUp();

    // Open hit window at ~65% of drop
    clearTimeout(State.windowTimer);
    State.windowTimer = setTimeout(() => {
      if (!State.running) return;
      State.canHit = true;
      DOM.ball.classList.remove('glowing');
    }, duration * 0.62);

    // Ball past — OUT
    State.dropTimer = setTimeout(() => {
      if (!State.running || !State.canHit) return;
      Ball.missed();
    }, duration + 50);
  },

  hit() {
    if (!State.canHit || !State.ballLive) return;
    State.canHit   = false;
    State.ballLive = false;
    clearTimeout(State.dropTimer);
    clearTimeout(State.windowTimer);

    // Select random runs
    const runs = CONFIG.runs[Math.floor(Math.random() * CONFIG.runs.length)];
    State.score     += runs;
    State.ballsFaced++;
    if (runs >= 4) State.boundaries++;

    // Ball visual
    DOM.ball.classList.add('hit-gold');
    DOM.ball.style.transition = 'top .12s ease-out';
    DOM.ball.style.top        = '-60px';

    // Batsman swing
    DOM.batsman.classList.remove('swing');
    void DOM.batsman.offsetWidth;
    DOM.batsman.classList.add('swing');
    setTimeout(() => DOM.batsman.classList.remove('swing'), 350);

    // Score burst
    Ball.showBurst(runs);

    // Sparks at ball
    const br  = DOM.ball.getBoundingClientRect();
    const cx  = br.left + br.width / 2;
    const cy  = br.top  + br.height / 2;
    const col = runs === 6 ? '#a855f7' : runs === 4 ? '#22d3ee' : '#FFD700';
    sparks(cx, cy, col, runs >= 4 ? 32 : 18);

    // Flash + sound
    flash('gold');
    Sound.hit(runs);
    if (runs >= 4) { Sound.cheer(); HUD.bigShot(); }

    // HUD
    HUD.refresh();
    HUD.flashScore();
    const dotType = runs === 6 ? 'six' : runs === 4 ? 'four' : 'scored';
    HUD.addDot(dotType);
    Ball.increaseSpeed();

    // Next ball
    setTimeout(() => {
      Ball.reset();
      AIBowler.setDelivery();
      setTimeout(() => Ball.drop(), 650);
    }, 950);
  },

  missed() {
    State.ballLive = false;
    State.canHit   = false;
    clearTimeout(State.dropTimer);
    clearTimeout(State.windowTimer);

    State.wickets++;
    State.ballsFaced++;

    // Ball continues off screen
    DOM.ball.style.transition = 'top .18s ease-in';
    const arenaH = DOM.arena.getBoundingClientRect().height;
    DOM.ball.style.top = `${arenaH + 60}px`;

    // Stumps wobble
    Ball.wobbleStumps();
    flash('red');
    Sound.wicket();
    HUD.refresh();
    HUD.addDot('wicket');

    if (State.wickets >= CONFIG.maxWickets) {
      setTimeout(() => Game.over(), 750);
    } else {
      setTimeout(() => {
        Ball.reset();
        AIBowler.setDelivery();
        setTimeout(() => Ball.drop(), 800);
      }, 950);
    }
  },

  showBurst(runs) {
    const labels = { 1: '1', 2: '2', 4: 'FOUR! 🌟', 6: 'SIX! 💥' };
    const colors = { 1: '#76c442', 2: '#22d3ee', 4: '#FFD700', 6: '#ff3fa4' };
    DOM.burst.textContent = labels[runs] || runs;
    DOM.burst.style.color = colors[runs] || '#FFD700';
    DOM.burst.classList.remove('pop');
    void DOM.burst.offsetWidth;
    DOM.burst.classList.add('pop');
  },

  increaseSpeed() {
    const cfg = CONFIG.difficulty[State.difficulty];
    State.speedMult = Math.min(
      CONFIG.maxMult,
      State.speedMult + cfg.accel / 1000
    );
    HUD.updateSpeed();
  },

  wobbleStumps() {
    DOM.stumps.style.transform = 'translateX(-50%) rotate(-7deg)';
    setTimeout(() => { DOM.stumps.style.transform = 'translateX(-50%) rotate(7deg)'; }, 90);
    setTimeout(() => { DOM.stumps.style.transform = 'translateX(-50%) rotate(0)'; },    180);
  },
};

/* ─────────────────────────────────────────────────────────────────
   SCREEN MANAGER
   ───────────────────────────────────────────────────────────────── */
function showScreen(name) {
  Object.values(DOM.screens).forEach(s => s.classList.remove('active'));
  DOM.screens[name].classList.add('active');
}

/* ─────────────────────────────────────────────────────────────────
   GAME CONTROLLER
   ───────────────────────────────────────────────────────────────── */
const Game = {
  /** Kick off the toss sequence */
  toss(call) {
    Sound.init();
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won    = (call === result);

    // Spin coin
    DOM.coin.classList.remove('spinning');
    void DOM.coin.offsetWidth;
    DOM.coin.classList.add('spinning');

    // Disable toss buttons during animation
    DOM.btnHeads.disabled = true;
    DOM.btnTails.disabled = true;

    setTimeout(() => {
      DOM.coin.classList.remove('spinning');
      // Show coin face
      DOM.coin.style.transform = result === 'heads' ? 'rotateY(0deg)' : 'rotateY(180deg)';
      DOM.tossResult.textContent = won
        ? `YOU WIN THE TOSS! 🎉`
        : `TOSS LOST — ${result.toUpperCase()}`;
      DOM.tossChoose.classList.add('d-none');
      DOM.tossDiff.classList.remove('d-none');
      DOM.tossHs.textContent = HighScore.get();
      Sound.tossWhistle();
    }, 1900);
  },

  /** Start batting */
  start() {
    State.reset();
    DOM.dotRow.innerHTML    = '';
    DOM.btnHit.disabled     = false;
    HUD.refresh();
    HUD.updateSpeed();
    DOM.ssHs.textContent    = HighScore.get();
    showScreen('game');

    Ball.reset();
    AIBowler.setDelivery();
    setTimeout(() => Ball.drop(), 900);
  },

  /** End of innings */
  over() {
    State.running = false;
    clearTimeout(State.dropTimer);
    clearTimeout(State.windowTimer);

    const isNew = HighScore.update(State.score);
    const hs    = HighScore.get();
    const ov    = Math.floor(State.ballsFaced / 6);
    const bl    = State.ballsFaced % 6;
    const oppScore = Math.max(0, State.score - (5 + Math.floor(Math.random() * 20)));

    // Populate over screen
    DOM.ovBalls.textContent      = `${ov}.${bl}`;
    DOM.ovHs.textContent         = hs;
    DOM.ovBoundaries.textContent = State.boundaries;
    DOM.mcScore.innerHTML        = `${State.score}<span class="mc-wickets">/${State.wickets}</span>`;
    DOM.mcOpp.textContent        = State.score > 0 ? oppScore : '—';

    if (State.score === 0) {
      DOM.overHeadline.textContent = 'GOLDEN DUCK! 🦆';
      DOM.overSub.textContent      = 'Paltan needs you — try again!';
      DOM.overTrophy.textContent   = '🦆';
    } else if (isNew) {
      DOM.overHeadline.textContent = 'NEW HIGH SCORE!';
      DOM.overSub.textContent      = `${State.score} runs — Paltan is proud!`;
      DOM.overTrophy.textContent   = '🏆';
      DOM.nhBadge.classList.remove('d-none');
      Sound.cheer();
    } else if (State.score >= 60) {
      DOM.overHeadline.textContent = 'BRILLIANT INNINGS!';
      DOM.overSub.textContent      = 'That\'s IPL-level batting!';
      DOM.overTrophy.textContent   = '🌟';
      DOM.nhBadge.classList.add('d-none');
    } else {
      DOM.overHeadline.textContent = 'INNINGS OVER!';
      DOM.overSub.textContent      = 'The Paltan needs you!';
      DOM.overTrophy.textContent   = '🏏';
      DOM.nhBadge.classList.add('d-none');
    }

    // Update splash HS for when player returns to toss
    DOM.tossHs.textContent = hs;
    showScreen('over');
  },

  restart() {
    DOM.nhBadge.classList.add('d-none');
    Game.start();
  },

  backToToss() {
    DOM.nhBadge.classList.add('d-none');
    State.running = false;
    clearTimeout(State.dropTimer);
    clearTimeout(State.windowTimer);
    // Reset toss screen to initial state
    DOM.tossChoose.classList.remove('d-none');
    DOM.tossDiff.classList.add('d-none');
    DOM.tossResult.textContent = '\u00a0';
    DOM.coin.style.transform   = '';
    DOM.btnHeads.disabled      = false;
    DOM.btnTails.disabled      = false;
    DOM.tossHs.textContent     = HighScore.get();
    showScreen('toss');
  },
};

/* ─────────────────────────────────────────────────────────────────
   INPUT — all event bindings
   ───────────────────────────────────────────────────────────────── */
const Input = {
  init() {
    /* Toss */
    DOM.btnHeads.addEventListener('click', () => {
      Sound.init(); Game.toss('heads');
    });
    DOM.btnTails.addEventListener('click', () => {
      Sound.init(); Game.toss('tails');
    });

    /* Difficulty */
    DOM.diffBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        DOM.diffBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        State.difficulty = btn.dataset.diff;
      });
    });

    /* Start batting */
    DOM.btnBat.addEventListener('click', () => {
      Sound.init(); Game.start();
    });

    /* HIT button */
    DOM.btnHit.addEventListener('click', () => {
      Sound.init();
      if (State.canHit) Ball.hit();
    });

    /* Click/tap directly on ball */
    DOM.ball.addEventListener('click', () => {
      Sound.init();
      if (State.canHit) Ball.hit();
    });

    /* Keyboard: Space / Enter */
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        Sound.init();
        if (State.running && State.canHit) Ball.hit();
      }
    });

    /* Game Over buttons */
    DOM.btnRestart.addEventListener('click', () => {
      Sound.init(); Game.restart();
    });
    DOM.btnTossScreen.addEventListener('click', () => {
      Game.backToToss();
    });
  },
};

/* ─────────────────────────────────────────────────────────────────
   BOOT
   ───────────────────────────────────────────────────────────────── */
function boot() {
  buildCrowd();
  Input.init();
  DOM.tossHs.textContent = HighScore.get();
  showScreen('toss');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
