#!/usr/bin/env node
// seo-bot · NO-CLOUD smoke test — the Dual-Use Mandate, executable.
//
// Proves in-house mode needs NO network and NO cloud/SaaS configuration: with
// GH_TOKEN / STORE_REPO / DATABASE_URL / SEENAI_* (and the bot's own store/dashboard envs)
// all UNSET and globalThis.fetch stubbed to THROW, the core local loop still works:
//
//   1. `help` + `list` render (child processes, fetch-stubbed via --require preload)
//   2. `dashboard --local` pushes pending AND pulls decisions against reports/<client>/ files
//   3. `apply` (dryrun adapter) works on a fixture proposal
//   4. `priors` and `onpage-coverage` run
//
// …and ZERO fetch attempts are observed across the in-process commands. This test is part
// of `npm test` (bin/seo-bot.mjs test) and is a release blocker: a feature that only works
// through the cloud is a defect.
//
//   node seo-bot/test/no-cloud.mjs      (exit 1 on any failure; cleans up its fixtures)

// ---- 0) scrub every cloud/SaaS env + stub fetch BEFORE any src import ----------------
const SCRUB = [
  'GH_TOKEN', 'GITHUB_TOKEN', 'STORE_REPO', 'DATABASE_URL',
  'SEO_BOT_STORE_REPO', 'SEO_BOT_DASHBOARD_URL', 'SEO_BOT_DASHBOARD_TOKEN', 'AUTH_TOKEN',
];
for (const k of Object.keys(process.env)) if (k.startsWith('SEENAI_')) delete process.env[k];
for (const k of SCRUB) delete process.env[k];

let fetchAttempts = 0;
globalThis.fetch = () => { fetchAttempts++; throw new Error('no-cloud violation: network fetch attempted'); };

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { ROOT, CONFIG_DIR, loadConfig } = await import('../src/config.mjs');

let pass = 0, fail = 0; const out = [];
const check = (name, cond) => { if (cond) { pass++; out.push(`  ✓ ${name}`); } else { fail++; out.push(`  ✗ ${name}`); } };

const CLIENT = '_nocloud';
const CFG_FILE = join(CONFIG_DIR, `${CLIENT}.json`);
const REP = join(ROOT, 'reports', CLIENT);
const COVERAGE_MD = join(ROOT, 'reports', 'onpage-coverage.md');
const coverageExisted = existsSync(COVERAGE_MD);
const coverageOriginal = coverageExisted ? readFileSync(COVERAGE_MD) : null;
const tmp = mkdtempSync(join(tmpdir(), 'seo-bot-no-cloud-'));

const cleanup = () => {
  try { rmSync(CFG_FILE, { force: true }); } catch { /* */ }
  try { rmSync(REP, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  // restore reports/onpage-coverage.md to its pre-test state (side-effect-free)
  try {
    if (coverageExisted) writeFileSync(COVERAGE_MD, coverageOriginal);
    else rmSync(COVERAGE_MD, { force: true });
  } catch { /* */ }
};

try {
  // ---- 1) help + list render (child procs: scrubbed env inherited + fetch-throw preload) ----
  const stub = join(tmp, 'no-fetch.cjs');
  writeFileSync(stub, `globalThis.fetch = () => { throw new Error('no-cloud violation: fetch'); };\n`);
  const bin = join(__dirname, '..', 'bin', 'seo-bot.mjs');
  const cli = (...args) => execFileSync(process.execPath, ['--require', stub, bin, ...args], {
    encoding: 'utf-8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
  });

  const help = cli('help');
  check('no-cloud: `help` renders with no network + no cloud env', /Commands:/.test(help) && /dashboard <client>/.test(help));
  const list = cli('list');
  check('no-cloud: `list` renders configured clients offline', typeof list === 'string' && list.trim().length > 0 && !/seo-bot failed/.test(list));

  // ---- fixture client + proposal (local files are the source of truth) ----
  writeFileSync(CFG_FILE, JSON.stringify({
    name: CLIENT, brand: 'NoCloud Spa', domain: 'nocloud.example',
    baseUrl: 'https://nocloud.example', cms: { type: 'dryrun' }, screenshots: false,
  }, null, 2));
  const cfg = loadConfig(CLIENT);
  mkdirSync(REP, { recursive: true });
  writeFileSync(join(REP, 'proposals-2026-01-01.json'), JSON.stringify({
    client: CLIENT, generatedAt: '2026-01-01T00:00:00.000Z',
    proposals: [{
      type: 'meta', page: 'https://nocloud.example/services', severity: 'low', priority: 4,
      autoApplicable: true, current: 'Old meta description.',
      proposed: 'Med spa services in Example City — pricing, providers, and booking.',
      rationale: 'meta length below minimum (no-cloud fixture)',
    }],
  }, null, 2));

  // ---- 2) dashboard --local: push pending → decide → pull decisions ----
  const D = await import('../src/dashboard.mjs');
  const pushed = await D.pushDashboard(cfg, { local: true, log: () => {} });
  const pendingFile = join(REP, 'dashboard-pending.json');
  check('no-cloud: dashboard --local push writes reports/<c>/dashboard-pending.json', existsSync(pendingFile) && pushed.count === 1);
  const pending = JSON.parse(readFileSync(pendingFile, 'utf-8'));
  check('no-cloud: pushed record carries a bot-stamped tier (contract shape)', ['green', 'amber', 'red'].includes(pending.records?.[0]?.tier) && pending.records[0].schema === 1);
  check('no-cloud: --local push also writes the artifact bundle locally (no store)', existsSync(join(REP, 'dashboard-bundle.json')));

  const { currentTasks } = await import('../src/tasks.mjs');
  const task = currentTasks(CLIENT).find((t) => t.taskKey === 'meta:https://nocloud.example/services');
  check('no-cloud: push created the task locally (tasks.ndjson)', !!task && ['proposed', 'queued'].includes(task.status));
  writeFileSync(join(REP, 'dashboard-decisions.json'), JSON.stringify({
    client: CLIENT, decisions: [{ taskId: task?.id, decision: 'approve', actor: 'no-cloud-test' }],
  }, null, 2));
  const pulled = await D.pullDashboard(cfg, { local: true, log: () => {} });
  check('no-cloud: dashboard --local pull turns the file decision into an approval', pulled.approved === 1 && pulled.rejected === 0);
  check('no-cloud: approved status landed in the local task ledger', currentTasks(CLIENT).find((t) => t.id === task?.id)?.status === 'approved');

  // ---- 3) apply (dryrun adapter) on the fixture proposal ----
  const { applyClient } = await import('../src/apply/index.mjs');
  const applied = await applyClient(cfg, { log: () => {}, confirm: false });
  check('no-cloud: apply dryrun works on the fixture proposal (writes intended-changes.md, changes nothing)',
    applied?.dryrun === true && Array.isArray(applied.applied) && applied.applied.length === 0 && existsSync(join(REP, 'intended-changes.md')));

  // ---- 4) priors + onpage-coverage run ----
  const priorsRoot = join(tmp, 'reports');
  mkdirSync(join(priorsRoot, 'fixtureclient'), { recursive: true });
  writeFileSync(join(priorsRoot, 'fixtureclient', 'decisions.ndjson'), [
    JSON.stringify({ decision: 'keep', type: 'meta' }),
    JSON.stringify({ decision: 'revert', type: 'title' }),
    JSON.stringify({ decision: 'try-next', type: 'meta' }),
  ].join('\n') + '\n');
  const { runPriors } = await import('../src/portfolio-priors.mjs');
  const priors = await runPriors({ log: () => {}, rebuild: true, reportsRoot: priorsRoot });
  check('no-cloud: priors rebuild runs offline (keep+revert aggregated, non-outcome excluded)',
    priors && priors.outcomes === 2 && priors.nonOutcomes === 1 && existsSync(join(priorsRoot, '_portfolio', 'priors.json')));

  const { runCoverage } = await import('../scripts/onpage-coverage.mjs');
  const cov = await runCoverage({ log: () => {} });
  check('no-cloud: onpage-coverage self-verifies offline (0 broken cells, md written)',
    cov && Array.isArray(cov.broken) && cov.broken.length === 0 && existsSync(COVERAGE_MD));

  // ---- 5) the receipt: nothing above even TRIED the network ----
  check('no-cloud: zero fetch attempts across every in-process command', fetchAttempts === 0);

  console.log(`\nseo-bot no-cloud smoke test (dual-use mandate: in-house mode needs no cloud)\n${'-'.repeat(60)}`);
  console.log(out.join('\n'));
  console.log(`${'-'.repeat(60)}\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.error('no-cloud smoke test crashed:', e);
  fail++;
} finally {
  cleanup();
}
process.exit(fail ? 1 : 0);
