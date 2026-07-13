#!/usr/bin/env node
// seenai-runner — the local runner for the SeenAI control plane (ARCHITECTURE-SAAS §2).
//
//   npx seenai-runner pair --org <org> --token <pairing-token> [--runner-id <id>]
//   npx seenai-runner [run] [--once] [--dry-run] [--interval <minutes>] [--jitter <seconds>]
//
// Credentials: SEENAI_ORG / SEENAI_RUNNER_ID / SEENAI_RUNNER_TOKEN envs win; otherwise the
// gitignored secrets/runner.json written by `pair`. A refused token exits with instructions —
// the runner NEVER retries into a lockout. SIGINT/SIGTERM finish the current order, then exit.
//
// Dual-use mandate: this process only exists when YOU start it. No default seo-bot CLI flow
// imports or polls anything.

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { runRunner, verifyPairing, createDefaultStore, RUNNER_VERSION } from '../src/runner.mjs';
import { ROOT } from '../src/config.mjs';

const log = (...a) => console.log(...a);
const CREDS_FILE = join(ROOT, 'secrets', 'runner.json'); // secrets/ is gitignored

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args.flags[key] = next; i++; }
      else args.flags[key] = true;
    } else args._.push(a);
  }
  return args;
}

function fileCreds() {
  try { return existsSync(CREDS_FILE) ? JSON.parse(readFileSync(CREDS_FILE, 'utf-8')) : {}; }
  catch { return {}; }
}

function resolveCreds(flags) {
  const f = fileCreds();
  return {
    org: (typeof flags.org === 'string' && flags.org) || process.env.SEENAI_ORG || f.org || '_default',
    runnerId: (typeof flags['runner-id'] === 'string' && flags['runner-id']) || process.env.SEENAI_RUNNER_ID || f.runnerId || '',
    token: (typeof flags.token === 'string' && flags.token) || process.env.SEENAI_RUNNER_TOKEN || process.env.SEENAI_PAIRING_TOKEN || f.token || '',
  };
}

function help() {
  log(`seenai-runner v${RUNNER_VERSION} — pairs with the SeenAI control plane and executes queued work orders`);
  log('  through the EXISTING gated seo-bot flows (closed allowlist; unknown order types are refused).');
  log('');
  log('Commands:');
  log('  pair --org <org> --token <t> [--runner-id <id>]  verify the pairing token against the store row and save it locally');
  log('  run  [--once] [--dry-run] [--interval <min>] [--jitter <sec>]  poll loop (default command)');
  log('');
  log('Flags:');
  log('  --once       one poll: claim + execute AT MOST one order, then exit (cron target)');
  log('  --dry-run    read-only: print the queued orders and what each WOULD run; claim nothing, write nothing');
  log('  --interval   poll interval in minutes (default 5; env SEENAI_POLL_MINUTES)');
  log('  --jitter     max extra random delay in seconds (default: 10% of the interval)');
  log('');
  log('Env: SEENAI_ORG · SEENAI_RUNNER_ID · SEENAI_RUNNER_TOKEN · SEO_BOT_STORE_REPO · DATABASE_URL (optional pg driver)');
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0] || 'run';
  if (cmd === 'help' || flags.help || flags.h) { help(); return; }

  const creds = resolveCreds(flags);
  let store;
  try { store = await createDefaultStore({ log, org: creds.org }); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }

  if (cmd === 'pair') {
    if (!creds.token || !creds.runnerId) {
      console.error('✗ pair needs --token <pairing-token> and --runner-id <id> (both issued by the control plane, shown once).');
      process.exit(1);
    }
    const pair = await verifyPairing(store, creds);
    if (!pair.ok) { console.error(`✗ pairing refused (${pair.reason}) — nothing saved. Check org/runner-id/token with the control plane.`); process.exit(1); }
    mkdirSync(join(ROOT, 'secrets'), { recursive: true });
    writeFileSync(CREDS_FILE, JSON.stringify({ org: creds.org, runnerId: creds.runnerId, token: creds.token, pairedAt: new Date().toISOString() }, null, 2));
    try { chmodSync(CREDS_FILE, 0o600); } catch { /* windows */ }
    log(`✓ paired runner ${creds.runnerId} (org ${creds.org}) — credentials saved to ${CREDS_FILE} (gitignored).`);
    log(`  Start polling: npx seenai-runner            (or --once from cron)`);
    return;
  }

  if (cmd !== 'run') { console.error(`✗ unknown command "${cmd}" — try: seenai-runner help`); process.exit(1); }

  const minutes = Number(flags.interval ?? process.env.SEENAI_POLL_MINUTES ?? 5);
  const intervalMs = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60_000) : 5 * 60_000;
  const jitterSec = Number(flags.jitter);
  const controller = new AbortController();
  let stopping = false;
  const onSignal = (sig) => {
    if (stopping) process.exit(130); // second signal → hard exit
    stopping = true;
    log(`\n${sig} received — finishing the current order, then exiting…`);
    controller.abort();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  const r = await runRunner({
    store,
    org: creds.org,
    runnerId: creds.runnerId,
    token: creds.token,
    once: !!flags.once,
    dryRun: !!flags['dry-run'],
    intervalMs,
    ...(Number.isFinite(jitterSec) && jitterSec >= 0 ? { jitterMs: Math.round(jitterSec * 1000) } : {}),
    signal: controller.signal,
    log,
  });
  if (!r.ok) process.exit(1);
}

main().catch((e) => { console.error('seenai-runner failed:', e); process.exit(1); });
