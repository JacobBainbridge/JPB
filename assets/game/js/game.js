/**
 * BOOKED! — Aim Trainer
 * ---------------------------------------------------------------------
 * Pure HTML/CSS/JS, no frameworks/build step. Organised into small
 * modules (config, pool, audio, leaderboard, effects, spawner, game)
 * that share state through the single `state` object below.
 *
 * Notable design decisions (documented since the spec left them open):
 *  - Scoring/combo commit at the moment a target is tapped, not when
 *    the projectile lands, so a target can never expire mid-flight.
 *    Visually the target freezes in place and stops accepting input
 *    the instant it's tapped; the stamp + score pop happen on arrival.
 *  - Tapping a target that's already been committed (mid-flight or
 *    expiring) falls through to the play area's own tap handler and
 *    is scored as a miss, per spec.
 *  - "Play Again" restarts straight into the countdown with the same
 *    name rather than returning to the name-entry screen.
 * ---------------------------------------------------------------------
 */
(() => {
  'use strict';

  /* ======================================================================
     CONFIG
     ====================================================================== */
  const GAME_DURATION = 60;        // seconds
  const MAX_TARGETS = 6;           // concurrent cap
  const HIT_SCORE = 20;
  const MISS_PENALTY = 5;
  const LEADERBOARD_KEY = 'jpb_booked_leaderboard_v1';
  const LEADERBOARD_MAX = 10;

  const TIERS = [
    { name: 'near', sizeFactor: 0.30, minPx: 76, maxPx: 128, weight: 0.40, z: 30 },
    { name: 'mid', sizeFactor: 0.225, minPx: 56, maxPx: 92, weight: 0.35, z: 20 },
    { name: 'far', sizeFactor: 0.155, minPx: 38, maxPx: 64, weight: 0.25, z: 10 },
  ];

  // Difficulty phases — spawn cadence, on-screen lifetime, and drift speed
  // all escalate across the four windows described in the spec.
  const PHASES = [
    { end: 10, spawnMin: 1300, spawnMax: 1700, visMin: 2100, visMax: 2600, drift: false, driftSpeed: 0 },
    { end: 30, spawnMin: 850, spawnMax: 1100, visMin: 1350, visMax: 1750, drift: false, driftSpeed: 0 },
    { end: 50, spawnMin: 700, spawnMax: 900, visMin: 1250, visMax: 1550, drift: true, driftSpeed: 22 },
    { end: 60, spawnMin: 420, spawnMax: 620, visMin: 900, visMax: 1150, drift: true, driftSpeed: 48 },
  ];

  const ROLE_EMOJIS = ['🎬', '🎮', '📺', '🎙️', '🎧', '💼', '🎭', '🌟'];

  const END_TIERS = [
    { min: 0, max: 0, text: () => 'No callbacks this time. Better luck next time!' },
    { min: 1, max: 4, text: (n) => `A few nibbles — Jacob's agent is intrigued. You booked him <strong>${n}</strong> role${n === 1 ? '' : 's'}.` },
    { min: 5, max: 9, text: (n) => `Solid audition! You just cast Jacob for <strong>${n}</strong> roles!` },
    { min: 10, max: 15, text: (n) => `Stacked schedule! You just cast Jacob for <strong>${n}</strong> roles!` },
    { min: 16, max: 24, text: (n) => `Award-season run! You just cast Jacob for <strong>${n}</strong> roles!` },
    { min: 25, max: Infinity, text: (n) => `Legendary. Jacob's booked solid for years — <strong>${n}</strong> roles!` },
  ];

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const manifest = (window.GAME_MANIFEST && window.GAME_MANIFEST.length)
    ? window.GAME_MANIFEST
    : ['Target1.png'];
  const HEADSHOT_BASE = 'assets/game/headshots/';

  /* ======================================================================
     DOM REFS
     ====================================================================== */
  const screens = {
    start: document.getElementById('screen-start'),
    countdown: document.getElementById('screen-countdown'),
    play: document.getElementById('screen-play'),
    end: document.getElementById('screen-end'),
    leaderboard: document.getElementById('screen-leaderboard'),
  };
  const phoneFrame = document.getElementById('phoneFrame');
  const playArea = document.getElementById('playArea');
  const launcher = document.getElementById('launcher');
  const countdownDisplay = document.getElementById('countdownDisplay');
  const hudScore = document.getElementById('hudScore');
  const hudTime = document.getElementById('hudTime');
  const hudTimeStat = document.querySelector('.g-hud-time');
  const hudCombo = document.getElementById('hudCombo');
  const startForm = document.getElementById('startForm');
  const playerNameInput = document.getElementById('playerName');
  const startBtn = document.getElementById('startBtn');
  const endScoreEl = document.getElementById('endScore');
  const endMessageEl = document.getElementById('endMessage');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const shareBtn = document.getElementById('shareBtn');
  const boardBackBtn = document.getElementById('boardBackBtn');
  const boardList = document.getElementById('boardList');
  const boardEmpty = document.getElementById('boardEmpty');
  const toast = document.getElementById('toast');
  const muteBtn = document.getElementById('muteBtn');
  const bgMusic = document.getElementById('bgMusic');
  const cheerSfx = document.getElementById('cheerSfx');

  bgMusic.volume = 0.35;
  cheerSfx.volume = 0.55;

  /* ======================================================================
     UTILITIES
     ====================================================================== */
  const rand = (min, max) => Math.random() * (max - min) + min;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function weightedTier() {
    const total = TIERS.reduce((s, t) => s + t.weight, 0);
    let r = Math.random() * total;
    for (const t of TIERS) {
      if (r < t.weight) return t;
      r -= t.weight;
    }
    return TIERS[TIERS.length - 1];
  }

  let lastImage = null;
  function pickImage() {
    const pool = manifest.length > 1 ? manifest.filter((f) => f !== lastImage) : manifest;
    const img = pool[Math.floor(Math.random() * pool.length)];
    lastImage = img;
    return img;
  }

  function getPhase(elapsedSec) {
    for (const p of PHASES) {
      if (elapsedSec < p.end) return p;
    }
    return PHASES[PHASES.length - 1];
  }

  function showScreen(name) {
    Object.values(screens).forEach((el) => { el.hidden = true; });
    screens[name].hidden = false;
  }

  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  /* ======================================================================
     ELEMENT POOLS (targets + projectiles are reused, not recreated)
     ====================================================================== */
  class ElementPool {
    constructor(factory) {
      this.factory = factory;
      this.free = [];
    }
    acquire() {
      return this.free.pop() || this.factory();
    }
    release(el) {
      if (el.parentNode) el.parentNode.removeChild(el);
      // Defensive reset: whatever put this element in the DOM (hit, miss,
      // expiry, etc.) may have left inline styles/state behind (e.g.
      // pointer-events:none). Never let that leak into the next reuse.
      el.style.pointerEvents = '';
      this.free.push(el);
    }
  }

  function createTargetElement() {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'g-target';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    const stamp = document.createElement('div');
    stamp.className = 'g-stamp';
    const stampText = document.createElement('span');
    stampText.className = 'g-stamp-text';
    stampText.textContent = 'BOOKED';
    stamp.appendChild(stampText);
    el.appendChild(stamp);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ref = el._targetRef;
      if (ref) onTargetTapped(ref);
    });
    return el;
  }

  function createProjectileElement() {
    const el = document.createElement('span');
    el.className = 'g-projectile';
    el.textContent = '✉️';
    return el;
  }

  const targetPool = new ElementPool(createTargetElement);
  const projectilePool = new ElementPool(createProjectileElement);

  /* ======================================================================
     AUDIO
     ====================================================================== */
  let muted = false;
  function playCheer() {
    if (muted) return;
    try {
      cheerSfx.currentTime = 0;
      cheerSfx.play().catch(() => {});
    } catch (e) { /* noop */ }
  }
  function startMusic() {
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => {});
  }
  function stopMusic() {
    bgMusic.pause();
  }
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    bgMusic.muted = muted;
    cheerSfx.muted = muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', String(muted));
  });

  /* ======================================================================
     LEADERBOARD (localStorage)
     ====================================================================== */
  function getBoard() {
    try {
      const raw = localStorage.getItem(LEADERBOARD_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function addToBoard(name, score, roles) {
    const list = getBoard();
    list.push({ name, score, roles, date: new Date().toISOString() });
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, LEADERBOARD_MAX);
    try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(top)); } catch (e) { /* storage unavailable */ }
    return top;
  }
  function renderBoard() {
    const list = getBoard();
    boardList.innerHTML = '';
    boardEmpty.hidden = list.length > 0;
    list.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'g-board-row';

      const rank = document.createElement('span');
      rank.className = 'g-board-rank';
      rank.textContent = `#${i + 1}`;

      const name = document.createElement('span');
      name.className = 'g-board-name';
      name.textContent = entry.name || 'Player'; // textContent — never innerHTML with stored names
      const small = document.createElement('small');
      const d = new Date(entry.date);
      small.textContent = `${entry.roles} roles · ${Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()}`;
      name.appendChild(small);

      const score = document.createElement('span');
      score.className = 'g-board-score';
      score.textContent = entry.score;

      li.append(rank, name, score);
      boardList.appendChild(li);
    });
  }

  let boardReturnScreen = 'start';
  document.querySelectorAll('[data-open-board]').forEach((btn) => {
    btn.addEventListener('click', () => {
      boardReturnScreen = screens.start.hidden ? 'end' : 'start';
      renderBoard();
      showScreen('leaderboard');
    });
  });
  boardBackBtn.addEventListener('click', () => showScreen(boardReturnScreen));

  /* ======================================================================
     GAME STATE
     ====================================================================== */
  const state = {
    running: false,
    playerName: 'Player',
    score: 0,
    combo: 0,
    roles: 0,
    startTime: 0,
    lastFrame: 0,
    activeTargets: new Map(),
    driftSet: new Set(),
    spawnTimeoutId: null,
    idCounter: 0,
    safeTop: 90,
    safeBottom: 120,
  };

  function elapsed() {
    return (performance.now() - state.startTime) / 1000;
  }

  /* ======================================================================
     HUD
     ====================================================================== */
  function bumpHud(el) {
    el.classList.remove('is-pop');
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth; // restart animation
    el.classList.add('is-pop');
  }

  function updateScoreHud() {
    hudScore.textContent = state.score;
    bumpHud(hudScore);
  }

  function updateComboHud() {
    hudCombo.textContent = `x${state.combo}`;
    if (state.combo >= 2) {
      hudCombo.classList.add('is-visible');
      bumpHud(hudCombo);
    } else {
      hudCombo.classList.remove('is-visible');
    }
    if (!reduceMotion) {
      if (state.combo > 0 && state.combo % 20 === 0) {
        shakeScreen(true);
      } else if (state.combo > 0 && state.combo % 10 === 0) {
        shakeScreen(false);
      }
    }
  }

  let shakeTimer = null;
  function shakeScreen(big) {
    phoneFrame.classList.remove('is-shaking', 'is-shaking-big');
    void phoneFrame.offsetWidth;
    phoneFrame.classList.add(big ? 'is-shaking-big' : 'is-shaking');
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => phoneFrame.classList.remove('is-shaking', 'is-shaking-big'), 500);
  }

  function updateTimeHud(remaining) {
    hudTime.textContent = Math.max(0, Math.ceil(remaining));
    hudTimeStat.classList.toggle('is-low', remaining <= 10);
  }

  /* ======================================================================
     EFFECTS
     ====================================================================== */
  function spawnParticles(x, y) {
    const count = reduceMotion ? 0 : 8;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'g-particle';
      const angle = (Math.PI * 2 * i) / count + rand(-0.2, 0.2);
      const dist = rand(24, 48);
      p.style.setProperty('--g-px', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--g-py', `${Math.sin(angle) * dist}px`);
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      playArea.appendChild(p);
      p.addEventListener('animationend', () => p.remove());
    }
  }

  function spawnFloatEmoji(x, y) {
    const el = document.createElement('span');
    el.className = 'g-float-emoji';
    el.textContent = ROLE_EMOJIS[Math.floor(Math.random() * ROLE_EMOJIS.length)];
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    playArea.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function spawnMissMark(x, y) {
    const el = document.createElement('span');
    el.className = 'g-miss-mark';
    el.textContent = 'MISS';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    playArea.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function flashMiss() {
    playArea.classList.remove('is-miss-flash');
    void playArea.offsetWidth;
    playArea.classList.add('is-miss-flash');
  }

  /* ======================================================================
     SCORING
     ====================================================================== */
  function registerHit() {
    state.score += HIT_SCORE;
    state.combo += 1;
    state.roles += 1;
    updateScoreHud();
    updateComboHud();
  }

  function registerMiss(x, y) {
    state.score = Math.max(0, state.score - MISS_PENALTY);
    state.combo = 0;
    updateScoreHud();
    updateComboHud();
    if (x != null) {
      spawnMissMark(x, y);
      flashMiss();
    }
  }

  /* ======================================================================
     TARGETS
     ====================================================================== */
  function pickPosition(radius) {
    const w = playArea.clientWidth;
    const h = playArea.clientHeight;
    const top = state.safeTop + radius;
    const bottom = h - state.safeBottom - radius;
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = rand(radius, w - radius);
      const y = rand(top, Math.max(top + 1, bottom));
      let ok = true;
      for (const t of state.activeTargets.values()) {
        const dist = Math.hypot(t.x - x, t.y - y);
        if (dist < (radius + t.r) * 0.72) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return { x: rand(radius, w - radius), y: rand(top, Math.max(top + 1, bottom)) };
  }

  function spawnTarget() {
    const phase = getPhase(elapsed());
    const tier = weightedTier();
    const w = playArea.clientWidth;
    const size = clamp(Math.round(w * tier.sizeFactor), tier.minPx, tier.maxPx);
    const radius = size / 2;
    const pos = pickPosition(radius);

    const el = targetPool.acquire();
    el.style.pointerEvents = ''; // guard against any leaked state from a previous reuse
    el.className = `g-target tier-${tier.name}`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.zIndex = String(tier.z);
    el.style.backgroundImage = `url('${HEADSHOT_BASE}${pickImage()}')`;
    playArea.appendChild(el);

    const id = ++state.idCounter;
    const ref = {
      id,
      el,
      state: 'active',
      x: pos.x,
      y: pos.y,
      r: radius,
      vx: 0,
      vy: 0,
      expireTimeoutId: null,
    };
    el._targetRef = ref;
    state.activeTargets.set(id, ref);

    // pop-in
    requestAnimationFrame(() => el.classList.add('is-in'));

    if (phase.drift && !reduceMotion) {
      const angle = rand(0, Math.PI * 2);
      ref.vx = Math.cos(angle) * phase.driftSpeed;
      ref.vy = Math.sin(angle) * phase.driftSpeed;
      state.driftSet.add(ref);
    }

    const visDuration = rand(phase.visMin, phase.visMax);
    ref.expireTimeoutId = setTimeout(() => handleExpire(ref), visDuration);

    return ref;
  }

  function removeTarget(ref) {
    state.activeTargets.delete(ref.id);
    state.driftSet.delete(ref);
    clearTimeout(ref.expireTimeoutId);
    ref.el._targetRef = null;
    targetPool.release(ref.el);
  }

  function handleExpire(ref) {
    if (ref.state !== 'active') return;
    ref.state = 'expired';
    state.driftSet.delete(ref);
    ref.el.style.pointerEvents = 'none';
    ref.el.classList.add('is-expiring');
    registerMiss(ref.x, ref.y);
    setTimeout(() => removeTarget(ref), 420);
  }

  function onTargetTapped(ref) {
    if (ref.state !== 'active') return; // safety; pointer-events already blocks this
    ref.state = 'committed';
    clearTimeout(ref.expireTimeoutId);
    state.driftSet.delete(ref);
    ref.el.style.pointerEvents = 'none';

    // Score/combo commit the instant the tap registers — don't make the
    // player wait for the projectile to land before they get feedback.
    // Without this, short-lived targets + travel time made legitimate
    // taps feel like misses (a frustrated re-tap on the now-frozen
    // target would then fall through and register as a real miss).
    registerHit();

    // Immediate visual acknowledgement while the email is still in flight.
    ref.el.classList.add('is-committed');

    launchProjectile(ref);
  }

  /* ======================================================================
     LAUNCHER + PROJECTILE
     ====================================================================== */
  let fingerTimer = null;
  function swipeFinger() {
    launcher.classList.remove('is-swiping');
    void launcher.offsetWidth;
    launcher.classList.add('is-swiping');
    clearTimeout(fingerTimer);
    fingerTimer = setTimeout(() => launcher.classList.remove('is-swiping'), 420);
  }

  function launchProjectile(ref) {
    swipeFinger();
    const areaRect = playArea.getBoundingClientRect();
    const launcherRect = launcher.querySelector('.g-launcher-phone').getBoundingClientRect();
    const startX = launcherRect.left + launcherRect.width / 2 - areaRect.left;
    const startY = launcherRect.top + launcherRect.height / 2 - areaRect.top;
    const endX = ref.x;
    const endY = ref.y;

    const el = projectilePool.acquire();
    el.style.left = '0px';
    el.style.top = '0px';
    playArea.appendChild(el);

    const dist = Math.hypot(endX - startX, endY - startY);
    const duration = reduceMotion ? 1 : clamp(220 + dist * 0.4, 260, 480);
    const arcHeight = clamp(dist * 0.35, 60, 150);
    const t0 = performance.now();

    function tick(now) {
      const t = clamp((now - t0) / duration, 0, 1);
      const x = startX + (endX - startX) * t;
      const yLinear = startY + (endY - startY) * t;
      const y = yLinear - arcHeight * 4 * t * (1 - t);
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        projectilePool.release(el);
        resolveHit(ref);
      }
    }
    requestAnimationFrame(tick);
  }

  function resolveHit(ref) {
    if (!state.activeTargets.has(ref.id)) return; // game may have ended mid-flight
    ref.el.classList.remove('is-committed');
    ref.el.classList.add('is-hit');
    ref.el.classList.add('is-booked-out');
    playCheer();
    spawnParticles(ref.x, ref.y);
    spawnFloatEmoji(ref.x, ref.y);
    setTimeout(() => removeTarget(ref), 820);
  }

  /* ======================================================================
     EMPTY-AREA TAP = MISS (also catches taps on frozen/expiring targets,
     since those have pointer-events:none and the event falls through)
     ====================================================================== */
  playArea.addEventListener('pointerdown', (e) => {
    if (!state.running) return;
    if (e.target !== playArea) return;
    const rect = playArea.getBoundingClientRect();
    registerMiss(e.clientX - rect.left, e.clientY - rect.top);
  });

  /* Prevent rubber-band scroll/selection during active gameplay only,
     so the leaderboard list can still scroll on other screens. */
  document.addEventListener('touchmove', (e) => {
    if (state.running) e.preventDefault();
  }, { passive: false });

  /* ======================================================================
     DRIFT + MAIN LOOP
     ====================================================================== */
  function driftTick(dt) {
    if (!state.driftSet.size) return;
    const w = playArea.clientWidth;
    const h = playArea.clientHeight;
    const top = state.safeTop;
    const bottom = h - state.safeBottom;
    state.driftSet.forEach((t) => {
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      if (t.x < t.r) { t.x = t.r; t.vx *= -1; }
      if (t.x > w - t.r) { t.x = w - t.r; t.vx *= -1; }
      if (t.y < top + t.r) { t.y = top + t.r; t.vy *= -1; }
      if (t.y > bottom - t.r) { t.y = bottom - t.r; t.vy *= -1; }
      t.el.style.left = `${t.x}px`;
      t.el.style.top = `${t.y}px`;
    });
  }

  function mainLoop(now) {
    if (!state.running) return;
    const dt = state.lastFrame ? Math.min((now - state.lastFrame) / 1000, 0.05) : 0;
    state.lastFrame = now;

    const remaining = GAME_DURATION - elapsed();
    updateTimeHud(remaining);
    driftTick(dt);

    if (remaining <= 0) {
      endGame();
      return;
    }
    requestAnimationFrame(mainLoop);
  }

  /* ======================================================================
     SPAWNER
     ====================================================================== */
  function scheduleSpawn() {
    if (!state.running) return;
    const phase = getPhase(elapsed());
    const delay = rand(phase.spawnMin, phase.spawnMax);
    state.spawnTimeoutId = setTimeout(() => {
      if (!state.running) return;
      if (state.activeTargets.size < MAX_TARGETS) spawnTarget();
      scheduleSpawn();
    }, delay);
  }

  /* ======================================================================
     GAME FLOW
     ====================================================================== */
  function clearAllTargets() {
    Array.from(state.activeTargets.values()).forEach((ref) => {
      clearTimeout(ref.expireTimeoutId);
      ref.el._targetRef = null;
      if (ref.el.parentNode) ref.el.parentNode.removeChild(ref.el);
    });
    state.activeTargets.clear();
    state.driftSet.clear();
    // any pooled elements left mid-animation in the DOM: sweep play area
    playArea.querySelectorAll('.g-target, .g-projectile, .g-particle, .g-float-emoji, .g-miss-mark')
      .forEach((el) => el.remove());
  }

  function computeSafeZones() {
    const hudRect = document.querySelector('.g-hud').getBoundingClientRect();
    const launcherRect = launcher.getBoundingClientRect();
    const areaRect = playArea.getBoundingClientRect();
    state.safeTop = Math.max(70, hudRect.bottom - areaRect.top + 12);
    state.safeBottom = Math.max(100, areaRect.bottom - launcherRect.top + 16);
  }

  function startGameplay() {
    state.score = 0;
    state.combo = 0;
    state.roles = 0;
    state.idCounter = 0;
    state.lastFrame = 0;
    clearAllTargets();
    updateScoreHud();
    updateComboHud();
    updateTimeHud(GAME_DURATION);

    showScreen('play');
    computeSafeZones();
    startMusic();

    state.running = true;
    state.startTime = performance.now();
    requestAnimationFrame(mainLoop);
    scheduleSpawn();
  }

  function runCountdown() {
    showScreen('countdown');
    const seq = ['3', '2', '1', 'GO!'];
    let i = 0;
    function step() {
      countdownDisplay.innerHTML = '';
      if (i >= seq.length) { startGameplay(); return; }
      const val = seq[i];
      const el = document.createElement('div');
      el.className = val === 'GO!' ? 'g-countdown-go' : 'g-countdown-num';
      el.textContent = val;
      countdownDisplay.appendChild(el);
      i++;
      setTimeout(step, val === 'GO!' ? 550 : 700);
    }
    step();
  }

  function getEndMessageHtml(roles) {
    const tier = END_TIERS.find((t) => roles >= t.min && roles <= t.max) || END_TIERS[END_TIERS.length - 1];
    return tier.text(roles);
  }

  function endGame() {
    state.running = false;
    clearTimeout(state.spawnTimeoutId);
    clearAllTargets();
    stopMusic();

    addToBoard(state.playerName, state.score, state.roles);

    endScoreEl.textContent = state.score;
    endMessageEl.innerHTML = getEndMessageHtml(state.roles); // static template strings only, no raw user input
    showScreen('end');
  }

  /* ======================================================================
     UI WIRING
     ====================================================================== */
  playerNameInput.addEventListener('input', () => {
    startBtn.disabled = playerNameInput.value.trim().length === 0;
  });

  startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = playerNameInput.value.trim().slice(0, 18);
    if (!name) return;
    state.playerName = name;
    runCountdown();
  });

  playAgainBtn.addEventListener('click', () => {
    runCountdown();
  });

  shareBtn.addEventListener('click', () => {
    const text = `I just booked Jacob Piripi Bainbridge for ${state.roles} role${state.roles === 1 ? '' : 's'} and scored ${state.score} points playing BOOKED! Think you can beat me?`;
    const url = window.location.href.split('#')[0];
    if (navigator.share) {
      navigator.share({ title: 'BOOKED! — Aim Trainer', text, url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${text} ${url}`)
        .then(() => showToast('Copied to clipboard!'))
        .catch(() => showToast('Could not copy — try manually.'));
    } else {
      showToast('Sharing not supported on this browser.');
    }
  });

  /* Prevent the phone-frame chrome (finger emoji, stamp text) from being
     selected/dragged on desktop. */
  document.addEventListener('dragstart', (e) => e.preventDefault());
})();
