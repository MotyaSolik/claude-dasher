/* Claude Dash — rendering, input, audio, menus, level editor. */
(function () {
  'use strict';
  const { C, LEVELS, DIFFS, buildLevel, buildCustom, newPlayer, step } = DashCore;
  const $ = (id) => document.getElementById(id);
  const canvas = $('c'), ctx = canvas.getContext('2d');

  // ---------- storage (safe) ----------
  const store = {
    data: { char: 'claude', diff: 'hard', best: {}, sound: true, custom: [] },
    load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem('claudedash') || '{}')); } catch (e) {} },
    save() { try { localStorage.setItem('claudedash', JSON.stringify(this.data)); } catch (e) {} },
  };
  store.load();
  if (!Array.isArray(store.data.custom)) store.data.custom = [];

  // ---------- heroes ----------
  const CHARS = [
    { id: 'claude', name: 'Claude', src: 'img/claude.png', colors: ['#e07b55', '#f4a27f', '#ffffff'] },
    { id: 'pig', name: 'Хрюша', src: 'img/pig.png', colors: ['#e2b9a0', '#f1c9b4', '#c98f86'] },
  ];
  for (const ch of CHARS) { ch.img = new Image(); ch.img.src = ch.src; }
  const heroById = (id) => CHARS.find((c) => c.id === id) || CHARS[0];

  const emit = (ev, a, b) => { if (window.DashMods) DashMods.emit(ev, a, b); };
  const hooked = (ev) => !!(window.DashMods && DashMods.has(ev));
  const MODE_NAME = { cube: 'Куб', ship: 'Корабль', wave: 'Волна' };
  const MODE_COL = { cube: '#ffa24a', ship: '#ff4d9a', wave: '#4dd8ff' };

  // ---------- audio ----------
  const Snd = {
    ctx: null, master: null, timer: null, nextT: 0, stepI: 0, bpm: 138, root: 55, playing: false,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.32; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    },
    on() { return store.data.sound && this.ctx; },
    osc(type, f0, f1, t, dur, vol) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(t, dur, vol, hp) {
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      s.buffer = this.noiseBuf; f.type = 'highpass'; f.frequency.value = hp;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
    },
    jump() { if (!this.on()) return; const t = this.ctx.currentTime; this.osc('square', 300, 640, t, 0.09, 0.06); },
    pad() { if (!this.on()) return; const t = this.ctx.currentTime; this.osc('triangle', 400, 1200, t, 0.18, 0.12); },
    portal() { if (!this.on()) return; const t = this.ctx.currentTime; this.osc('sine', 200, 1400, t, 0.3, 0.14); this.osc('triangle', 1400, 300, t + 0.05, 0.25, 0.07); },
    die() { if (!this.on()) return; const t = this.ctx.currentTime; this.noise(t, 0.32, 0.5, 300); this.osc('sawtooth', 220, 40, t, 0.35, 0.18); },
    win() { if (!this.on()) return; const t = this.ctx.currentTime;[523, 659, 784, 1047].forEach((f, i) => this.osc('square', f, f, t + i * 0.1, 0.25, 0.08)); },
    musicStart(root) {
      this.musicStop(); if (!this.on()) return;
      this.root = root; this.stepI = 0; this.nextT = this.ctx.currentTime + 0.06; this.playing = true;
      this.timer = setInterval(() => this.schedule(), 40);
    },
    musicStop() { this.playing = false; if (this.timer) { clearInterval(this.timer); this.timer = null; } },
    schedule() {
      if (!this.playing || !this.ctx) return;
      const spb = 60 / this.bpm / 4; // 16th
      while (this.nextT < this.ctx.currentTime + 0.18) {
        const i = this.stepI, t = this.nextT, bar = Math.floor(i / 16) % 4, s = i % 16;
        if (s % 4 === 0) { this.osc('sine', 150, 42, t, 0.16, 0.5); }
        if (s === 4 || s === 12) this.noise(t, 0.12, 0.16, 1800);
        if (s % 2 === 0) this.noise(t, 0.04, 0.05, 7000);
        const chord = [0, 0, 5, 3][bar], scale = [0, 3, 7, 10, 12, 10, 7, 3];
        const semi = chord + [0, 0, 12, 0, 7, 0, 12, 7][s % 8];
        if (s % 2 === 0 || s % 8 === 7) this.osc('sawtooth', this.root * Math.pow(2, semi / 12), this.root * Math.pow(2, semi / 12), t, spb * 1.6, 0.11);
        if (s % 2 === 1) { const n = this.root * 4 * Math.pow(2, (chord + scale[(i >> 1) % 8]) / 12); this.osc('square', n, n, t, spb * 0.9, 0.035); }
        this.stepI++; this.nextT += spb;
      }
    },
  };

  // ---------- viewport ----------
  let W = 0, H = 0, DPR = 1, TILE = 40, GROUND_Y = 0;
  function metrics() {
    if (G.mode === 'edit') {
      TILE = Math.max(18, Math.min((H - 140) / 7.6, W / 13, 60));
      GROUND_Y = H - 84 - TILE;
    } else {
      TILE = Math.min(H / 9, W / 13);
      GROUND_Y = H * 0.8;
    }
  }
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    metrics();
  }

  // ---------- game state ----------
  const G = {
    mode: 'menu',       // menu | play | dead | pause | win | edit
    def: null, diff: DIFFS.find((d) => d.id === store.data.diff) || DIFFS[1], lv: null, p: null, hero: heroById(store.data.char),
    attempt: 1, held: false, acc: 0, last: 0, cam: 0, deadT: 0, shake: 0, testing: false, editing: null,
    rot: 0, ang: 0, parts: [], trailT: 0, bestRun: 0, flash: 0, winT: 0, mc: 0, wtrail: [],
  };
  window.addEventListener('resize', resize); resize();

  const rootNote = (def) => (def.hue < 100 ? 49 : def.hue < 250 ? 55 : 58.27);
  const bestKey = (def) => def.id + ':' + G.diff.id;

  function startAttempt() {
    G.p = newPlayer(); G.rot = 0; G.ang = 0; G.mc = 0; G.wtrail.length = 0; G.parts.length = 0;
    G.deadT = 0; G.acc = 0; G.flash = 0; G.cam = -3; G.mode = 'play'; metrics();
    Snd.musicStart(rootNote(G.def));
    emit('attempt', G.attempt);
  }
  function begin() {
    G.attempt = 1; G.bestRun = 0;
    hide('menu'); hide('editor'); hide('pause'); hide('win'); show('btnPause');
    emit('start', hostState()); startAttempt();
  }
  function startLevel(def) { G.def = def; G.lv = buildLevel(def, G.diff); G.testing = false; emit('levelBuilt', G.lv); begin(); }
  function startCustom(data, testing) {
    G.def = { id: 'custom:' + data.id, name: data.name || 'Мой уровень', hue: data.hue || 200, custom: true };
    G.lv = buildCustom(data, G.diff); G.testing = !!testing; emit('levelBuilt', G.lv); begin();
  }
  function leave() { if (G.testing) { const d = G.editing; G.testing = false; openEditor(d); } else toMenu(); }
  function toMenu() {
    Snd.musicStop(); G.mode = 'menu'; G.testing = false; metrics();
    hide('pause'); hide('win'); hide('btnPause'); hide('editor'); show('menu'); renderMenu();
    emit('menu');
  }
  function pause() {
    if (G.mode !== 'play' && G.mode !== 'dead') return;
    G.prevMode = G.mode; G.mode = 'pause'; Snd.musicStop();
    $('btnMenu').textContent = G.testing ? '✎ В редактор' : '☰ В меню';
    show('pause');
  }
  function resume() {
    if (G.mode !== 'pause') return;
    hide('pause'); G.last = performance.now();
    if (G.prevMode === 'dead') { G.attempt++; startAttempt(); } else { G.mode = 'play'; Snd.musicStart(rootNote(G.def)); }
  }
  function restart() { hide('pause'); hide('win'); G.attempt++; startAttempt(); G.last = performance.now(); }

  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  // ---------- input ----------
  canvas.addEventListener('pointerdown', (e) => {
    if (e.cancelable) e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    if (G.mode === 'edit') return edDown(e);
    Snd.init(); G.held = true;
  });
  canvas.addEventListener('pointermove', (e) => { if (G.mode === 'edit') edMove(e); });
  const up = (e) => { if (G.mode === 'edit') edUp(e); else G.held = false; };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const JUMPKEY = (e) => e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';
  window.addEventListener('keydown', (e) => {
    if (G.mode === 'edit') {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === 'ArrowRight') edPan(4); else if (e.code === 'ArrowLeft') edPan(-4);
      return;
    }
    if (JUMPKEY(e)) { if (!e.repeat) Snd.init(); G.held = true; e.preventDefault(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') { G.mode === 'pause' ? resume() : pause(); }
    else if (e.code === 'KeyR' && (G.mode === 'play' || G.mode === 'dead')) restart();
  });
  window.addEventListener('keyup', (e) => { if (JUMPKEY(e)) G.held = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  $('btnPause').addEventListener('pointerdown', (e) => { e.stopPropagation(); pause(); });
  $('btnResume').onclick = resume;
  $('btnRestart').onclick = restart;
  $('btnMenu').onclick = leave; $('btnMenu2').onclick = leave;
  $('btnAgain').onclick = restart;
  $('btnNext').onclick = () => { hide('win'); const i = LEVELS.indexOf(G.def); startLevel(LEVELS[(i + 1) % LEVELS.length]); };
  $('btnSound').onclick = () => { store.data.sound = !store.data.sound; store.save(); Snd.init(); renderSoundBtn(); };
  // called by the Android shell for the hardware back button; returns true when handled
  window.__back = () => {
    if (G.mode === 'play' || G.mode === 'dead') { pause(); return true; }
    if (G.mode === 'pause' || G.mode === 'win') { leave(); return true; }
    if (modsOpen) { closeMods(); return true; }
    if (G.mode === 'edit') { if (!$('edCodePanel').classList.contains('hidden')) hide('edCodePanel'); else edExit(); return true; }
    return false;
  };
  window.__hidden = () => pause();

  // ---------- menu ----------
  function renderSoundBtn() { $('btnSound').textContent = store.data.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл'; }
  function renderMenu() {
    const chars = $('chars'); chars.innerHTML = '';
    for (const ch of CHARS) {
      const b = document.createElement('button');
      b.className = 'char' + (ch.id === G.hero.id ? ' sel' : '');
      b.innerHTML = '<div class="pic"><img alt="" src="' + esc(ch.src) + '"></div><b>' + esc(ch.name) + '</b>';
      b.onclick = () => { G.hero = ch; store.data.char = ch.id; store.save(); renderMenu(); };
      chars.appendChild(b);
    }
    const diffs = $('diffs'); diffs.innerHTML = '';
    for (const d of DIFFS) {
      const b = document.createElement('button');
      b.className = 'diff d-' + d.id + (d.id === G.diff.id ? ' sel' : '');
      b.innerHTML = '<b>' + d.name + '</b><span>' + ({ easy: 'спокойно', hard: 'быстро', swin: 'хрю-ад' })[d.id] + '</span>';
      b.onclick = () => { G.diff = d; store.data.diff = d.id; store.save(); renderMenu(); };
      diffs.appendChild(b);
    }
    const lvls = $('levels'); lvls.innerHTML = '';
    for (const def of LEVELS) {
      const best = store.data.best[bestKey(def)] || 0, b = document.createElement('button');
      const modes = [...new Set(def.plan.map((s) => s.m))].map((m) => '<i class="m-' + m + '">' + MODE_NAME[m] + '</i>').join('');
      b.className = 'level';
      b.innerHTML = '<div class="nm">' + def.name + '</div><div class="st">' + '★'.repeat(def.stars) + '☆'.repeat(5 - def.stars) +
        '</div><div class="modes">' + modes + '</div><div class="best">Рекорд: ' + best + '%</div><div class="bar"><i style="width:' + best + '%"></i></div>';
      b.onclick = () => { Snd.init(); startLevel(def); };
      lvls.appendChild(b);
    }
    renderCustom(); renderModLevels(); renderModButtons();
    renderSoundBtn();
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
  function renderCustom() {
    const box = $('customList'); box.innerHTML = '';
    if (!store.data.custom.length) { box.innerHTML = '<div class="empty">Пока пусто. Нажми «Создать уровень».</div>'; return; }
    for (const d of store.data.custom) {
      const row = document.createElement('div'); row.className = 'crow';
      const n = (d.objs || []).length;
      row.innerHTML = '<div class="cname"><b>' + esc(d.name || 'Мой уровень') + '</b><span>' + (d.len | 0) + ' клеток · ' + n + ' объектов</span></div>';
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'small ' + cls; b.textContent = label; b.onclick = fn; row.appendChild(b); return b; };
      mk('▶ Играть', 'go', () => { Snd.init(); G.editing = d; startCustom(d, false); });
      mk('✎', '', () => openEditor(d));
      const del = mk('🗑', 'del', () => {
        if (del.dataset.arm) { store.data.custom = store.data.custom.filter((x) => x !== d); store.save(); renderCustom(); return; }
        del.dataset.arm = '1'; del.textContent = 'Удалить?'; setTimeout(() => { del.dataset.arm = ''; del.textContent = '🗑'; }, 2500);
      });
      box.appendChild(row);
    }
  }
  $('btnNew').onclick = () => openEditor(null);
  $('btnImport').onclick = () => { openEditor(null); showCode(true); };

  // ---------- particles ----------
  function burst(x, y, n, cols, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random()) * spd;
      G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 3, life: 0, max: 0.6 + Math.random() * 0.5,
        s: 0.12 + Math.random() * 0.2, c: cols[i % cols.length] });
    }
  }

  // ---------- update ----------
  function onDeath() {
    const p = G.p; G.mode = 'dead'; G.deadT = 0; G.shake = 0.35; G.flash = 0.25;
    Snd.musicStop(); Snd.die();
    burst(p.x + p.sz / 2, p.y + p.sz / 2, 26, G.hero.colors, 9);
    const pct = Math.min(99, Math.floor((p.x / G.lv.len) * 100));
    G.bestRun = Math.max(G.bestRun, pct); G.lastPct = pct;
    emit('death', { percent: pct, crash: p.crash, x: p.x, y: p.y, attempt: G.attempt });
    if (!G.testing && pct > (store.data.best[bestKey(G.def)] || 0)) { store.data.best[bestKey(G.def)] = pct; store.save(); }
  }
  function onWin() {
    G.mode = 'win'; Snd.musicStop(); Snd.win(); emit('win', { attempt: G.attempt });
    if (!G.testing) { store.data.best[bestKey(G.def)] = 100; store.save(); }
    burst(G.p.x + 1, G.p.y + 1, 50, ['#ffd24a', '#ff7a45', '#5ad1ff', '#9dff8a'], 10);
    $('winStats').textContent = G.def.name + ' · ' + G.diff.name + ' — попыток: ' + G.attempt;
    $('winImg').src = G.hero.src; G.winT = 0;
    $('btnNext').classList.toggle('hidden', !!G.def.custom);
    $('btnMenu2').textContent = G.testing ? '✎ В редактор' : '☰ В меню';
    setTimeout(() => { if (G.mode === 'win') show('win'); }, 700);
  }

  function update(dt) {
    for (const q of G.parts) { q.life += dt; q.vy -= 22 * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
    G.parts = G.parts.filter((q) => q.life < q.max);
    G.shake = Math.max(0, G.shake - dt); G.flash = Math.max(0, G.flash - dt);

    if (G.mode === 'dead') {
      G.deadT += dt; if (G.deadT > 0.85) { G.attempt++; startAttempt(); }
      return;
    }
    if (G.mode === 'win') { G.winT += dt; return; }
    if (G.mode !== 'play') return;

    const p = G.p, stepHook = hooked('step');
    G.acc += dt; if (G.acc > 0.1) G.acc = 0.1;
    while (G.acc >= C.DT && !p.dead && !p.won) {
      const j = p.jumps, pads = p.padHit || 0;
      step(G.lv, p, G.held);
      if (stepHook) emit('step', p);
      if (p.jumps !== j) { Snd.jump(); emit('jump'); }
      if ((p.padHit || 0) !== pads) { Snd.pad(); burst(p.x + 0.45, p.y, 8, ['#ffe066', '#fff'], 4); }
      G.acc -= C.DT;
    }
    if (p.modeChanged !== G.mc) {
      G.mc = p.modeChanged; Snd.portal(); G.rot = 0; G.wtrail.length = 0;
      burst(p.x + p.sz / 2, p.y + p.sz / 2, 14, [MODE_COL[p.mode], '#fff'], 6);
      emit('portal', p.mode);
    }
    if (p.dead) return onDeath();
    if (p.won) return onWin();
    emit('frame', dt);

    const sp = G.lv.speed;
    if (p.mode === 'cube') {
      if (!p.grounded) G.rot += 14.1 * dt;
      else G.rot += (Math.round(G.rot / (Math.PI * 2)) * Math.PI * 2 - G.rot) * Math.min(1, dt * 22);
    } else {
      const target = p.mode === 'wave' ? (G.held ? -Math.PI / 4 : Math.PI / 4)
        : Math.max(-0.9, Math.min(0.9, -Math.atan2(p.vy, sp)));
      G.ang += (target - G.ang) * Math.min(1, dt * 20);
    }
    // trails
    G.trailT -= dt;
    if (p.mode === 'wave') {
      G.wtrail.push({ x: p.x + p.sz / 2, y: p.y + p.sz / 2, t: p.t });
      while (G.wtrail.length && p.t - G.wtrail[0].t > 1.0) G.wtrail.shift();
    } else if (G.trailT <= 0) {
      G.trailT = 0.03;
      G.parts.push({ x: p.x + 0.1, y: p.y + 0.1 + Math.random() * 0.4, vx: -2.5, vy: 0.4, life: 0, max: 0.35,
        s: 0.1 + Math.random() * 0.08, c: p.mode === 'ship' ? '#ffb347' : G.hero.colors[0] });
    }
    G.cam += ((p.x - (W / TILE) * 0.27) - G.cam) * Math.min(1, dt * 30);
  }

  // ---------- render ----------
  const hsl = (h, s, l, a) => 'hsla(' + (h | 0) + ',' + s + '%,' + l + '%,' + (a === undefined ? 1 : a) + ')';
  let camX = 0;
  const sx = (x) => (x - camX) * TILE;
  const sy = (y) => GROUND_Y - y * TILE;

  function drawWorld(lv, h, beat) {
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, hsl(h, 70, 22 + beat * 4)); sky.addColorStop(1, hsl(h + 30, 75, 8));
    ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, H + 40);
    // parallax pillars
    for (let layer = 0; layer < 2; layer++) {
      const par = 0.25 + layer * 0.2, size = 2.2 + layer * 1.2;
      ctx.fillStyle = hsl(h + 15, 60, 16 + layer * 4, 0.55);
      const off = camX * par, first = Math.floor(off / size) - 1;
      for (let i = first; i < first + W / (size * TILE) + 4; i++) {
        const hh = 2 + ((i * 7919 + layer * 31) % 5 + 5) % 5 * 0.9;
        ctx.fillRect((i * size - off) * TILE, GROUND_Y - hh * TILE, size * TILE * 0.7, hh * TILE + 4);
      }
    }
    // ceilings of ship / wave sections
    const ceilY = sy(C.CEIL);
    for (const seg of lv.segments) {
      if (seg.mode === 'cube') continue;
      const x0 = sx(seg.x0), x1 = sx(seg.x1); if (x1 < -10 || x0 > W + 10) continue;
      ctx.fillStyle = hsl(h, 55, 9); ctx.fillRect(x0, -30, x1 - x0, ceilY + 30);
      ctx.fillStyle = hsl(h, 90, 58 + beat * 12); ctx.fillRect(x0, ceilY - 1, x1 - x0, 3 + beat * 2);
    }
    // ground
    for (const [a, b] of lv.ground) {
      const x0 = sx(a), x1 = sx(b); if (x1 < -10 || x0 > W + 10) continue;
      ctx.fillStyle = hsl(h, 55, 9); ctx.fillRect(x0, GROUND_Y, x1 - x0, H - GROUND_Y + 20);
      ctx.fillStyle = hsl(h, 90, 58 + beat * 12); ctx.fillRect(x0, GROUND_Y - 2, x1 - x0, 3 + beat * 2);
      ctx.strokeStyle = hsl(h, 60, 22, 0.8); ctx.lineWidth = 1; ctx.beginPath();
      for (let i = Math.max(Math.ceil(a), Math.floor(camX)); i < Math.min(b, camX + W / TILE + 1); i++) { ctx.moveTo(sx(i), GROUND_Y); ctx.lineTo(sx(i), H + 5); }
      ctx.stroke();
    }
    // objects
    const c0 = Math.floor(camX) - 1, c1 = Math.ceil(camX + W / TILE) + 1, seen = new Set();
    const edge = hsl(h, 95, 62), fill = hsl(h, 60, 12);
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (seen.has(o)) continue; seen.add(o);
        if (o.k === 0 && !o.ground) {
          for (let i = 0; i < o.w; i++) for (let j = 0; j < o.h; j++) {
            const x = sx(o.x + i), y = sy(o.y + j + 1), s = TILE;
            ctx.fillStyle = fill; ctx.fillRect(x, y, s, s);
            ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
            ctx.strokeStyle = hsl(h, 80, 40, 0.5); ctx.strokeRect(x + s * 0.22, y + s * 0.22, s * 0.56, s * 0.56);
          }
        } else if (o.k === 1) drawSpike(o);
        else if (o.k === 2) {
          const x = sx(o.x), y = sy(o.y), s = TILE;
          ctx.fillStyle = '#ffd24a'; ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 14;
          ctx.fillRect(x + s * 0.1, y - s * 0.22, s * 0.8, s * 0.22); ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff6c2'; ctx.fillRect(x + s * 0.2, y - s * 0.17, s * 0.6, s * 0.07);
        }
      }
    }
    for (const po of lv.portals) drawPortal(po);
    // finish line
    const fx = sx(lv.len);
    if (fx < W + 50) {
      ctx.fillStyle = hsl(h, 90, 70, 0.9); ctx.fillRect(fx, 0, 6, GROUND_Y);
      ctx.fillStyle = hsl(h, 90, 70, 0.15); ctx.fillRect(fx, 0, W, GROUND_Y);
      ctx.fillStyle = '#fff'; ctx.font = '900 ' + (TILE * 0.9) + 'px system-ui,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('FINISH', fx + TILE * 0.8, sy(4));
    }
  }
  function drawSpike(o) {
    const x = sx(o.x), s = TILE;
    const base = o.d ? sy(o.y + 1) : sy(o.y), tip = o.d ? base + s * 0.92 : base - s * 0.92;
    ctx.beginPath(); ctx.moveTo(x + 2, base); ctx.lineTo(x + s / 2, tip); ctx.lineTo(x + s - 2, base); ctx.closePath();
    ctx.fillStyle = '#05070f'; ctx.fill(); ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 2.5; ctx.stroke();
    const inner = o.d ? base + s * 0.55 : base - s * 0.55, b2 = o.d ? base + 2 : base - 2;
    ctx.beginPath(); ctx.moveTo(x + s * 0.3, b2); ctx.lineTo(x + s / 2, inner); ctx.lineTo(x + s * 0.7, b2);
    ctx.strokeStyle = 'rgba(255,77,109,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  function drawPortal(po) {
    const x = sx(po.x); if (x < -60 || x > W + 60) return;
    const top = sy(C.CEIL), bot = sy(0), col = MODE_COL[po.mode], cy = (top + bot) / 2, ry = (bot - top) / 2;
    ctx.save();
    ctx.fillStyle = col; ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.ellipse(x, cy, TILE * 0.5, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.lineWidth = 5; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.ellipse(x, cy, TILE * 0.35, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '800 ' + Math.max(10, TILE * 0.3) + 'px system-ui,sans-serif';
    ctx.fillText(MODE_NAME[po.mode].toUpperCase(), x, sy(0.45) - TILE * 0.2);
    ctx.restore();
  }

  function drawHeroSprite(img, cx, cy, size, rot) {
    ctx.save(); ctx.translate(cx, cy); if (rot) ctx.rotate(rot);
    if (img && img.complete && img.naturalWidth) {
      const asp = img.naturalWidth / img.naturalHeight;
      let w = size, hh = size; if (asp >= 1) hh = size / asp; else w = size * asp;
      ctx.drawImage(img, -w / 2, -hh / 2, w, hh);
    } else { ctx.fillStyle = G.hero.colors[0]; ctx.fillRect(-size / 2, -size / 2, size, size); }
    ctx.restore();
  }

  function drawPlayer(p) {
    const img = G.hero.img, cx = sx(p.x + p.sz / 2), cy = sy(p.y + p.sz / 2), T = TILE;
    ctx.save(); ctx.shadowColor = G.hero.colors[0]; ctx.shadowBlur = 10;
    if (p.mode === 'cube') {
      const s = T * 1.2;
      ctx.translate(cx, cy); ctx.rotate(G.rot);
      if (img && img.complete && img.naturalWidth) {
        const asp = img.naturalWidth / img.naturalHeight;
        let w = s, hh = s; if (asp >= 1) hh = s / asp; else w = s * asp;
        ctx.drawImage(img, -w / 2, s / 2 - hh, w, hh);
      } else { ctx.fillStyle = G.hero.colors[0]; ctx.fillRect(-s / 2, -s / 2, s, s); }
    } else if (p.mode === 'ship') {
      ctx.translate(cx, cy); ctx.rotate(G.ang);
      if (G.held) { // engine flame
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.moveTo(-T * 0.55, T * 0.05);
        ctx.lineTo(-T * (0.95 + Math.random() * 0.3), T * 0.12); ctx.lineTo(-T * 0.55, T * 0.22); ctx.fill();
      }
      drawHeroSprite(img, T * 0.04, -T * 0.2, T * 0.78, 0);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a3354'; ctx.strokeStyle = MODE_COL.ship; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-T * 0.58, T * 0.02); ctx.lineTo(T * 0.62, T * 0.08);
      ctx.quadraticCurveTo(T * 0.5, T * 0.34, T * 0.1, T * 0.36); ctx.lineTo(-T * 0.4, T * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = MODE_COL.ship; ctx.fillRect(-T * 0.3, T * 0.12, T * 0.5, T * 0.05);
    } else { // wave
      const pts = G.wtrail;
      ctx.restore(); ctx.save();
      if (pts.length > 1) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let i = 1; i < pts.length; i++) {
          const a = i / pts.length;
          ctx.strokeStyle = 'rgba(77,216,255,' + (0.15 + 0.7 * a) + ')'; ctx.lineWidth = T * (0.1 + 0.16 * a);
          ctx.beginPath(); ctx.moveTo(sx(pts[i - 1].x), sy(pts[i - 1].y)); ctx.lineTo(sx(pts[i].x), sy(pts[i].y)); ctx.stroke();
        }
      }
      ctx.shadowColor = MODE_COL.wave; ctx.shadowBlur = 12;
      drawHeroSprite(img, cx, cy, T * 0.95, G.ang);
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (G.mode === 'menu') return drawMenuBg();
    if (G.mode === 'edit') return renderEditor();
    const p = G.p, lv = G.lv, prog = Math.min(1, Math.max(0, p.x / lv.len)), h = (G.def.hue + prog * 90) % 360;
    const beat = G.mode === 'play' ? Math.pow(1 - ((p.t * Snd.bpm / 60) % 1), 3) : 0;
    camX = G.cam;
    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * 42 * G.shake, (Math.random() - 0.5) * 42 * G.shake);
    drawWorld(lv, h, beat);
    // attempt text (world space)
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '800 ' + (TILE * 0.8) + 'px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Попытка ' + G.attempt, sx(6), sy(4.5));
    ctx.font = '700 ' + (TILE * 0.4) + 'px system-ui,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText(G.diff.name, sx(6), sy(4.5) + TILE * 0.55);
    // particles
    for (const q of G.parts) {
      ctx.globalAlpha = Math.max(0, 1 - q.life / q.max); ctx.fillStyle = q.c;
      const s = q.s * TILE; ctx.fillRect(sx(q.x) - s / 2, sy(q.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    if (hooked('render:world')) hookDraw('render:world');
    if (G.mode === 'play' || G.mode === 'win') drawPlayer(p);
    ctx.restore();

    if (G.mode === 'play' || G.mode === 'dead') {
      const bw = Math.min(W * 0.4, 360), bx = (W - bw) / 2, by = 12;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(bx, by, bw, 10);
      ctx.fillStyle = hsl(h, 95, 62); ctx.fillRect(bx, by, bw * prog, 10);
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 10);
      ctx.fillStyle = '#fff'; ctx.font = '800 14px system-ui,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(Math.floor(prog * 100) + '%', bx + bw + 8, by + 10);
      ctx.fillStyle = MODE_COL[p.mode]; ctx.font = '800 12px system-ui,sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(MODE_NAME[p.mode].toUpperCase(), bx - 8, by + 10);
    }
    if (hooked('render:hud')) hookDraw('render:hud');
    if (G.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + G.flash * 1.4 + ')'; ctx.fillRect(0, 0, W, H); }
  }

  function hookDraw(ev) {
    ctx.save();
    emit(ev, { ctx, W, H, TILE, camX, sx, sy, t: G.p ? G.p.t : 0, state: hostState() });
    ctx.restore();
  }

  // animated backdrop behind the menu
  let menuT = 0;
  function drawMenuBg() {
    const h = 210 + Math.sin(menuT * 0.2) * 40;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, hsl(h, 70, 22)); sky.addColorStop(1, hsl(h + 30, 75, 8));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = hsl(h, 55, 9); ctx.fillRect(0, GROUND_Y, W, H);
    ctx.fillStyle = hsl(h, 90, 58); ctx.fillRect(0, GROUND_Y - 2, W, 3);
    const img = G.hero.img;
    if (img && img.complete && img.naturalWidth) {
      const s = TILE * 1.3, asp = img.naturalWidth / img.naturalHeight, w = asp >= 1 ? s : s * asp, hh = asp >= 1 ? s / asp : s;
      const phase = (menuT % 1.3) / 1.3, y = Math.max(0, Math.sin(phase * Math.PI)) * TILE * 2.2;
      const x = ((menuT * 120) % (W + 200)) - 100;
      ctx.save(); ctx.translate(x, GROUND_Y - y - s / 2); ctx.rotate(phase * Math.PI * 2);
      ctx.drawImage(img, -w / 2, s / 2 - hh, w, hh); ctx.restore();
    }
  }

  // ======================================================================
  // Level editor
  // ======================================================================
  const ED = { data: null, cells: new Map(), cam: 0, tool: 'b', lv: null, hover: null, down: false, mode: 'add', last: '', pan: null };
  const TOOLS = [
    ['b', '■', 'Блок'], ['s', '▲', 'Шип'], ['sd', '▼', 'Шип вниз'], ['p', '▬', 'Батут'],
    ['gc', '◼', 'Куб'], ['gs', '▶', 'Корабль'], ['gw', '≈', 'Волна'],
    ['h', '∪', 'Яма'], ['e', '⌫', 'Ластик'], ['hand', '✋', 'Двигать'],
  ];
  const cellKey = (o) => (o.t === 'h' ? 'h' + o.x : o.t === 'g' ? 'g' + o.x : o.x + ',' + o.y);

  function buildToolbar() {
    const bar = $('edTools'); bar.innerHTML = '';
    for (const [id, glyph, name] of TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool' + (id === ED.tool ? ' sel' : '') + (id[0] === 'g' ? ' t-' + { gc: 'cube', gs: 'ship', gw: 'wave' }[id] : '');
      b.innerHTML = '<b>' + glyph + '</b><span>' + name + '</span>'; b.dataset.tool = id;
      b.onclick = () => { ED.tool = id; for (const x of bar.children) x.classList.toggle('sel', x.dataset.tool === id); };
      bar.appendChild(b);
    }
  }
  function rebuildEd() {
    ED.data.objs = [...ED.cells.values()];
    ED.lv = buildCustom(ED.data, G.diff);
    const sc = $('edScroll'); sc.max = Math.max(0, ED.data.len - Math.floor(W / TILE) + 4);
    $('edInfo').textContent = ED.data.len + ' клеток';
    $('edDiff').textContent = 'Тест: ' + G.diff.name;
  }
  function openEditor(entry, opts) {
    const d = entry ? JSON.parse(JSON.stringify(entry)) : { id: 'u' + Date.now().toString(36), name: 'Мой уровень', len: 120, objs: [] };
    ED.data = d; ED.cells = new Map(); for (const o of d.objs || []) ED.cells.set(cellKey(o), o);
    ED.cam = 0; ED.down = false; G.editing = d; G.testing = false;
    Snd.musicStop(); G.mode = 'edit'; metrics();
    hide('menu'); hide('pause'); hide('win'); hide('btnPause'); hide('edCodePanel'); show('editor');
    $('edName').value = d.name || '';
    buildToolbar(); rebuildEd(); $('edScroll').value = 0;
  }
  function saveEditor() {
    ED.data.name = ($('edName').value || 'Мой уровень').slice(0, 24);
    ED.data.objs = [...ED.cells.values()];
    const arr = store.data.custom, i = arr.findIndex((x) => x.id === ED.data.id);
    const copy = JSON.parse(JSON.stringify(ED.data));
    if (i >= 0) arr[i] = copy; else arr.push(copy);
    store.save(); G.editing = copy; return copy;
  }
  function edExit() { saveEditor(); toMenu(); }
  function edPan(dx) { ED.cam = Math.max(0, Math.min(Math.max(0, ED.data.len - W / TILE + 4), ED.cam + dx)); $('edScroll').value = ED.cam; }

  const edCell = (e) => {
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    return { x: Math.floor(ED.cam + px / TILE), y: Math.floor((GROUND_Y - py) / TILE), px, py };
  };
  function edApply(c, first) {
    const t = ED.tool, d = ED.data;
    if (c.x < 0 || c.x >= d.len) return;
    const key = t === 'e' ? 'e' + c.x + ',' + c.y : t + ':' + c.x + ',' + (t === 'h' || t[0] === 'g' ? 0 : c.y);
    if (ED.last === key) return; ED.last = key;
    const erase = () => {
      const k = c.x + ',' + c.y;
      if (ED.cells.has(k)) ED.cells.delete(k);
      else if (c.y < 0 && ED.cells.has('h' + c.x)) ED.cells.delete('h' + c.x);
      else if (ED.cells.has('g' + c.x)) ED.cells.delete('g' + c.x);
    };
    if (t === 'e') erase();
    else if (t === 'h' || t[0] === 'g') {
      const o = t === 'h' ? { t: 'h', x: c.x } : { t: 'g', x: c.x, m: { gc: 'cube', gs: 'ship', gw: 'wave' }[t] };
      const k = cellKey(o), ex = ED.cells.get(k);
      if (first) ED.mode = ex && ex.m === o.m ? 'del' : 'add';
      if (ED.mode === 'del') ED.cells.delete(k); else ED.cells.set(k, o);
    } else {
      if (c.y < 0 || c.y > 6) return;
      const o = t === 'b' ? { t: 'b', x: c.x, y: c.y } : t === 'p' ? { t: 'p', x: c.x, y: c.y }
        : { t: 's', x: c.x, y: c.y, d: t === 'sd' ? 1 : 0 };
      const k = cellKey(o), ex = ED.cells.get(k);
      if (first) ED.mode = ex && ex.t === o.t && (ex.d || 0) === (o.d || 0) ? 'del' : 'add';
      if (ED.mode === 'del') ED.cells.delete(k); else ED.cells.set(k, o);
    }
    rebuildEd();
  }
  function edDown(e) {
    Snd.init();
    const c = edCell(e); ED.down = true; ED.last = '';
    if (ED.tool === 'hand') { ED.pan = { x: e.clientX, cam: ED.cam }; return; }
    edApply(c, true);
  }
  function edMove(e) {
    const c = edCell(e); ED.hover = c;
    if (!ED.down) return;
    if (ED.tool === 'hand' && ED.pan) { ED.cam = ED.pan.cam; edPan(-(e.clientX - ED.pan.x) / TILE); return; }
    edApply(c, false);
  }
  function edUp() { ED.down = false; ED.pan = null; }

  function renderEditor() {
    camX = ED.cam;
    const h = 200;
    drawWorld(ED.lv, h, 0);
    // grid over the play area
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1; ctx.beginPath();
    const x0 = Math.floor(camX), x1 = Math.ceil(camX + W / TILE);
    for (let x = x0; x <= x1; x++) { ctx.moveTo(sx(x), sy(7)); ctx.lineTo(sx(x), sy(-1)); }
    for (let y = -1; y <= 7; y++) { ctx.moveTo(0, sy(y)); ctx.lineTo(W, sy(y)); }
    ctx.stroke();
    // start marker + level limits
    ctx.fillStyle = 'rgba(94,224,138,.9)'; ctx.fillRect(sx(0) - 2, sy(7), 4, 8 * TILE);
    ctx.font = '800 12px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.fillText('СТАРТ', sx(0) + 6, sy(7) + 14);
    // ceiling guide + hero at start
    ctx.fillStyle = 'rgba(255,77,154,.35)'; ctx.fillRect(0, sy(C.CEIL) - 1, W, 2);
    drawHeroSprite(G.hero.img, sx(0.5), sy(0.5) , TILE * 0.9, 0);
    // hover
    const hv = ED.hover;
    if (hv && ED.tool !== 'hand') {
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2;
      ctx.strokeRect(sx(hv.x) + 1, sy(hv.y + 1) + 1, TILE - 2, TILE - 2);
    }
    // hole markers
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    for (const o of ED.cells.values()) if (o.t === 'h') { ctx.fillRect(sx(o.x), GROUND_Y, TILE, TILE); }
  }

  // ---- editor UI wiring ----
  $('edBack').onclick = edExit;
  $('edSave').onclick = () => { saveEditor(); const b = $('edSave'); b.textContent = '✓ Сохранено'; setTimeout(() => { b.textContent = '💾 Сохранить'; }, 1200); };
  $('edTest').onclick = () => { const d = saveEditor(); Snd.init(); startCustom(d, true); };
  $('edDiff').onclick = () => {
    G.diff = DIFFS[(DIFFS.indexOf(G.diff) + 1) % DIFFS.length]; store.data.diff = G.diff.id; store.save(); rebuildEd();
  };
  $('edScroll').addEventListener('input', (e) => { ED.cam = +e.target.value; });
  $('edLeft').onclick = () => edPan(-10); $('edRight').onclick = () => edPan(10);
  const setLen = (n) => {
    ED.data.len = Math.max(40, Math.min(600, n));
    for (const [k, o] of [...ED.cells]) if (o.x >= ED.data.len) ED.cells.delete(k);
    rebuildEd();
  };
  $('edLenMinus').onclick = () => setLen(ED.data.len - 20);
  $('edLenPlus').onclick = () => setLen(ED.data.len + 20);

  // share code: copy / paste a level as text
  function encodeLevel(d) {
    const o = { n: d.name, l: d.len, o: (d.objs || []).map((q) => q.t === 'h' ? ['h', q.x] : q.t === 'g' ? ['g', q.x, q.m[0]] : [q.t, q.x, q.y, q.d || 0]) };
    return 'CD1:' + btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  }
  function decodeLevel(text) {
    const m = String(text).trim().match(/^CD1:([A-Za-z0-9+/=]+)$/); if (!m) throw new Error('bad');
    const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    const len = Math.max(40, Math.min(600, o.l | 0)), objs = [], ok = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
    const MM = { c: 'cube', s: 'ship', w: 'wave' };
    for (const q of (o.o || []).slice(0, 5000)) {
      if (q[0] === 'h' && ok(q[1], 0, len)) objs.push({ t: 'h', x: q[1] });
      else if (q[0] === 'g' && ok(q[1], 0, len) && MM[q[2]]) objs.push({ t: 'g', x: q[1], m: MM[q[2]] });
      else if ((q[0] === 'b' || q[0] === 'p') && ok(q[1], 0, len) && ok(q[2], 0, 6)) objs.push({ t: q[0], x: q[1], y: q[2] });
      else if (q[0] === 's' && ok(q[1], 0, len) && ok(q[2], 0, 6)) objs.push({ t: 's', x: q[1], y: q[2], d: q[3] ? 1 : 0 });
    }
    return { name: String(o.n || 'Импорт').slice(0, 24), len, objs };
  }
  function showCode(open) {
    const panel = $('edCodePanel');
    if (open === false || (open === undefined && !panel.classList.contains('hidden'))) return hide('edCodePanel');
    ED.data.objs = [...ED.cells.values()]; ED.data.name = $('edName').value || ED.data.name;
    $('edCodeText').value = encodeLevel(ED.data); $('edCodeMsg').textContent = '';
    show('edCodePanel');
  }
  $('edCode').onclick = () => showCode();
  $('edCodeClose').onclick = () => hide('edCodePanel');
  $('edCopy').onclick = () => {
    const ta = $('edCodeText'), msg = $('edCodeMsg');
    const fallback = () => { ta.focus(); ta.select(); msg.textContent = 'Выделено. Нажми «Копировать» в меню телефона.'; };
    try { navigator.clipboard.writeText(ta.value).then(() => { msg.textContent = 'Скопировано'; }, fallback); } catch (e) { fallback(); }
  };
  $('edLoad').onclick = () => {
    const msg = $('edCodeMsg');
    try {
      const d = decodeLevel($('edCodeText').value);
      ED.data.name = d.name; ED.data.len = d.len; ED.cells = new Map(); for (const o of d.objs) ED.cells.set(cellKey(o), o);
      $('edName').value = d.name; ED.cam = 0; $('edScroll').value = 0; rebuildEd();
      msg.textContent = 'Уровень загружен (' + d.objs.length + ' объектов)'; hide('edCodePanel');
    } catch (e) { msg.textContent = 'Не получилось прочитать код. Скопируй его целиком, он начинается с CD1:'; }
  };


  // ======================================================================
  // Mods: host (what the Mod API may touch) + mods screen
  // ======================================================================
  if (!Array.isArray(store.data.mods)) store.data.mods = [];
  const modButtons = [];
  G.modLevels = [];
  let modsOpen = false, modLoading = false;
  const clampN = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

  function hostState() {
    const p = G.p;
    return {
      mode: G.mode, attempt: G.attempt, hero: G.hero.id, difficulty: G.diff.id, testing: G.testing, held: G.held,
      level: G.lv && G.def ? { id: G.def.id, name: G.def.name, len: G.lv.len, speed: G.lv.speed } : null,
      player: p ? { x: p.x, y: p.y, vy: p.vy, mode: p.mode, size: p.sz, grounded: p.grounded, dead: p.dead } : null,
    };
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  function cleanObjs(list, len) {
    const ok = (v, a, b) => Number.isInteger(v) && v >= a && v <= b, out = [];
    for (const q of (Array.isArray(list) ? list : []).slice(0, 5000)) {
      if (!q) continue;
      if (q.t === 'h' && ok(q.x, 0, len)) out.push({ t: 'h', x: q.x });
      else if (q.t === 'g' && ok(q.x, 0, len) && DashCore.MODES.indexOf(q.m) >= 0) out.push({ t: 'g', x: q.x, m: q.m });
      else if ((q.t === 'b' || q.t === 'p') && ok(q.x, 0, len) && ok(q.y, 0, 6)) out.push({ t: q.t, x: q.x, y: q.y });
      else if (q.t === 's' && ok(q.x, 0, len) && ok(q.y, 0, 6)) out.push({ t: 's', x: q.x, y: q.y, d: q.d ? 1 : 0 });
    }
    return out;
  }

  const host = {
    core: DashCore,
    onModError() { if (modsOpen) renderMods(); },
    addHero(h, modId) {
      if (!h || typeof h !== 'object') throw new Error('heroes.add ждёт объект');
      if (typeof h.id !== 'string' || !/^[a-z0-9_-]{1,30}$/.test(h.id)) throw new Error('id героя: a-z 0-9 _ -');
      if (CHARS.some((c) => c.id === h.id)) throw new Error('герой «' + h.id + '» уже существует');
      if (typeof h.src !== 'string' || !/^(data:image\/(png|jpeg|webp|gif);base64,|https:\/\/|img\/)/.test(h.src)) throw new Error('src героя: data:image/..., https://... или img/...');
      const col = (v, d) => (typeof v === 'string' && v.length <= 40 ? v : d);
      const cs = Array.isArray(h.colors) ? h.colors : [];
      const ch = { id: h.id, name: String(h.name || h.id).slice(0, 20), src: h.src, mod: modId,
        colors: [col(cs[0], '#e07b55'), col(cs[1], '#f4a27f'), col(cs[2], '#ffffff')], img: new Image() };
      ch.img.src = ch.src; CHARS.push(ch);
      if (!modLoading && G.mode === 'menu') renderMenu();
    },
    listHeroes() { return CHARS.map((c) => ({ id: c.id, name: c.name })); },
    addLevel(l, modId) {
      if (!l || typeof l !== 'object') throw new Error('levels.add ждёт объект');
      const id = 'mod:' + modId + ':' + String(l.id || 'level').slice(0, 30).replace(/[^a-z0-9_-]/gi, '_');
      if (G.modLevels.some((x) => x.id === id)) throw new Error('уровень «' + l.id + '» уже добавлен');
      const name = String(l.name || 'Уровень мода').slice(0, 30);
      if (Array.isArray(l.plan)) {
        const plan = l.plan.slice(0, 30).map((s) => ({ m: DashCore.MODES.indexOf(s && s.m) >= 0 ? s.m : 'cube', len: Math.round(clampN(s && s.len, 40, 1500, 100)) }));
        if (!plan.length) throw new Error('plan пустой');
        const pool = (Array.isArray(l.pool) ? l.pool : ['spike1', 'spike2', 'block1']).filter((n) => n in DashCore.PATTERNS);
        if (!pool.length) throw new Error('pool: нет известных узоров (' + Object.keys(DashCore.PATTERNS).join(', ') + ')');
        const g0 = clampN(Array.isArray(l.gap) ? l.gap[0] : 6, 2, 30, 6), g1 = clampN(Array.isArray(l.gap) ? l.gap[1] : 9, g0 + 0.1, 40, g0 + 3);
        const def = { id, name, stars: Math.round(clampN(l.stars, 1, 5, 3)), seed: Math.round(clampN(l.seed, 0, 1e6, 1)),
          hue: Math.round(clampN(l.hue, 0, 360, 200)), plan, gap: [g0, g1], pool };
        G.modLevels.push({ modId, id, kind: 'gen', def });
      } else {
        const len = Math.round(clampN(l.len, 40, 600, 100));
        G.modLevels.push({ modId, id, kind: 'data', data: { id, name, len, hue: Math.round(clampN(l.hue, 0, 360, 200)), objs: cleanObjs(l.objs, len) } });
      }
      if (!modLoading && G.mode === 'menu') renderMenu();
    },
    lvAdd(lv, kind, o) { return DashCore.addObject(lv, kind, o || {}); },
    addButton(label, fn, modId) {
      if (typeof fn !== 'function') throw new Error('menuButton ждёт функцию');
      modButtons.push({ modId, label, fn });
      if (!modLoading && G.mode === 'menu') renderModButtons();
    },
    toast,
    particle(p) {
      if (G.parts.length > 800) return;
      G.parts.push({ x: clampN(+p.x, -100, 5000, 0), y: clampN(+p.y, -50, 100, 0), vx: clampN(+p.vx, -50, 50, 0), vy: clampN(+p.vy, -50, 50, 0), life: 0,
        max: clampN(+p.life, 0.05, 3, 0.5), s: clampN(+p.size, 0.02, 2, 0.15), c: typeof p.color === 'string' && p.color.length <= 40 ? p.color : '#fff' });
    },
    burst(x, y, n, cols, spd) { burst(clampN(+x, -100, 5000, 0), clampN(+y, -50, 100, 0), n, cols, spd); },
    beep(f0, f1, dur, type, vol) { if (Snd.on()) Snd.osc(type, f0, f1, Snd.ctx.currentTime, dur, vol); },
    getData(modId, k, d) { const m = store.data.modData && store.data.modData[modId]; return m && k in m ? m[k] : d; },
    setData(modId, k, v) {
      let s; try { s = JSON.stringify(v); } catch (e) { throw new Error('storage.set: значение не сериализуется'); }
      if (s === undefined || s.length > 20000) throw new Error('storage.set: слишком большое значение (до 20 КБ)');
      store.data.modData = store.data.modData || {};
      (store.data.modData[modId] = store.data.modData[modId] || {})[k] = JSON.parse(s); store.save();
    },
    state: hostState,
    restart() { if (G.mode === 'play' || G.mode === 'dead') restart(); },
    setHero(id) { const c = CHARS.find((x) => x.id === id); if (c) { G.hero = c; store.data.char = id; store.save(); } },
    removeByMod(modId) {
      for (let i = CHARS.length - 1; i >= 0; i--) if (CHARS[i].mod === modId) CHARS.splice(i, 1);
      G.modLevels = G.modLevels.filter((x) => x.modId !== modId);
      for (let i = modButtons.length - 1; i >= 0; i--) if (modButtons[i].modId === modId) modButtons.splice(i, 1);
    },
  };

  function renderModLevels() {
    const box = $('modLevels'), wrap = $('modLevelsBlock');
    box.innerHTML = ''; wrap.classList.toggle('hidden', !G.modLevels.length);
    for (const m of G.modLevels) {
      const row = document.createElement('div'); row.className = 'crow';
      const nm = m.kind === 'gen' ? m.def.name : m.data.name;
      row.innerHTML = '<div class="cname"><b>' + esc(nm) + '</b><span>из мода ' + esc(m.modId) + '</span></div>';
      const b = document.createElement('button'); b.className = 'small go'; b.textContent = '▶ Играть';
      b.onclick = () => { Snd.init(); if (m.kind === 'gen') startLevel(m.def); else startCustom(m.data, false); };
      row.appendChild(b); box.appendChild(row);
    }
  }
  function renderModButtons() {
    const box = $('modButtons'); box.innerHTML = '';
    for (const m of modButtons) {
      const b = document.createElement('button'); b.className = 'small'; b.textContent = m.label;
      b.onclick = () => { try { m.fn(); } catch (e) { toast('Ошибка мода: ' + ((e && e.message) || e)); } };
      box.appendChild(b);
    }
  }

  function reloadMods() {
    if (!window.DashMods) return;
    modLoading = true;
    try { DashMods.reloadAll(store.data.mods.filter((m) => m.enabled)); } finally { modLoading = false; }
    let dirty = false;
    for (const m of store.data.mods) { const st = DashMods.status.get(m.uid); if (st && st.meta && (!m.meta || m.meta.name !== st.meta.name)) { m.meta = st.meta; dirty = true; } }
    if (dirty) store.save();
    G.hero = heroById(store.data.char);
    if (G.mode === 'menu') renderMenu();
    if (modsOpen) renderMods();
  }
  function setMsg(t, bad) { const m = $('modMsg'); m.textContent = t; m.style.color = bad ? '#ff8a9a' : ''; }
  function installSource(src, from) {
    src = String(src || '');
    if (!src.trim()) return setMsg('Код пустой.', true);
    if (src.length > 150000) return setMsg('Мод слишком большой (максимум 150 КБ).', true);
    const entry = { uid: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36), src, enabled: true, from };
    store.data.mods.push(entry); reloadMods();
    const st = DashMods.status.get(entry.uid);
    if (!st || !st.meta) {
      store.data.mods = store.data.mods.filter((m) => m !== entry); reloadMods();
      return setMsg('Не установлен: ' + (st ? st.error : 'ошибка загрузки'), true);
    }
    store.save(); renderMods();
    setMsg(st.ok ? 'Установлен: ' + st.meta.name : 'Установлен, но с ошибкой: ' + st.error, !st.ok);
    $('modSrc').value = '';
  }

  function openMods() { modsOpen = true; hide('menu'); show('mods'); setMsg(''); renderMods(); }
  function closeMods() { modsOpen = false; hide('mods'); show('menu'); renderMenu(); }
  function renderMods() {
    const list = $('modList'); list.innerHTML = '';
    if (!window.DashMods) { list.textContent = 'Загрузчик модов недоступен.'; return; }
    if (!store.data.mods.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Модов нет. Установи пример ниже или вставь свой код.'; list.appendChild(e); }
    for (const m of store.data.mods) {
      const st = DashMods.status.get(m.uid), meta = (st && st.meta) || m.meta || { name: 'Мод', version: '', author: '', description: '' };
      const row = document.createElement('div'); row.className = 'mrow' + (m.enabled ? '' : ' off');
      const info = document.createElement('div'); info.className = 'minfo';
      const t = document.createElement('b'); t.textContent = meta.name + (meta.version ? '  v' + meta.version : '');
      const d = document.createElement('span'); d.textContent = [meta.author, meta.description].filter(Boolean).join(' — ');
      const s = document.createElement('em');
      if (!m.enabled) s.textContent = 'выключен'; else if (st && st.error) { s.textContent = 'ошибка: ' + st.error; s.className = 'bad'; } else s.textContent = 'работает';
      info.append(t, d, s);
      const tg = document.createElement('button'); tg.className = 'small'; tg.textContent = m.enabled ? 'Выключить' : 'Включить';
      tg.onclick = () => { m.enabled = !m.enabled; store.save(); reloadMods(); };
      const del = document.createElement('button'); del.className = 'small del'; del.textContent = '🗑';
      del.onclick = () => {
        if (del.dataset.arm) { store.data.mods = store.data.mods.filter((x) => x !== m); store.save(); reloadMods(); return; }
        del.dataset.arm = '1'; del.textContent = 'Удалить?'; setTimeout(() => { del.dataset.arm = ''; del.textContent = '🗑'; }, 2500);
      };
      row.append(info, tg, del); list.appendChild(row);
    }
    const ex = $('modExamples'); ex.innerHTML = '';
    for (const e of window.DashExamples || []) {
      const row = document.createElement('div'); row.className = 'mrow';
      const info = document.createElement('div'); info.className = 'minfo';
      const t = document.createElement('b'); t.textContent = e.name; const d = document.createElement('span'); d.textContent = e.desc; info.append(t, d);
      const have = store.data.mods.some((m) => m.src === e.src);
      const b = document.createElement('button'); b.className = 'small' + (have ? '' : ' go'); b.textContent = have ? 'Установлен' : 'Добавить'; b.disabled = have;
      b.onclick = () => installSource(e.src, 'example');
      row.append(info, b); ex.appendChild(row);
    }
  }
  $('btnMods').onclick = openMods;
  $('modClose').onclick = closeMods;
  $('modInstall').onclick = () => installSource($('modSrc').value, 'paste');
  $('modFileBtn').onclick = () => $('modFile').click();
  $('modFile').onchange = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => installSource(String(r.result), 'file'); r.onerror = () => setMsg('Не удалось прочитать файл.', true);
    r.readAsText(f); e.target.value = '';
  };
  $('modUrlBtn').onclick = () => {
    const u = $('modUrl').value.trim();
    if (!/^https?:\/\//i.test(u)) return setMsg('Ссылка должна начинаться с http:// или https://', true);
    setMsg('Скачиваю…');
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 10000);
    fetch(u, { signal: ac.signal, cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then((t) => { clearTimeout(to); installSource(t, 'url'); })
      .catch(() => { clearTimeout(to); setMsg('Не удалось скачать: ссылка недоступна или сайт не разрешает загрузку из игры. Открой ссылку, скопируй код и вставь его в поле выше.', true); });
  };

  // ---------- main loop ----------
  function frame(now) {
    const dt = Math.min(0.05, (now - (G.last || now)) / 1000); G.last = now; menuT += dt;
    if (G.mode !== 'menu' && G.mode !== 'pause' && G.mode !== 'edit') update(dt);
    render();
    requestAnimationFrame(frame);
  }

  renderMenu();
  if (window.DashMods) { DashMods.init(host); reloadMods(); }
  requestAnimationFrame(frame);
  window.__mods = { host, reload: reloadMods, install: installSource };
  window.__game = G; // handy for debugging / tests
})();
