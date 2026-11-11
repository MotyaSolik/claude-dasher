// Checks that every built-in level on every difficulty is beatable (cube sections by search,
// ship/wave sections by their stored input), with a safety margin, then replays on the real physics.
// node tools/verify.js            verify the seeds stored in core.js
// node tools/verify.js --find     search for working seeds and print them
const D = require('../web/core.js');
const find = process.argv.includes('--find');
let bad = 0; const found = {};
for (const def of D.LEVELS) for (const diff of D.DIFFS) {
  let seed = (def.seeds && def.seeds[diff.id]) || def.seed, t0 = Date.now();
  const infl = diff.id === 'swin' ? 0.06 : 0.12;
  const attempt = (s) => { const lv = D.buildLevel(def, diff, s); return D.solvable(lv, infl) ? lv : null; };
  let lv = attempt(seed);
  if (!lv && find) { const lim = seed + 80; while (!lv && seed < lim) { seed++; lv = attempt(seed); } }
  let secs = 0;
  if (lv) { // replay on the real (un-inflated) physics
    const sols = D.solvable(lv, infl);
    lv.segments.forEach((seg, i) => { const f = D.replaySegment(lv, seg, sols[i], 0); if (!f) lv = null; else secs += f / 60; });
  }
  (found[def.id] = found[def.id] || {})[diff.id] = seed;
  const modes = def.plan.map((s) => s.m[0]).join('');
  console.log(`${def.id} ${diff.name.padEnd(5)} seed=${String(seed).padEnd(4)} [${modes}] ${lv ? 'BEATABLE ~' + secs.toFixed(0) + 's' : 'IMPOSSIBLE'} (${Date.now() - t0} ms)`);
  if (!lv) bad++;
}
if (find) console.log(JSON.stringify(found));
process.exit(bad ? 1 : 0);
