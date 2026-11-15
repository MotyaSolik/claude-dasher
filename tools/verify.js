// Checks that every built-in level is beatable (cube sections by search, flying sections by their stored input),
// with a safety margin, then replays the solution on the real physics. Also checks the music timing of Thinking Space II.
// node tools/verify.js            verify the seeds stored in core.js
// node tools/verify.js --find     search for working seeds and print them
const D = require('../web/core.js');
const find = process.argv.includes('--find');
let bad = 0; const found = {};
for (const def of D.LEVELS) {
  let seed = def.seed, t0 = Date.now();
  const attempt = (s) => { const lv = D.buildLevel(def, s); return D.solvable(lv) ? lv : null; };
  let lv = attempt(seed);
  if (!lv && find) { const lim = seed + 200; while (!lv && seed < lim) { seed++; lv = attempt(seed); } }
  let secs = 0, speeds = '';
  if (lv) { // replay on the real (un-inflated) physics
    const sols = D.solvable(lv);
    lv.segments.forEach((seg, i) => { const f = D.replaySegment(lv, seg, sols[i], 0); if (!f) lv = null; else secs += f / 60; });
  }
  found[def.id] = seed;
  const L = D.buildLevel(def, seed);
  speeds = [...new Set(L.segments.map((s) => s.speed))].join('/');
  const time = D.levelTime(L);
  const nominal = def.plan.reduce((a, s) => a + s.len, 0) / 9;
  let note = '';
  if (Math.abs(time - nominal) > 0.01) { note = ' TIME MISMATCH ' + time.toFixed(2) + ' vs ' + nominal.toFixed(2); bad++; }
  if (def.drop) {   // the drop: the first portal after the intro must be reached exactly `drop` seconds after the start
    const t = D.timeAt(L, L.portals[0].x);
    if (Math.abs(t - def.drop) > 0.01) { note += ' DROP MISMATCH ' + t.toFixed(2); bad++; } else note += ' drop@' + t.toFixed(1) + 's';
  }
  const modes = def.plan.map((s) => s.m[0]).join('');
  console.log(`${def.id} seed=${String(seed).padEnd(4)} [${modes}] speeds ${speeds} ${time.toFixed(1)}s ${lv ? 'BEATABLE' : 'IMPOSSIBLE'}${note} (${Date.now() - t0} ms)`);
  if (!lv) bad++;
}
if (find) console.log(JSON.stringify(found));
process.exit(bad ? 1 : 0);
