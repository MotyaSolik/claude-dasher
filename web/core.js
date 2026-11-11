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
    SIZES: { cube: 0.9, ship: 0.8, wave: 0.5 },
  };
  const MODES = ['cube', 'ship', 'wave'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- cube patterns (ground level is y = 0) ----------
  const P = {
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

  // difficulty: speed (tiles/s), rest between obstacles (multiple of the base gap, in time),
  // margin = free space the generator keeps around the guaranteed path in ship / wave sections.
  const DIFFS = [
    { id: 'easy', name: 'Easy', speed: 7.5, rest: 1.3, skip: ['padSpikes', 'padBlock', 'spikeTrain', 'pitSpike', 'hill'],
      margin: { ship: 0.62, wave: 0.55 }, density: 0.6 },
    { id: 'hard', name: 'Hard', speed: 10.5, rest: 0.85, skip: [], margin: { ship: 0.4, wave: 0.34 }, density: 1 },
    { id: 'swin', name: 'SWIN', speed: 13, rest: 0.62, skip: [], margin: { ship: 0.3, wave: 0.26 }, density: 1.25 },
  ];

  // plan: sections in tiles at speed 9 (scaled with the difficulty so the duration stays the same)
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
      plan: [{ m: 'cube', len: 60 }, { m: 'ship', len: 190 }, { m: 'cube', len: 60 }],
      gap: [6, 9], pool: ['spike1', 'spike2', 'block1', 'block3', 'pit2', 'stairs'],
    },
    {
      id: 'l5', name: 'Зигзаг', stars: 4, seed: 9, hue: 165,
      plan: [{ m: 'cube', len: 60 }, { m: 'wave', len: 190 }, { m: 'cube', len: 60 }],
      gap: [5, 8], pool: ['spike1', 'spike2', 'block1', 'blockSpike', 'pit2', 'stairs'],
    },
  ];

  // ---------- shared level helpers ----------
  function newLevel(def, diff) {
    return { def, diff, speed: diff.speed, len: 0, solids: [], spikes: [], pads: [], portals: [], holes: [],
      cols: new Map(), ground: [], segments: [] };
  }
  function putCol(cols, o, w) {
    for (let c = Math.floor(o.x); c <= Math.floor(o.x + w - 1e-6); c++) {
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c).push(o);
    }
  }
  // holes -> ground blocks, column buckets, mode segments (sections between portals)
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
    if (!lv.segments.length) {
      let m = 'cube', x0 = 0;
      for (const po of lv.portals) { if (po.mode !== m) { lv.segments.push({ mode: m, x0, x1: po.x }); m = po.mode; x0 = po.x; } }
      lv.segments.push({ mode: m, x0, x1: lv.len });
    }
    return lv;
  }

  // ---------- generated levels ----------
  function buildLevel(def, diff, seedOverride) {
    diff = diff || DIFFS[1];
    const rnd = mulberry32(seedOverride !== undefined ? seedOverride : ((def.seeds && def.seeds[diff.id]) || def.seed));
    const lv = newLevel(def, diff), sc = diff.speed / 9;
    const L = {
      s: diff.speed,
      block: (x, y, w, h) => lv.solids.push({ k: 0, x, y, w, h }),
      spike: (x, y, d) => lv.spikes.push({ k: 1, x, y, d: d || 0 }),
      pad: (x, y) => lv.pads.push({ k: 2, x, y }),
      hole: (x, w) => lv.holes.push([x, x + w]),
    };
    const pool = def.pool.filter((n) => diff.skip.indexOf(n) < 0);
    const plan = def.plan.map((s) => ({ m: s.m, len: Math.round(s.len * sc) }));
    let cx = 0;
    const secs = plan.map((s) => { const o = { m: s.m, x0: cx, x1: cx + s.len }; cx += s.len; return o; });
    lv.len = cx;
    secs.forEach((s, i) => { if (i > 0 && s.m !== secs[i - 1].m) lv.portals.push({ k: 3, x: s.x0, mode: s.m }); });
    lv.portals.sort((a, b) => a.x - b.x);

    secs.forEach((s, i) => {
      const last = i === secs.length - 1;
      const seg = { mode: s.m, x0: s.x0, x1: s.x1 };
      if (s.m === 'cube') {
        let x = i === 0 ? 16 : s.x0 + 10, last_ = null;
        const end = s.x1 - (last ? 14 : 12);
        while (x < end) {
          let name;
          do { name = pool[Math.floor(rnd() * pool.length)]; } while (name === last_ && rnd() < 0.7);
          last_ = name;
          const pat = P[name], w = pat.wf ? pat.wf(diff.speed) : pat.w;
          if (x + w > end) break;
          pat.add(L, x);
          x += w + (def.gap[0] + rnd() * (def.gap[1] - def.gap[0])) * (diff.speed / 9) * diff.rest;
        }
      } else {
        genFlight(lv, rnd, s.m, s.x0, s.x1, diff, seg);
      }
      lv.segments.push(seg);
    });
    return finalize(lv);
  }

  // Ship / wave section: first simulate a random hold/release input in an empty corridor, then scatter
  // obstacles only where they stay clear of that trajectory. The input is stored => beatable by construction.
  function genFlight(lv, rnd, mode, x0, x1, diff, seg) {
    const tmp = newLevel(lv.def, diff); tmp.len = x1 + 10;
    tmp.portals.push({ k: 3, x: x0, mode });
    putCol(tmp.cols, { k: 0, x: x0 - 5, y: -30, w: x1 - x0 + 20, h: 30 }, x1 - x0 + 20);
    const p = enterAt(tmp, x0); p.stop = x1 - 0.5;
    const [dmin, dmax] = mode === 'ship' ? [0.25, 0.75] : [0.15, 0.55];
    const dur = () => Math.max(2, Math.round((dmin + rnd() * (dmax - dmin)) * 60));
    const holds = [], boxes = [];
    let f = 0, hold = false, start = 0, next = 6;
    while (!p.won && !p.dead && f < 60 * 300) {
      if (f >= next) { if (hold) holds.push([start, f]); hold = !hold; start = f; next = f + dur(); }
      frame(tmp, p, hold, 0);
      boxes.push([p.x, p.y, p.sz]); f++;
    }
    if (hold) holds.push([start, f]);
    seg.holds = holds;

    const M = diff.margin[mode], CE = C.CEIL;
    const clear = (x, y, w, h) => {
      for (const [bx, by, bs] of boxes) {
        if (bx < x + w + M && bx + bs > x - M && by < y + h + M && by + bs > y - M) return false;
      }
      return true;
    };
    let x = x0 + 10;
    while (x < x1 - 10) {
      const r = rnd(), h = 1 + Math.floor(rnd() * 3);
      let ok = false;
      if (r < 0.25) { if ((ok = clear(x, 0, 1, 1))) lv.spikes.push({ k: 1, x, y: 0, d: 0 }); }
      else if (r < 0.5) { if ((ok = clear(x, CE - 1, 1, 1))) lv.spikes.push({ k: 1, x, y: CE - 1, d: 1 }); }
      else if (r < 0.68) { if ((ok = clear(x, 0, 1, h))) lv.solids.push({ k: 0, x, y: 0, w: 1, h }); }
      else if (r < 0.86) { if ((ok = clear(x, CE - h, 1, h))) lv.solids.push({ k: 0, x, y: CE - h, w: 1, h }); }
      else { const y = 1 + Math.floor(rnd() * 4); if ((ok = clear(x, y, 1, 1))) lv.solids.push({ k: 0, x, y, w: 1, h: 1 }); }
      x += (ok ? 1.2 : 0.5) + (1 + rnd() * 2.2) / diff.density;
    }
  }

  // ---------- custom (editor) levels ----------
  // data: { name, len, objs: [ {t:'b',x,y} block, {t:'s',x,y,d} spike, {t:'p',x,y} pad,
  //                            {t:'g',x,m} portal, {t:'h',x} hole ] }
  function buildCustom(data, diff) {
    diff = diff || DIFFS[1];
    const lv = newLevel({ id: 'custom', name: data.name || 'Мой уровень', hue: data.hue || 200, custom: true }, diff);
    lv.len = Math.max(30, data.len | 0);
    for (const o of data.objs || []) {
      if (o.t === 'b') lv.solids.push({ k: 0, x: o.x, y: o.y, w: 1, h: 1 });
      else if (o.t === 's') lv.spikes.push({ k: 1, x: o.x, y: o.y, d: o.d ? 1 : 0 });
      else if (o.t === 'p') lv.pads.push({ k: 2, x: o.x, y: o.y });
      else if (o.t === 'g' && MODES.indexOf(o.m) >= 0) lv.portals.push({ k: 3, x: o.x, mode: o.m });
      else if (o.t === 'h') lv.holes.push([o.x, o.x + 1]);
    }
    return finalize(lv);
  }

  // ---------- physics ----------
  function newPlayer() {
    return { x: 0, y: 0, vy: 0, grounded: true, dead: false, won: false, t: 0, jumps: 0,
      mode: 'cube', sz: C.SIZES.cube, pi: 0, modeChanged: 0 };
  }
  // player standing on the ground just before a section starts (used by generator + checker)
  function enterAt(lv, x0) {
    const p = newPlayer(); p.x = x0 - 0.6;
    while (p.pi < lv.portals.length && lv.portals[p.pi].x <= p.x + p.sz / 2) p.pi++;
    return p;
  }
  function setMode(p, m) {
    const ns = C.SIZES[m];
    p.x += (p.sz - ns) / 2;       // keep the centre, keep the bottom
    p.sz = ns; p.mode = m; p.grounded = false;
    if (m === 'cube') p.vy = Math.min(p.vy, 4); else p.vy = Math.max(-6, Math.min(6, p.vy));
  }

  // infl: extra spike-hitbox size, used by the checker to demand a safety margin
  function step(lv, p, held, infl) {
    if (p.dead || p.won) return;
    infl = infl || 0;
    const { DT, EDGE, CORNER } = C;
    p.t += DT;
    if (p.mode === 'cube' && p.grounded && held) { p.vy = C.JUMP; p.grounded = false; p.jumps++; }

    // --- move x, mode portals
    p.x += lv.speed * DT;
    while (p.pi < lv.portals.length && p.x + p.sz / 2 >= lv.portals[p.pi].x) {
      setMode(p, lv.portals[p.pi].mode); p.pi++; p.modeChanged++;
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
    else if (p.mode === 'ship') {
      p.vy += (held ? C.SHIP_UP : C.SHIP_DN) * DT;
      if (p.vy > C.SHIP_MAX) p.vy = C.SHIP_MAX; else if (p.vy < -C.SHIP_MAX) p.vy = -C.SHIP_MAX;
    } else p.vy = held ? lv.speed : -lv.speed;       // wave: 45 degrees
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
          else if (p.vy > 0 && p.y + SZ - o.y <= p.vy * DT + 0.01) { p.y = o.y - SZ; p.vy = 0; }
        }
      }
    }
    if (p.mode !== 'cube' && p.y + SZ > C.CEIL) { p.y = C.CEIL - SZ; if (p.vy > 0) p.vy = 0; }

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
    const start = enterAt(lv, seg.x0); start.stop = seg.x1 - 0.5;
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
    const p = enterAt(lv, seg.x0); p.stop = seg.x1 - 0.5;
    const jumps = sol.jumps ? new Set(sol.jumps) : null;
    let f = 0;
    while (!p.dead && !p.won && f < 60 * 400) { frame(lv, p, jumps ? jumps.has(f) : held(sol.holds, f), infl); f++; }
    return p.won ? f : 0;
  }

  // returns one solution per segment ({jumps} or {holds}) or null when some section cannot be beaten
  function solvable(lv, infl) {
    if (infl === undefined) infl = 0.12;
    const sols = [];
    for (const seg of lv.segments) {
      let sol = null;
      if (seg.mode === 'cube') { const j = solveCube(lv, seg, infl); if (j) sol = { jumps: j }; }
      else if (seg.holds) sol = replaySegment(lv, seg, { holds: seg.holds }, infl) ? { holds: seg.holds } : null;
      if (!sol) return null;
      sols.push(sol);
    }
    return sols;
  }

  return { C, MODES, LEVELS, DIFFS, PATTERNS: P, buildLevel, buildCustom, newPlayer, enterAt, step, frame,
    solvable, replaySegment, mulberry32 };
});
