/* Claude Dash — rendering, input, audio, menus. */
(function () {
  'use strict';
  const { C, LEVELS, buildLevel, newPlayer, step } = DashCore;
  const $ = (id) => document.getElementById(id);
  const canvas = $('c'), ctx = canvas.getContext('2d');

  // ---------- storage (safe) ----------
  const store = {
    data: { char: 'claude', best: {}, sound: true },
    load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem('claudedash') || '{}')); } catch (e) {} },
    save() { try { localStorage.setItem('claudedash', JSON.stringify(this.data)); } catch (e) {} },
  };
  store.load();

  // ---------- heroes ----------
  const CHARS = [
    { id: 'claude', name: 'Claude', src: 'img/claude.png', colors: ['#e07b55', '#f4a27f', '#ffffff'] },
    { id: 'pig', name: 'Хрюша', src: 'img/pig.png', colors: ['#e2b9a0', '#f1c9b4', '#c98f86'] },
  ];
  for (const ch of CHARS) { ch.img = new Image(); ch.img.src = ch.src; }
  const heroById = (id) => CHARS.find((c) => c.id === id) || CHARS[0];

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
        const semi = chord + (s % 8 < 8 ? [0, 0, 12, 0, 7, 0, 12, 7][s % 8] : 0);
        if (s % 2 === 0 || s % 8 === 7) this.osc('sawtooth', this.root * Math.pow(2, semi / 12), this.root * Math.pow(2, semi / 12), t, spb * 1.6, 0.11);
        if (s % 2 === 1) { const n = this.root * 4 * Math.pow(2, (chord + scale[(i >> 1) % 8]) / 12); this.osc('square', n, n, t, spb * 0.9, 0.035); }
        this.stepI++; this.nextT += spb;
      }
    },
  };

  // ---------- viewport ----------
  let W = 0, H = 0, DPR = 1, TILE = 40, GROUND_Y = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    TILE = H / 9; GROUND_Y = H * 0.8;
  }
  window.addEventListener('resize', resize); resize();

  // ---------- game state ----------
  const G = {
    mode: 'menu',       // menu | play | dead | pause | win
    def: null, lv: null, p: null, hero: heroById(store.data.char),
    attempt: 1, held: false, acc: 0, last: 0, cam: 0, deadT: 0, shake: 0,
    rot: 0, parts: [], trailT: 0, bestRun: 0, flash: 0, winT: 0,
  };

  function hueAt(prog) { return (G.def.hue + prog * 90) % 360; }

  function startAttempt() {
    G.p = newPlayer(); G.rot = 0; G.parts.length = 0; G.deadT = 0; G.acc = 0; G.flash = 0;
    G.cam = -3; G.mode = 'play';
    Snd.musicStart(G.def.hue < 100 ? 49 : G.def.hue < 250 ? 55 : 58.27);
  }
  function startLevel(def) {
    G.def = def; G.lv = buildLevel(def); G.attempt = 1; G.bestRun = 0;
    hide('menu'); show('btnPause'); startAttempt();
  }
  function toMenu() {
    Snd.musicStop(); G.mode = 'menu'; hide('pause'); hide('win'); hide('btnPause'); show('menu'); renderMenu();
  }
  function pause() {
    if (G.mode !== 'play' && G.mode !== 'dead') return;
    G.prevMode = G.mode; G.mode = 'pause'; Snd.musicStop(); show('pause');
  }
  function resume() {
    if (G.mode !== 'pause') return;
    hide('pause'); G.last = performance.now();
    if (G.prevMode === 'dead') { G.attempt++; startAttempt(); } else { G.mode = 'play'; Snd.musicStart(G.def.hue < 100 ? 49 : G.def.hue < 250 ? 55 : 58.27); }
  }
  function restart() { hide('pause'); hide('win'); G.attempt++; startAttempt(); G.last = performance.now(); }

  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  // ---------- input ----------
  function press(e) {
    if (e && e.cancelable) e.preventDefault();
    Snd.init(); G.held = true;
  }
  function release(e) { if (e && e.cancelable) e.preventDefault(); G.held = false; }
  canvas.addEventListener('pointerdown', press);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { if (!e.repeat) Snd.init(); G.held = true; e.preventDefault(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') { G.mode === 'pause' ? resume() : pause(); }
    else if (e.code === 'KeyR' && (G.mode === 'play' || G.mode === 'dead')) restart();
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') G.held = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', () => pause());
  $('btnPause').addEventListener('pointerdown', (e) => { e.stopPropagation(); pause(); });
  $('btnResume').onclick = resume;
  $('btnRestart').onclick = restart;
  $('btnMenu').onclick = toMenu; $('btnMenu2').onclick = toMenu;
  $('btnAgain').onclick = restart;
  $('btnNext').onclick = () => { hide('win'); const i = LEVELS.indexOf(G.def); startLevel(LEVELS[(i + 1) % LEVELS.length]); };
  $('btnSound').onclick = () => { store.data.sound = !store.data.sound; store.save(); Snd.init(); renderSoundBtn(); };
  // called by the Android shell for the hardware back button; returns true when handled
  window.__back = () => {
    if (G.mode === 'play' || G.mode === 'dead') { pause(); return true; }
    if (G.mode === 'pause' || G.mode === 'win') { toMenu(); return true; }
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
      b.innerHTML = '<div class="pic"><img alt="" src="' + ch.src + '"></div><b>' + ch.name + '</b>';
      b.onclick = () => { G.hero = ch; store.data.char = ch.id; store.save(); renderMenu(); };
      chars.appendChild(b);
    }
    const lvls = $('levels'); lvls.innerHTML = '';
    for (const def of LEVELS) {
      const best = store.data.best[def.id] || 0, b = document.createElement('button');
      b.className = 'level';
      b.innerHTML = '<div class="nm">' + def.name + '</div><div class="st">' + '★'.repeat(def.stars) + '☆'.repeat(5 - def.stars) +
        '</div><div class="best">Рекорд: ' + best + '%</div><div class="bar"><i style="width:' + best + '%"></i></div>';
      b.onclick = () => { Snd.init(); startLevel(def); };
      lvls.appendChild(b);
    }
    renderSoundBtn();
  }

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
    burst(p.x + C.SIZE / 2, p.y + C.SIZE / 2, 26, G.hero.colors, 9);
    const pct = Math.min(99, Math.floor((p.x / G.lv.len) * 100));
    G.bestRun = Math.max(G.bestRun, pct); G.lastPct = pct;
    if (pct > (store.data.best[G.def.id] || 0)) { store.data.best[G.def.id] = pct; store.save(); }
  }
  function onWin() {
    G.mode = 'win'; Snd.musicStop(); Snd.win();
    store.data.best[G.def.id] = 100; store.save();
    burst(G.p.x + 1, G.p.y + 1, 50, ['#ffd24a', '#ff7a45', '#5ad1ff', '#9dff8a'], 10);
    $('winStats').textContent = G.def.name + ' — попыток: ' + G.attempt;
    $('winImg').src = G.hero.src; G.winT = 0;
    setTimeout(() => { if (G.mode === 'win') show('win'); }, 700);
  }

  function update(dt) {
    // particles
    for (const q of G.parts) { q.life += dt; q.vy -= 22 * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
    G.parts = G.parts.filter((q) => q.life < q.max);
    G.shake = Math.max(0, G.shake - dt); G.flash = Math.max(0, G.flash - dt);

    if (G.mode === 'dead') {
      G.deadT += dt; if (G.deadT > 0.85) { G.attempt++; startAttempt(); }
      return;
    }
    if (G.mode === 'win') { G.winT += dt; return; }
    if (G.mode !== 'play') return;

    const p = G.p;
    G.acc += dt; if (G.acc > 0.1) G.acc = 0.1;
    while (G.acc >= C.DT && !p.dead && !p.won) {
      const j = p.jumps, pads = p.padHit || 0;
      step(G.lv, p, G.held);
      if (p.jumps !== j) Snd.jump();
      if ((p.padHit || 0) !== pads) { Snd.pad(); burst(p.x + 0.45, p.y, 8, ['#ffe066', '#fff'], 4); }
      G.acc -= C.DT;
    }
    if (p.dead) return onDeath();
    if (p.won) return onWin();

    // visual rotation
    if (!p.grounded) G.rot += 14.1 * dt;
    else G.rot += (Math.round(G.rot / (Math.PI * 2)) * Math.PI * 2 - G.rot) * Math.min(1, dt * 22);
    // trail
    G.trailT -= dt;
    if (G.trailT <= 0) {
      G.trailT = 0.03;
      G.parts.push({ x: p.x + 0.1, y: p.y + 0.1 + Math.random() * 0.4, vx: -2.5, vy: 0.4, life: 0, max: 0.35, s: 0.1 + Math.random() * 0.08,
        c: G.hero.colors[0] });
    }
    G.cam += ((p.x - (W / TILE) * 0.27) - G.cam) * Math.min(1, dt * 30);
  }

  // ---------- render ----------
  const hsl = (h, s, l, a) => 'hsla(' + (h | 0) + ',' + s + '%,' + l + '%,' + (a === undefined ? 1 : a) + ')';
  function sx(x) { return (x - G.cam) * TILE; }
  function sy(y) { return GROUND_Y - y * TILE; }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!G.def) { drawMenuBg(); return; }
    const p = G.p, prog = Math.min(1, Math.max(0, p.x / G.lv.len)), h = hueAt(prog);
    const beat = G.mode === 'play' ? Math.pow(1 - ((p.t * G.bpmHz()) % 1), 3) : 0;
    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * 14 * G.shake * 3, (Math.random() - 0.5) * 14 * G.shake * 3);

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, hsl(h, 70, 22 + beat * 4)); sky.addColorStop(1, hsl(h + 30, 75, 8));
    ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, H + 40);
    // parallax pillars
    for (let layer = 0; layer < 2; layer++) {
      const par = 0.25 + layer * 0.2, size = 2.2 + layer * 1.2;
      ctx.fillStyle = hsl(h + 15, 60, 16 + layer * 4, 0.55);
      const off = G.cam * par, first = Math.floor(off / size) - 1;
      for (let i = first; i < first + W / (size * TILE) + 4; i++) {
        const hh = 2 + ((i * 7919 + layer * 31) % 5 + 5) % 5 * 0.9;
        ctx.fillRect((i * size - off) * TILE, GROUND_Y - hh * TILE, size * TILE * 0.7, hh * TILE + 4);
      }
    }
    // ground
    const gTop = GROUND_Y;
    ctx.fillStyle = hsl(h, 55, 9);
    for (const [a, b] of G.lv.ground) {
      const x0 = sx(a), x1 = sx(b); if (x1 < -10 || x0 > W + 10) continue;
      ctx.fillRect(x0, gTop, x1 - x0, H - gTop + 20);
      ctx.fillStyle = hsl(h, 90, 58 + beat * 12); ctx.fillRect(x0, gTop - 2, x1 - x0, 3 + beat * 2); ctx.fillStyle = hsl(h, 55, 9);
    }
    // ground tiles lines
    ctx.strokeStyle = hsl(h, 60, 22, 0.8); ctx.lineWidth = 1; ctx.beginPath();
    for (let i = Math.floor(G.cam); i < G.cam + W / TILE + 1; i++) { ctx.moveTo(sx(i), gTop); ctx.lineTo(sx(i), H + 5); }
    ctx.moveTo(0, gTop + TILE * 0.9); ctx.lineTo(W, gTop + TILE * 0.9); ctx.stroke();

    // objects
    const c0 = Math.floor(G.cam) - 1, c1 = Math.ceil(G.cam + W / TILE) + 1, seen = new Set();
    const edge = hsl(h, 95, 62), fill = hsl(h, 60, 12);
    for (let c = c0; c <= c1; c++) {
      const col = G.lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (seen.has(o)) continue; seen.add(o);
        if (o.k === 0 && !o.ground) {
          for (let i = 0; i < o.w; i++) for (let j = 0; j < o.h; j++) {
            const x = sx(o.x + i), y = sy(o.y + j + 1), s = TILE;
            ctx.fillStyle = fill; ctx.fillRect(x, y, s, s);
            ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
            ctx.strokeStyle = hsl(h, 80, 40, 0.5); ctx.strokeRect(x + s * 0.22, y + s * 0.22, s * 0.56, s * 0.56);
          }
        } else if (o.k === 1) {
          const x = sx(o.x), y = sy(o.y), s = TILE;
          ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + s / 2, y - s * 0.92); ctx.lineTo(x + s - 2, y); ctx.closePath();
          ctx.fillStyle = '#05070f'; ctx.fill(); ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + s * 0.3, y - 2); ctx.lineTo(x + s / 2, y - s * 0.55); ctx.lineTo(x + s * 0.7, y - 2);
          ctx.strokeStyle = 'rgba(255,77,109,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
        } else if (o.k === 2) {
          const x = sx(o.x), y = sy(o.y), s = TILE;
          ctx.fillStyle = '#ffd24a'; ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 14;
          ctx.fillRect(x + s * 0.1, y - s * 0.22, s * 0.8, s * 0.22); ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff6c2'; ctx.fillRect(x + s * 0.2, y - s * 0.17, s * 0.6, s * 0.07);
        }
      }
    }
    // finish line
    const fx = sx(G.lv.len);
    if (fx < W + 50) {
      ctx.fillStyle = hsl(h, 90, 70, 0.9); ctx.fillRect(fx, 0, 6, GROUND_Y);
      ctx.fillStyle = hsl(h, 90, 70, 0.15); ctx.fillRect(fx, 0, W, GROUND_Y);
      ctx.fillStyle = '#fff'; ctx.font = '900 ' + (TILE * 0.9) + 'px system-ui,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('FINISH', fx + TILE * 0.8, sy(4));
    }
    // attempt text (world space)
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '800 ' + (TILE * 0.8) + 'px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Попытка ' + G.attempt, sx(6), sy(4.5));

    // particles
    for (const q of G.parts) {
      const a = 1 - q.life / q.max; ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = q.c;
      const s = q.s * TILE; ctx.fillRect(sx(q.x) - s / 2, sy(q.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // player
    if (G.mode === 'play' || G.mode === 'win') drawPlayer(p);
    ctx.restore();

    // HUD
    if (G.mode === 'play' || G.mode === 'dead') {
      const bw = Math.min(W * 0.4, 360), bx = (W - bw) / 2, by = 12;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(bx, by, bw, 10);
      ctx.fillStyle = hsl(h, 95, 62); ctx.fillRect(bx, by, bw * prog, 10);
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 10);
      ctx.fillStyle = '#fff'; ctx.font = '800 14px system-ui,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(Math.floor(prog * 100) + '%', bx + bw + 8, by + 10);
    }
    if (G.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + G.flash * 1.4 + ')'; ctx.fillRect(0, 0, W, H); }
  }

  G.bpmHz = () => Snd.bpm / 60;

  function drawPlayer(p) {
    const img = G.hero.img, s = TILE * 1.2;
    const cx = sx(p.x + C.SIZE / 2), cy = sy(p.y + C.SIZE / 2);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(G.rot);
    if (img && img.complete && img.naturalWidth) {
      const asp = img.naturalWidth / img.naturalHeight;
      let w = s, hh = s; if (asp >= 1) hh = s / asp; else w = s * asp;
      ctx.shadowColor = G.hero.colors[0]; ctx.shadowBlur = 10;
      ctx.drawImage(img, -w / 2, s / 2 - hh, w, hh);
    } else { ctx.fillStyle = G.hero.colors[0]; ctx.fillRect(-s / 2, -s / 2, s, s); }
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

  // ---------- main loop ----------
  function frame(now) {
    const dt = Math.min(0.05, (now - (G.last || now)) / 1000); G.last = now; menuT += dt;
    if (G.mode !== 'menu' && G.mode !== 'pause') update(dt); else if (G.mode === 'pause') {/* frozen */}
    render();
    requestAnimationFrame(frame);
  }

  renderMenu();
  requestAnimationFrame(frame);
  window.__game = G; // handy for debugging / tests
})();
