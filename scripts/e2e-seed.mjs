// seo-bot · scripts/e2e-seed — (re)seed the _e2e dashboard fixtures so the live cross-repo e2e
// (test/e2e-dashboard.mjs) passes 33/33.
//
// WHY THIS EXISTS: the e2e drives the LIVE control room against the shared store, and its
// "Accept-all records decisions" step CONSUMES the Mild queue every run. Because reports/ is
// gitignored, the _e2e seed was never preserved — so once the store's queue was consumed, the
// 4 approvals-dependent checks went red until re-seeded. This script restores a reproducible seed:
// a green + amber + red tier mix that exercises every card path.
//
// HONESTY / INVARIANTS: the single GREEN card is a benign NON-YMYL meta clamp that legitimately
// clears the auto-approve gate (proven change-class ledger + verifier consensus + safe screenshot).
// Every med-spa surface (reviews/before-after/GLP-1/health-claim) stays amber/red via the YMYL
// gate — exactly as production would. No invariant is weakened to make the test pass.
//
// Run where `gh` is authenticated to the store (the Mac Mini):  node scripts/e2e-seed.mjs

import { copyFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.mjs';

const src = join(ROOT, 'test', 'fixtures', 'e2e-seed');
const dst = join(ROOT, 'reports', '_e2e');
mkdirSync(dst, { recursive: true });
// proposals filename must sort as "latest" (loadLatestProposals picks the newest by name).
copyFileSync(join(src, 'proposals.json'), join(dst, 'proposals-2026-06-27T19-00-00-000Z.json'));
for (const f of ['decisions.ndjson', 'autopilot-latest.json', 'run-latest.json']) copyFileSync(join(src, f), join(dst, f));
if (existsSync(join(dst, 'tasks.ndjson'))) rmSync(join(dst, 'tasks.ndjson')); // fresh task state → all proposals become pending

console.log('e2e-seed: fixtures copied to reports/_e2e/ · pushing tiered pending queue to the store…');
const { loadConfig } = await import('../src/config.mjs');
const { pushDashboard } = await import('../src/dashboard.mjs');
const cfg = await loadConfig('_e2e');
await pushDashboard(cfg, { log: (m) => console.log('  ' + m) });
console.log('e2e-seed: done — run `node test/e2e-dashboard.mjs` (needs `gh` store auth for the push).');
