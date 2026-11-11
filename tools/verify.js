// Checks that every level on every difficulty is beatable (with a safety margin).
// node tools/verify.js            verify the seeds stored in core.js
// node tools/verify.js --find     search for working seeds and print them
const D = require('../web/core.js');
const find = process.argv.includes('--find');
let bad = 0; const found = {};
for (const def of D.LEVELS) for (const diff of D.DIFFS) {
  let seed = (def.seeds && def.seeds[diff.id]) || def.seed, t0 = Date.now();
  const infl = diff.id === 'swin' ? 0.06 : 0.12;
  let ok = D.solvable(D.buildLevel(def, diff, seed), infl);
  if (!ok && find) { const lim = seed + 60; while (!ok && seed < lim) { seed++; ok = D.solvable(D.buildLevel(def, diff, seed), infl); } }
  if (ok) { // replay the found solution on the real (un-inflated) physics
    const lv = D.buildLevel(def, diff, seed), p = D.newPlayer(), jumps = new Set(ok); let f = 0;
    while (!p.dead && !p.won && f < 60 * 180) { D.frame(lv, p, jumps.has(f), 0); f++; }
    if (!p.won) ok = null; else var secs = (f / 60).toFixed(0);
  }
  (found[def.id] = found[def.id] || {})[diff.id] = seed;
  console.log(`${def.id} ${diff.name.padEnd(5)} seed=${String(seed).padEnd(4)} ${ok ? 'BEATABLE ~' + secs + 's' : 'IMPOSSIBLE'} (${Date.now() - t0} ms)`);
  if (!ok) bad++;
}
if (find) console.log(JSON.stringify(found));
process.exit(bad ? 1 : 0);
