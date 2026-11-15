/* Claude Dash — game core: physics (cube / ship / wave), level generation, level editor format,
 * solvability checker. Pure logic, no DOM. Works in the browser (window.DashCore) and in node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DashCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // All units are "tiles". x grows to the right, y grows up, the ground top is y = 0.
  const C = {
    SPEED: 9,        // default tiles / second (each difficulty sets its own)
    G: -85,          // cube gravity
    JUMP: 18.9,      // cube jump impulse (≈2.1 tiles high, ≈4 tiles long)
    PAD: 27.5,       // yellow pad impulse
    DT: 1 / 240,     // physics step
    EDGE: 0.02,      // horizontal tolerance
    CORNER: 0.15,    // corner-clip forgiveness
    FALL_DEATH: -4,
    CEIL: 6.5,       // ceiling height in ship / wave sections
    SHIP_UP: 42, SHIP_DN: -34, SHIP_MAX: 11,
    // ball / spider: gravity flips on tap while touching a surface
    BALL_G: -62, BALL_MAXV: 22, BALL_KICK: 4,
    // ufo: every tap is a small hop
    UFO_G: -46, UFO_JUMP: 11, UFO_MINV: -14,
    // robot: like the cube, but holding makes the jump higher (for ROBOT_TIME seconds)
    ROBOT_V: 11.5, ROBOT_BOOST: 52, ROBOT_TIME: 0.32,
    SIZES: { cube: 0.9, ship: 0.8, wave: 0.5, ball: 0.8, ufo: 0.8, robot: 0.9, spider: 0.8 },
  };
  const MODES = ['cube', 'ship', 'wave', 'ball', 'ufo', 'robot', 'spider'];
  const CEILING_MODES = ['ship', 'wave', 'ball', 'ufo', 'spider'];   // these sections have a ceiling
  const hasCeiling = (m) => CEILING_MODES.indexOf(m) >= 0;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- cube patterns (ground level is y = 0) ----------
  const P_ = {
    spike1:  { w: 1, add: (L, x) => L.spike(x, 0) },
    spike2:  { w: 2, add: (L, x) => { L.spike(x, 0); L.spike(x + 1, 0); } },
    block1:  { w: 1, add: (L, x) => L.block(x, 0, 1, 1) },
    block3:  { w: 3, add: (L, x) => L.block(x, 0, 3, 1) },
    blockSpike: { w: 4, add: (L, x) => { L.block(x, 0, 2, 1); L.spike(x + 3, 0); } },
    spikeBlock: { w: 4, add: (L, x) => { L.spike(x, 0); L.block(x + 3, 0, 1, 1); } },
    stairs:  { w: 4, add: (L, x) => { L.block(x, 0, 2, 1); L.block(x + 2, 0, 2, 2); } },
    hill:    { w: 6, add: (L, x) => { L.block(x, 0, 2, 1); L.block(x + 2, 0, 2, 2); L.block(x + 4, 0, 2, 1); } },
    pit2:    { w: 2, add: (L, x) => L.hole(x, 2) },
    pit3:    { w: 3, add: (L, x) => L.hole(x, 3) },
    pitSpike: { w: 6, add: (L, x) => { L.hole(x, 2); L.spike(x + 5, 0); } },
    // pad flight distance grows with speed, so these scale with L.s
    padSpikes: { w: 6, wf: (s) => Math.ceil(s * 0.647) + 2, add: (L, x) => {
      const D = L.s * 0.647, a = Math.round(D * 0.34), n = D >= 5.5 ? 3 : 2;
      L.pad(x, 0); for (let i = 0; i < n; i++) L.spike(x + a + i, 0);
    } },
    padBlock: { w: 7, wf: (s) => Math.round(s * 0.647 * 0.5) + 4, add: (L, x) => {
      L.pad(x, 0); L.block(x + Math.round(L.s * 0.647 * 0.5), 0, 3, 3);
    } },
    spikeTrain: { w: 11, wf: (s) => 2 * Math.max(5, Math.round(s * 0.55)) + 1, add: (L, x) => {
      const sp = Math.max(5, Math.round(L.s * 0.55)); L.spike(x, 0); L.spike(x + sp, 0); L.spike(x + 2 * sp, 0);
    } },
  };

  // Speed portals: 1 blue (base), 2 green, 3 pink, 4 red. Each speed has its own profile:
  // speed (tiles/s), rest between obstacles (multiple of the base gap, in time), allowed patterns and the free space (margin)
  // the generator keeps around the guaranteed path in flying sections.
  const SPEEDS = [null,
    { n: 1, name: '1x', color: '#4da3ff', speed: 7.5, rest: 1.3, skip: ['padSpikes', 'padBlock', 'spikeTrain', 'pitSpike', 'hill'],
      margin: { ship: 0.62, wave: 0.55, ball: 0.6, ufo: 0.6, robot: 0.55, spider: 0.6 }, density: 0.6 },
    { n: 2, name: '2x', color: '#5ee08a', speed: 10.5, rest: 0.85, skip: [],
      margin: { ship: 0.4, wave: 0.34, ball: 0.42, ufo: 0.42, robot: 0.38, spider: 0.42 }, density: 1 },
    { n: 3, name: '3x', color: '#ff4d9a', speed: 13, rest: 0.62, skip: [],
      margin: { ship: 0.3, wave: 0.26, ball: 0.32, ufo: 0.32, robot: 0.28, spider: 0.32 }, density: 1.25 },
    { n: 4, name: '4x', color: '#ff4d4d', speed: 16, rest: 0.5, skip: [],
      margin: { ship: 0.24, wave: 0.2, ball: 0.26, ufo: 0.26, robot: 0.22, spider: 0.26 }, density: 1.4 },
  ];
  const BASE_SPEED = SPEEDS[1].speed;
  const speedFactor = (n) => SPEEDS[n].speed / BASE_SPEED;

  // plan: sections { m: mode, len, speed: 1..4 (default 1) }. `len / 9` is the section's length in SECONDS, whatever its
  // speed, so the music sync of a level never depends on the speeds in it. The first 3 levels have no speed portals.
  const LEVELS = [
    {
      id: 'l1', name: 'Первые шаги', stars: 1, seed: 11, hue: 205,
      plan: [{ m: 'cube', len: 230 }],
      gap: [6, 9], pool: ['spike1', 'spike1', 'spike2', 'block1', 'block3', 'pit2', 'blockSpike', 'stairs'],
    },
    {
      id: 'l2', name: 'Хрю-хрю', stars: 3, seed: 7, hue: 320,
      plan: [{ m: 'cube', len: 140 }, { m: 'ship', len: 80 }, { m: 'cube', len: 110 }],
      gap: [4.5, 7], pool: ['spike1', 'spike2', 'block1', 'blockSpike', 'spikeBlock', 'stairs', 'hill',
        'pit2', 'pit3', 'pitSpike', 'padSpikes', 'spikeTrain'],
    },
    {
      id: 'l3', name: 'Кошмар Claude', stars: 5, seed: 3, hue: 18,
      plan: [{ m: 'cube', len: 110 }, { m: 'wave', len: 80 }, { m: 'cube', len: 80 }, { m: 'ship', len: 80 },
        { m: 'wave', len: 80 }, { m: 'cube', len: 60 }],
      gap: [3.5, 6], pool: ['spike2', 'blockSpike', 'spikeBlock', 'hill', 'pit3', 'pitSpike',
        'padSpikes', 'padBlock', 'spikeTrain', 'stairs'],
    },
    {
      id: 'l4', name: 'Космолёт', stars: 2, seed: 5, hue: 270,
      plan: [{ m: 'cube', len: 60 }, { m: 'ship', len: 90 }, { m: 'ship', len: 100, speed: 2 }, { m: 'cube', len: 60 }],
      gap: [6, 9], pool: ['spike1', 'spike2', 'block1', 'block3', 'pit2', 'stairs'],
    },
    {
      id: 'l5', name: 'Зигзаг', stars: 4, seed: 9, hue: 165,
      plan: [{ m: 'cube', len: 60 }, { m: 'wave', len: 90 }, { m: 'wave', len: 100, speed: 2 }, { m: 'cube', len: 60 }],
      gap: [5, 8], pool: ['spike1', 'spike2', 'block1', 'blockSpike', 'pit2', 'stairs'],
    },
    {
      id: 'l6', name: 'Шар и НЛО', stars: 3, seed: 21, hue: 95,
      plan: [{ m: 'cube', len: 60 }, { m: 'ball', len: 110 }, { m: 'cube', len: 40, speed: 2 }, { m: 'ufo', len: 110, speed: 2 }, { m: 'cube', len: 50 }],
      gap: [5, 8], pool: ['spike1', 'spike2', 'block1', 'blockSpike', 'pit2', 'stairs'],
    },
    {
      id: 'l7', name: 'Робот и паук', stars: 4, seed: 31, hue: 45,
      plan: [{ m: 'cube', len: 60 }, { m: 'robot', len: 110, speed: 2 }, { m: 'cube', len: 40, speed: 2 }, { m: 'spider', len: 110, speed: 3 }, { m: 'cube', len: 50 }],
      gap: [4.5, 7], pool: ['spike1', 'spike2', 'block1', 'blockSpike', 'spikeBlock', 'pit2', 'stairs'],
    },
    {
      id: 'l8', name: 'Парад режимов', stars: 5, seed: 41, hue: 300,
      plan: [{ m: 'cube', len: 50 }, { m: 'ship', len: 60, speed: 2 }, { m: 'ball', len: 60, speed: 2 }, { m: 'cube', len: 30, speed: 2 },
        { m: 'ufo', len: 60, speed: 3 }, { m: 'wave', len: 60, speed: 3 }, { m: 'robot', len: 60, speed: 3 }, { m: 'cube', len: 30, speed: 3 },
        { m: 'spider', len: 60, speed: 4 }, { m: 'cube', len: 40, speed: 2 }],
      gap: [3.5, 6], pool: ['spike2', 'blockSpike', 'spikeBlock', 'hill', 'pit3', 'padSpikes', 'spikeTrain', 'stairs'],
    },
    {
      // the hardest level; finishing it unlocks the A6 skin.
      // Built for music: it lasts exactly 70 s (1:10) and the DROP starts at 26 s: a calm intro (26 s of easy cube
      // at the base speed), then the dense multi-mode part (44 s) with speed portals up to 4x.
      id: 'l9', name: 'Thinking Space II', stars: 5, seed: 51, hue: 255,
      drop: 26, clearTime: 0.9,
      musicHint: { track: 'Nuke Powder', artist: 'MaelouX', offset: 117 },
      plan: [
        { m: 'cube', len: 234, gap: [6, 9], pool: ['spike1', 'spike2', 'block1', 'block3', 'pit2', 'stairs', 'blockSpike'] },   // 0:00 - 0:26 intro
        { m: 'ship', len: 55, speed: 2, density: 1.7 }, { m: 'ball', len: 50, speed: 2, density: 1.7 }, { m: 'cube', len: 25, speed: 3 },
        { m: 'wave', len: 50, speed: 3, density: 1.7 }, { m: 'ufo', len: 45, speed: 3, density: 1.7 }, { m: 'robot', len: 40, speed: 3, density: 1.7 },
        { m: 'cube', len: 20, speed: 3 }, { m: 'spider', len: 45, speed: 4, density: 1.7 }, { m: 'wave', len: 30, speed: 4, density: 1.7 },
        { m: 'cube', len: 36, speed: 2 },
      ],
      gap: [3.2, 5.5], pool: ['spike2', 'blockSpike', 'spikeBlock', 'hill', 'pit3', 'pitSpike', 'padSpikes', 'padBlock', 'spikeTrain', 'stairs'],
    },
  ];

  // ---------- shared level helpers ----------
  function newLevel(def) {
    return { def, speed: BASE_SPEED, len: 0, solids: [], spikes: [], pads: [], portals: [], holes: [],
      cols: new Map(), ground: [], segments: [] };
  }
  function putCol(cols, o, w) {
    for (let c = Math.floor(o.x); c <= Math.floor(o.x + w - 1e-6); c++) {
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c).push(o);
    }
  }
  // holes -> ground blocks, column buckets, segments (sections between portals)
  function finalize(lv) {
    lv.holes.sort((a, b) => a[0] - b[0]);
    let cur = -30;
    for (const [a, b] of lv.holes) { if (a > cur) lv.ground.push([cur, a]); cur = Math.max(cur, b); }
    lv.ground.push([cur, lv.len + 40]);
    for (const [a, b] of lv.ground) lv.solids.push({ k: 0, x: a, y: -30, w: b - a, h: 30, ground: true });
    for (const o of lv.solids) putCol(lv.cols, o, o.w);
    for (const o of lv.spikes) putCol(lv.cols, o, 1);
    for (const o of lv.pads) putCol(lv.cols, o, 1);
    lv.portals.sort((a, b) => a.x - b.x);
    if (!lv.segments.length) {   // custom levels: a segment ends at every mode or speed portal
      let m = 'cube', n = 1, x0 = 0;
      for (const po of lv.portals) {
        const nm = po.mode || m, nn = po.speed || n;
        if (nm !== m || nn !== n) { if (po.x > x0 + 1e-6) lv.segments.push({ mode: m, speed: n, x0, x1: po.x }); m = nm; n = nn; x0 = po.x; }
      }
      lv.segments.push({ mode: m, speed: n, x0, x1: lv.len });
    }
    return lv;
  }

  // seconds from the start of the level until x (the speed changes at the portals)
  function timeAt(lv, x) {
    let t = 0;
    for (const seg of lv.segments) {
      const v = lv.speed * speedFactor(seg.speed || 1);
      if (x <= seg.x0) break;
      t += (Math.min(x, seg.x1) - seg.x0) / v;
    }
    return t;
  }
  const levelTime = (lv) => timeAt(lv, lv.len);

  // ---------- generated levels ----------
  function buildLevel(def, seedOverride) {
    const rnd = mulberry32(seedOverride !== undefined ? seedOverride : def.seed);
    const lv = newLevel(def);
    const L = {
      s: BASE_SPEED,
      block: (x, y, w, h) => lv.solids.push({ k: 0, x, y, w, h }),
      spike: (x, y, d) => lv.spikes.push({ k: 1, x, y, d: d || 0 }),
      pad: (x, y) => lv.pads.push({ k: 2, x, y }),
      hole: (x, w) => lv.holes.push([x, x + w]),
    };
    // a section of `len` (= seconds * 9) lasts len / 9 seconds at any speed, so its length in tiles is seconds * speed
    let cx = 0;
    const secs = def.plan.map((s) => {
      const n = s.speed || 1, o = { m: s.m, n, x0: cx, x1: cx + (s.len / 9) * SPEEDS[n].speed, pool: s.pool, gap: s.gap, density: s.density };
      cx = o.x1; return o;
    });
    lv.len = cx;
    secs.forEach((s, i) => {
      s.modePortal = i > 0 && s.m !== secs[i - 1].m;
      s.speedPortal = s.n !== (i > 0 ? secs[i - 1].n : 1);
      if (s.modePortal) lv.portals.push({ k: 3, x: s.x0, mode: s.m });
      if (s.speedPortal) lv.portals.push({ k: 3, x: s.x0, speed: s.n });
    });

    secs.forEach((s, i) => {
      const last = i === secs.length - 1, P = SPEEDS[s.n];
      const seg = { mode: s.m, speed: s.n, x0: s.x0, x1: s.x1 };
      if (s.m === 'cube') {
        L.s = P.speed;
        let x = i === 0 ? 16 : s.x0 + 10, last_ = null;
        const end = s.x1 - (last ? 14 : 12), pool = (s.pool || def.pool).filter((nm) => P.skip.indexOf(nm) < 0), gap = s.gap || def.gap;
        while (x < end) {
          let name;
          do { name = pool[Math.floor(rnd() * pool.length)]; } while (name === last_ && rnd() < 0.7);
          last_ = name;
          const pat = P_[name], w = pat.wf ? pat.wf(P.speed) : pat.w;
          if (x + w > end) break;
          pat.add(L, x);
          x += w + (gap[0] + rnd() * (gap[1] - gap[0])) * (P.speed / 9) * P.rest;
        }
      } else {
        genFlight(lv, rnd, s, P, seg);
      }
      lv.segments.push(seg);
    });
    return finalize(lv);
  }

  // Flying section: first simulate a random hold/release input in an empty corridor, then scatter
  // obstacles only where they stay clear of that trajectory. The input is stored => beatable by construction.
  function genFlight(lv, rnd, s, P, seg) {
    const mode = s.m, x0 = s.x0, x1 = s.x1, density = s.density;
    const tmp = newLevel(lv.def); tmp.len = x1 + 10;
    if (s.modePortal) tmp.portals.push({ k: 3, x: x0, mode });
    if (s.speedPortal) tmp.portals.push({ k: 3, x: x0, speed: s.n });
    putCol(tmp.cols, { k: 0, x: x0 - 5, y: -30, w: x1 - x0 + 20, h: 30 }, x1 - x0 + 20);
    const p = enterAt(tmp, x0, mode, s.n); p.stop = x1 - 0.5;
    // seconds of [holding, released] per phase; taps (ufo / ball / spider) are 2-frame holds
    const R = { ship: [[0.25, 0.75], [0.25, 0.75]], wave: [[0.15, 0.55], [0.15, 0.55]], ufo: [[0.033, 0.033], [0.18, 0.5]],
      ball: [[0.033, 0.033], [0.5, 1.4]], spider: [[0.033, 0.033], [0.35, 1.0]], robot: [[0.05, 0.34], [0.35, 0.9]] }[mode];
    const dur = (isHold) => { const r = R[isHold ? 0 : 1]; return Math.max(2, Math.round((r[0] + rnd() * (r[1] - r[0])) * 60)); };
    const holds = [], boxes = [];
    let f = 0, hold = false, start = 0, next = 6;
    while (!p.won && !p.dead && f < 60 * 300) {
      if (f >= next) { if (hold) holds.push([start, f]); hold = !hold; start = f; next = f + dur(hold); }
      frame(tmp, p, hold, 0);
      boxes.push([p.x, p.y, p.sz]); f++;
    }
    if (hold) holds.push([start, f]);
    seg.holds = holds;

    const M = P.margin[mode], CE = C.CEIL, ceil = hasCeiling(mode);
    const clear = (x, y, w, h) => {
      for (const [bx, by, bs] of boxes) {
        if (bx < x + w + M && bx + bs > x - M && by < y + h + M && by + bs > y - M) return false;
      }
      return true;
    };
    const clr = lv.def.clearTime ? lv.def.clearTime * P.speed : 10;   // free run-in / run-out at both ends of the section
    let x = x0 + clr;
    while (x < x1 - clr) {
      const r = rnd(), h = 1 + Math.floor(rnd() * 3);
      let ok = false;
      if (r < 0.25 || (!ceil && r < 0.5)) { if ((ok = clear(x, 0, 1, 1))) lv.spikes.push({ k: 1, x, y: 0, d: 0 }); }
      else if (r < 0.5) { if ((ok = clear(x, CE - 1, 1, 1))) lv.spikes.push({ k: 1, x, y: CE - 1, d: 1 }); }
      else if (r < 0.68 || (!ceil && r < 0.86)) { if ((ok = clear(x, 0, 1, h))) lv.solids.push({ k: 0, x, y: 0, w: 1, h }); }
      else if (r < 0.86) { if ((ok = clear(x, CE - h, 1, h))) lv.solids.push({ k: 0, x, y: CE - h, w: 1, h }); }
      else { const y = 1 + Math.floor(rnd() * 4); if ((ok = clear(x, y, 1, 1))) lv.solids.push({ k: 0, x, y, w: 1, h: 1 }); }
      x += (ok ? 1.2 : 0.5) + (1 + rnd() * 2.2) / ((density || 1) * P.density);
    }
  }

  // ---------- custom (editor) levels ----------
  // data: { name, len, objs: [ {t:'b',x,y} block, {t:'s',x,y,d} spike, {t:'p',x,y} pad,
  //                            {t:'g',x,m} mode portal, {t:'v',x,n} speed portal (n = 1..4), {t:'h',x} hole ] }
  function buildCustom(data) {
    const lv = newLevel({ id: 'custom', name: data.name || 'Мой уровень', hue: data.hue || 200, custom: true });
    lv.len = Math.max(30, data.len | 0);
    for (const o of data.objs || []) {
      if (o.t === 'b') lv.solids.push({ k: 0, x: o.x, y: o.y, w: 1, h: 1 });
      else if (o.t === 's') lv.spikes.push({ k: 1, x: o.x, y: o.y, d: o.d ? 1 : 0 });
      else if (o.t === 'p') lv.pads.push({ k: 2, x: o.x, y: o.y });
      else if (o.t === 'g' && MODES.indexOf(o.m) >= 0) lv.portals.push({ k: 3, x: o.x, mode: o.m });
      else if (o.t === 'v' && o.n >= 1 && o.n <= 4) lv.portals.push({ k: 3, x: o.x, speed: o.n | 0 });
      else if (o.t === 'h') lv.holes.push([o.x, o.x + 1]);
    }
    return finalize(lv);
  }

  // add an object to an already built level (used by mods); returns false when the input is invalid
  function addObject(lv, kind, o) {
    const n = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.max(-50, Math.min(2000, v)) : d);
    const x = n(o.x), y = n(o.y);
    if (x === undefined || y === undefined) return false;
    if (kind === 'block') { const b = { k: 0, x, y, w: Math.max(0.1, n(o.w, 1)), h: Math.max(0.1, n(o.h, 1)) }; lv.solids.push(b); putCol(lv.cols, b, b.w); }
    else if (kind === 'spike') { const s = { k: 1, x, y, d: o.d ? 1 : 0 }; lv.spikes.push(s); putCol(lv.cols, s, 1); }
    else if (kind === 'pad') { const p = { k: 2, x, y }; lv.pads.push(p); putCol(lv.cols, p, 1); }
    else return false;
    return true;
  }

  // ---------- physics ----------
  function newPlayer() {
    return { x: 0, y: 0, vy: 0, grounded: true, dead: false, won: false, t: 0, jumps: 0,
      mode: 'cube', sz: C.SIZES.cube, pi: 0, modeChanged: 0, gdir: -1, prevHeld: false, rj: 9,
      si: 1, sf: 1, speedChanged: 0 };   // si: speed portal number (1..4), sf: its factor relative to the base speed
  }
  // player standing on the ground just before a section starts, already in that section's mode and speed
  // (used by the generator and the checker)
  function enterAt(lv, x0, mode, n) {
    const p = newPlayer(); p.x = x0 - 0.6;
    if (mode && mode !== 'cube') { p.mode = mode; p.sz = C.SIZES[mode]; }
    if (n) { p.si = n; p.sf = speedFactor(n); }
    while (p.pi < lv.portals.length && lv.portals[p.pi].x <= p.x + p.sz / 2) p.pi++;
    return p;
  }
  function setMode(p, m) {
    const ns = C.SIZES[m];
    p.x += (p.sz - ns) / 2;       // keep the centre, keep the bottom
    p.sz = ns; p.mode = m; p.grounded = false; p.gdir = -1; p.rj = 9;
    if (m === 'cube' || m === 'robot') p.vy = Math.min(p.vy, 4); else p.vy = Math.max(-6, Math.min(6, p.vy));
  }

  // true when a box of size sz at (x, y) overlaps a solid
  function blockedAt(lv, x, y, sz) {
    for (let c = Math.floor(x); c <= Math.floor(x + sz); c++) {
      const col = lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (o.k === 0 && x + sz > o.x + C.EDGE && x < o.x + o.w - C.EDGE && y < o.y + o.h - 0.01 && y + sz > o.y + 0.01) return true;
      }
    }
    return false;
  }
  // spider: instantly jump to the opposite surface and flip gravity
  function spiderJump(lv, p) {
    const dir = -p.gdir, sz = p.sz;                       // gdir -1 (on floor) -> go up
    let y = p.y;
    for (let i = 0; i < 200; i++) {
      const ny = y + dir * 0.1;
      if (ny < -1 || ny + sz > C.CEIL || blockedAt(lv, p.x, ny, sz)) break;
      y = ny;
    }
    p.y = y; p.gdir = dir; p.vy = 0; p.grounded = false;
  }

  // infl: extra spike-hitbox size, used by the checker to demand a safety margin
  function step(lv, p, held, infl) {
    if (p.dead || p.won) return;
    infl = infl || 0;
    const { DT, EDGE, CORNER } = C;
    p.t += DT;
    const edge = held && !p.prevHeld; p.prevHeld = held;
    const mode0 = p.mode;
    if (mode0 === 'cube') { if (p.grounded && held) { p.vy = C.JUMP; p.grounded = false; p.jumps++; } }
    else if (mode0 === 'robot') { if (p.grounded && held) { p.vy = C.ROBOT_V; p.grounded = false; p.jumps++; p.rj = 0; } }
    else if (mode0 === 'ball') { if (edge && p.grounded) { p.gdir = -p.gdir; p.vy = p.gdir * C.BALL_KICK; p.grounded = false; p.jumps++; } }
    else if (mode0 === 'spider') { if (edge && p.grounded) { spiderJump(lv, p); p.jumps++; } }
    else if (mode0 === 'ufo') { if (edge) { p.vy = C.UFO_JUMP; p.jumps++; } }

    // --- move x, mode portals
    p.x += lv.speed * p.sf * DT;
    while (p.pi < lv.portals.length && p.x + p.sz / 2 >= lv.portals[p.pi].x) {
      const po = lv.portals[p.pi++];
      if (po.mode) { setMode(p, po.mode); p.modeChanged++; }
      if (po.speed) { p.si = po.speed; p.sf = speedFactor(po.speed); p.speedChanged++; }
    }
    const SZ = p.sz;
    // any deep overlap with a solid is a crash
    let c0 = Math.floor(p.x), c1 = Math.floor(p.x + SZ);
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (o.k !== 0) continue;
        if (p.x + SZ > o.x + EDGE && p.x < o.x + o.w - EDGE &&
            p.y < o.y + o.h - CORNER && p.y + SZ > o.y + CORNER) { p.dead = true; p.crash = 'wall'; return; }
      }
    }

    // --- move y
    if (p.mode === 'cube') p.vy += C.G * DT;
    else if (p.mode === 'robot') {
      p.vy += C.G * DT;
      if (held && p.rj < C.ROBOT_TIME) { p.vy += C.ROBOT_BOOST * DT; p.rj += DT; } else if (!held) p.rj = 9;
    } else if (p.mode === 'ball' || p.mode === 'spider') {
      p.vy += (p.gdir < 0 ? C.BALL_G : -C.BALL_G) * DT;
      if (p.vy > C.BALL_MAXV) p.vy = C.BALL_MAXV; else if (p.vy < -C.BALL_MAXV) p.vy = -C.BALL_MAXV;
    } else if (p.mode === 'ufo') {
      p.vy += C.UFO_G * DT;
      if (p.vy < C.UFO_MINV) p.vy = C.UFO_MINV;
    } else if (p.mode === 'ship') {
      p.vy += (held ? C.SHIP_UP : C.SHIP_DN) * DT;
      if (p.vy > C.SHIP_MAX) p.vy = C.SHIP_MAX; else if (p.vy < -C.SHIP_MAX) p.vy = -C.SHIP_MAX;
    } else p.vy = (held ? 1 : -1) * lv.speed * p.sf;       // wave: 45 degrees at any speed
    p.y += p.vy * DT;
    p.grounded = false;
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (o.k !== 0) continue;
        if (!(p.x + SZ > o.x + EDGE && p.x < o.x + o.w - EDGE)) continue;
        const top = o.y + o.h;
        if (p.y < top && p.y + SZ > o.y) {
          if (p.vy <= 0 && top - p.y <= CORNER + 0.01) { p.y = top; p.vy = 0; p.grounded = true; }
          else if (p.vy > 0 && p.y + SZ - o.y <= p.vy * DT + 0.01) { p.y = o.y - SZ; p.vy = 0; if (p.gdir > 0 && (p.mode === 'ball' || p.mode === 'spider')) p.grounded = true; }
        }
      }
    }
    if (hasCeiling(p.mode) && p.y + SZ > C.CEIL) {
      p.y = C.CEIL - SZ; if (p.vy > 0) p.vy = 0;
      if (p.gdir > 0 && (p.mode === 'ball' || p.mode === 'spider')) p.grounded = true;
    }

    // --- hazards & pads
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (o.k === 1) {
          const hx = o.x + 0.35 - infl, hw = 0.3 + 2 * infl;
          const hy = o.d ? o.y + 0.48 - infl : o.y + 0.02, hh = 0.5 + infl;
          if (p.x + SZ - 0.05 > hx && p.x + 0.05 < hx + hw && p.y + SZ - 0.05 > hy && p.y + 0.05 < hy + hh) {
            p.dead = true; p.crash = 'spike'; return;
          }
        } else if (o.k === 2 && p.mode === 'cube') {
          if (p.x + SZ > o.x + 0.1 && p.x < o.x + 0.9 && p.y < o.y + 0.25 && p.y + SZ > o.y) {
            p.vy = C.PAD; p.grounded = false; p.padHit = (p.padHit || 0) + 1;
          }
        }
      }
    }

    if (p.y < C.FALL_DEATH) { p.dead = true; p.crash = 'fall'; return; }
    if (p.x >= (p.stop || lv.len)) p.won = true;
  }

  // ---------- solvability checker (offline) ----------
  function frame(lv, p, held, infl) { for (let i = 0; i < 4; i++) step(lv, p, held, infl); }

  // cube section: search over jump timings, returns the list of jump frames or null
  function solveCube(lv, seg, infl) {
    const seen = new Set();
    const start = enterAt(lv, seg.x0, seg.mode, seg.speed); start.stop = seg.x1 - 0.5;
    const stack = [{ p: start, f: 0, path: [] }];
    const MAXW = 80;
    while (stack.length) {
      const { p, f, path } = stack.pop();
      const key = f + '|' + p.y.toFixed(2);
      if (seen.has(key)) continue; seen.add(key);
      const q = { ...p }; let fq = f;
      for (let k = 0; k < MAXW; k++) {
        const r = { ...q }; let fr = fq + 1;
        frame(lv, r, true, infl);
        while (!r.dead && !r.won && !r.grounded) { frame(lv, r, false, infl); fr++; }
        if (r.won) return path.concat(fq);
        if (!r.dead) stack.push({ p: r, f: fr, path: path.concat(fq) });
        frame(lv, q, false, infl); fq++;
        if (q.won) return path;
        if (q.dead) break;
        if (!q.grounded) {
          while (!q.dead && !q.won && !q.grounded) { frame(lv, q, false, infl); fq++; }
          if (q.won) return path;
          if (!q.dead) stack.push({ p: { ...q }, f: fq, path });
          break;
        }
      }
    }
    return null;
  }

  function held(holds, f) { for (const [a, b] of holds) if (f >= a && f < b) return true; return false; }
  function replaySegment(lv, seg, sol, infl) {
    const p = enterAt(lv, seg.x0, seg.mode, seg.speed); p.stop = seg.x1 - 0.5;
    const jumps = sol.jumps ? new Set(sol.jumps) : null;
    let f = 0;
    while (!p.dead && !p.won && f < 60 * 400) { frame(lv, p, jumps ? jumps.has(f) : held(sol.holds, f), infl); f++; }
    return p.won ? f : 0;
  }

  // returns one solution per segment ({jumps} or {holds}) or null when some section cannot be beaten
  function solvable(lv, infl) {
    const sols = [];
    for (const seg of lv.segments) {
      // faster sections get a smaller safety margin (the hitboxes of spikes are inflated by it)
      const inf = infl === undefined ? ((seg.speed || 1) >= 3 ? 0.06 : 0.12) : infl;
      let sol = null;
      if (seg.mode === 'cube') { const j = solveCube(lv, seg, inf); if (j) sol = { jumps: j }; }
      else if (seg.holds) sol = replaySegment(lv, seg, { holds: seg.holds }, inf) ? { holds: seg.holds } : null;
      if (!sol) return null;
      sols.push(sol);
    }
    return sols;
  }

  return { C, MODES, hasCeiling, LEVELS, SPEEDS, BASE_SPEED, speedFactor, timeAt, levelTime, PATTERNS: P_, buildLevel, buildCustom, addObject, newPlayer, enterAt, step, frame,
    solvable, replaySegment, mulberry32 };
});
