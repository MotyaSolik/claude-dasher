/* Claude Dash — game core: physics, level generation, solvability checker.
 * Pure logic, no DOM. Works in the browser (window.DashCore) and in node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DashCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // All units are "tiles". The player is a SIZE x SIZE box, x grows to the right.
  const C = {
    SPEED: 9,        // default tiles / second (each difficulty sets its own)
    G: -85,          // gravity
    JUMP: 18.9,      // jump impulse (≈2.1 tiles high, ≈4 tiles long)
    PAD: 27.5,       // yellow pad impulse
    DT: 1 / 240,     // physics step
    SIZE: 0.9,       // hitbox size
    EDGE: 0.02,      // horizontal tolerance
    CORNER: 0.15,    // corner-clip forgiveness
    FALL_DEATH: -4,
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- patterns (ground level is y = 0) ----------
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

  // difficulty: speed (tiles/s), rest between obstacles (as a multiple of the base gap, in time), allowed patterns
  const DIFFS = [
    { id: 'easy', name: 'Easy',  speed: 7.5,  rest: 1.3,  skip: ['spike3', 'padSpikes', 'padBlock', 'spikeTrain', 'pitSpike', 'hill'] },
    { id: 'hard', name: 'Hard',  speed: 10.5, rest: 0.85, skip: [] },
    { id: 'swin', name: 'SWIN',  speed: 13,   rest: 0.62, skip: [] },
  ];

  const LEVELS = [
    {
      id: 'l1', name: 'Первые шаги', stars: 1, len: 230, seed: 11, hue: 205,
      gap: [6, 9], pool: ['spike1', 'spike1', 'spike2', 'block1', 'block3', 'pit2', 'blockSpike', 'stairs'],
    },
    {
      id: 'l2', name: 'Хрю-хрю', stars: 3, len: 310, seed: 7, seeds: { swin: 8 }, hue: 320,
      gap: [4.5, 7], pool: ['spike1', 'spike2', 'block1', 'blockSpike', 'spikeBlock', 'stairs', 'hill',
        'pit2', 'pit3', 'pitSpike', 'padSpikes', 'spikeTrain'],
    },
    {
      id: 'l3', name: 'Кошмар Claude', stars: 5, len: 400, seed: 3, seeds: { swin: 4 }, hue: 18,
      gap: [3.5, 6], pool: ['spike2', 'blockSpike', 'spikeBlock', 'hill', 'pit3', 'pitSpike',
        'padSpikes', 'padBlock', 'spikeTrain', 'stairs'],
    },
  ];

  // ---------- level building ----------
  function buildLevel(def, diff, seedOverride) {
    diff = diff || DIFFS[1];
    const rnd = mulberry32(seedOverride !== undefined ? seedOverride : ((def.seeds && def.seeds[diff.id]) || def.seed));
    const lv = { def, diff, speed: diff.speed, len: Math.round(def.len * diff.speed / 9), solids: [], spikes: [], pads: [], holes: [], cols: new Map(), ground: [] };
    const L = {
      s: diff.speed,
      block: (x, y, w, h) => lv.solids.push({ k: 0, x, y, w, h }),
      spike: (x, y) => lv.spikes.push({ k: 1, x, y }),
      pad: (x, y) => lv.pads.push({ k: 2, x, y }),
      hole: (x, w) => lv.holes.push([x, x + w]),
    };
    let x = 16;
    const end = lv.len - 14;
    const pool = def.pool.filter((n) => diff.skip.indexOf(n) < 0);
    let last = null;
    while (x < end) {
      let name;
      do { name = pool[Math.floor(rnd() * pool.length)]; } while (name === last && rnd() < 0.7);
      last = name;
      const pat = P[name];
      pat.add(L, x);
      const w = pat.wf ? pat.wf(diff.speed) : pat.w;
      // gaps are defined in tiles at speed 9; convert to time so the rest between obstacles scales with the difficulty
      x += w + (def.gap[0] + rnd() * (def.gap[1] - def.gap[0])) * (diff.speed / 9) * diff.rest;
    }
    // ground segments = everything except holes
    lv.holes.sort((a, b) => a[0] - b[0]);
    let cur = -30;
    for (const [a, b] of lv.holes) { if (a > cur) lv.ground.push([cur, a]); cur = b; }
    lv.ground.push([cur, lv.len + 40]);
    for (const [a, b] of lv.ground) lv.solids.push({ k: 0, x: a, y: -30, w: b - a, h: 30, ground: true });

    const put = (o, w) => {
      for (let c = Math.floor(o.x); c <= Math.floor(o.x + w - 1e-6); c++) {
        if (!lv.cols.has(c)) lv.cols.set(c, []);
        lv.cols.get(c).push(o);
      }
    };
    for (const o of lv.solids) put(o, o.w);
    for (const o of lv.spikes) put(o, 1);
    for (const o of lv.pads) put(o, 1);
    return lv;
  }

  // ---------- physics ----------
  function newPlayer() {
    return { x: 0, y: 0, vy: 0, grounded: true, dead: false, won: false, t: 0, jumps: 0 };
  }

  // infl: extra spike-hitbox size, used by the checker to demand a safety margin
  function step(lv, p, held, infl) {
    if (p.dead || p.won) return;
    infl = infl || 0;
    const { DT, SIZE, EDGE, CORNER } = C;
    p.t += DT;
    if (p.grounded && held) { p.vy = C.JUMP; p.grounded = false; p.jumps++; }

    // --- move x: any deep overlap with a solid is a crash
    p.x += lv.speed * DT;
    let c0 = Math.floor(p.x), c1 = Math.floor(p.x + SIZE);
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (o.k !== 0) continue;
        if (p.x + SIZE > o.x + EDGE && p.x < o.x + o.w - EDGE &&
            p.y < o.y + o.h - CORNER && p.y + SIZE > o.y + CORNER) { p.dead = true; p.crash = 'wall'; return; }
      }
    }

    // --- move y
    p.vy += C.G * DT;
    p.y += p.vy * DT;
    p.grounded = false;
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (o.k !== 0) continue;
        if (!(p.x + SIZE > o.x + EDGE && p.x < o.x + o.w - EDGE)) continue;
        const top = o.y + o.h;
        if (p.y < top && p.y + SIZE > o.y) {
          if (p.vy <= 0 && top - p.y <= CORNER + 0.01) { p.y = top; p.vy = 0; p.grounded = true; }
          else if (p.vy > 0 && p.y + SIZE - o.y <= p.vy * DT + 0.01) {
            p.y = o.y - SIZE; p.vy = 0;
          }
        }
      }
    }

    // --- hazards & pads
    for (let c = c0; c <= c1; c++) {
      const col = lv.cols.get(c); if (!col) continue;
      for (const o of col) {
        if (o.k === 1) {
          const hx = o.x + 0.35 - infl, hw = 0.3 + 2 * infl, hy = o.y + 0.02, hh = 0.5 + infl;
          if (p.x + SIZE - 0.05 > hx && p.x + 0.05 < hx + hw && p.y + SIZE - 0.05 > hy && p.y + 0.05 < hy + hh) {
            p.dead = true; p.crash = 'spike'; return;
          }
        } else if (o.k === 2) {
          if (p.x + SIZE > o.x + 0.1 && p.x < o.x + 0.9 && p.y < o.y + 0.25 && p.y + SIZE > o.y) {
            p.vy = C.PAD; p.grounded = false; p.padHit = (p.padHit || 0) + 1;
          }
        }
      }
    }

    if (p.y < C.FALL_DEATH) { p.dead = true; p.crash = 'fall'; return; }
    if (p.x >= lv.len) p.won = true;
  }

  // ---------- solvability checker (offline, finds a valid input sequence) ----------
  function frame(lv, p, held, infl) { for (let i = 0; i < 4; i++) step(lv, p, held, infl); }

  function solvable(lv, infl) {
    if (infl === undefined) infl = 0.12;
    const seen = new Set();
    const stack = [{ p: newPlayer(), f: 0, path: [] }];
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

  return { C, LEVELS, DIFFS, PATTERNS: P, buildLevel, newPlayer, step, frame, solvable, mulberry32 };
});
