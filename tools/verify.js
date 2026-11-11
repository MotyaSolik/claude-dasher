// Checks that every level is beatable (with a safety margin). Usage: node tools/verify.js [--find]
const D = require('../web/core.js');
const find = process.argv.includes('--find');
let bad = 0;
for (const def of D.LEVELS) {
  let seed = def.seed, t0 = Date.now(), ok = D.solvable(D.buildLevel(def, seed));
  if (!ok && find) { while (!ok && seed < def.seed + 500) { seed++; ok = D.solvable(D.buildLevel(def, seed)); } }
  if (ok) { // replay the found solution on the real (un-inflated) physics
    const lv = D.buildLevel(def, seed), p = D.newPlayer(); const jumps = new Set(ok); let f = 0;
    while (!p.dead && !p.won && f < 60 * 120) { D.frame(lv, p, jumps.has(f), 0); f++; }
    if (!p.won) { console.log('  replay FAILED', p.crash, p.x); ok = null; } else console.log('  replay ok:', ok.length, 'jumps,', (f / 60).toFixed(1), 's');
  }
  console.log(`${def.id} "${def.name}" seed=${seed} -> ${ok ? 'BEATABLE' : 'IMPOSSIBLE'} (${Date.now() - t0} ms)`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
