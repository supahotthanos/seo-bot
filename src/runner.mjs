// seo-bot · seenai-runner — the local half of the SeenAI control plane (ARCHITECTURE-SAAS §2).
//
// A thin poller: pairs against `runners/<org>/<runnerId>` with a token (the store keeps only
// the scrypt hash — mismatch REFUSES, never retries into a lockout), claims ONE work order at
// a time via the store's atomic claim, and executes it through EXISTING gated CLI flows only.
//
// THE RUNNER GAINS NO NEW WRITE AUTHORITY. It dispatches a CLOSED allowlist of order types to
// the same entry points a human would run (`dashboard --sync`, `weekly --push`, audit+propose
// +dashboard push). Apply paths still require dashboard-approved decisions inside those flows;
// the runner never passes an auto-approval flag on its own, and an unknown order type is
// marked failed with a reason — never guessed, never eval'd (fail closed).
//
// Dual-use mandate: no runner process exists unless explicitly invoked (`npx seenai-runner`);
// nothing in the default CLI path imports this module.

import { scryptSync, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

export const RUNNER_VERSION = (() => {
  try { return createRequire(import.meta.url)('../package.json').version || '0.0.0'; } catch { return '0.0.0'; }
})();

// CLOSED enum — store/CONTRACT.md §3.12. New types require a runner release.
export const WORK_ORDER_TYPES = Object.freeze(['sync-dashboard', 'weekly-run', 'first-audit']);

// first-audit configs arrive in the order payload (untrusted): only the dry-run adapter and
// the PR-only adapters are accepted. Live-write CMS types (wordpress, anything unknown) are
// refused via allowlist — fail closed, a typo'd cms type never executes.
export const FIRST_AUDIT_CMS_ALLOW = Object.freeze(['dryrun', 'nextjs', 'edge', 'cloudflare-worker']);

// Path-segment armor (CONTRACT §1) + org slug rule (CONTRACT §2:
// '_default' is the ONLY underscore-prefixed org — any other is refused).
const SEG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const ORG_RE = /^(?:_default|[a-z0-9][a-z0-9-]{0,31})$/;

// ---------------------------------------------------------------------------
// Pairing — scrypt + timingSafeEqual against the store row. Every malformed
// input path returns false (deny), never throws, never grants.
// ---------------------------------------------------------------------------

/** Verify a raw pairing token against a `runners/<org>/<id>` row's scrypt hash. */
export function verifyPairingToken(token, row) {
  try {
    if (typeof token !== 'string' || !token) return false;
    const s = row && row.pairingTokenScrypt;
    if (!s || typeof s !== 'object' || s.algo !== 'scrypt') return false;
    const { N, r, p, keylen } = s;
    if (![N, r, p, keylen].every((n) => Number.isInteger(n) && n > 0)) return false;
    if (N < 1024 || N > 1048576 || (N & (N - 1)) !== 0 || r > 32 || p > 16 || keylen < 16 || keylen > 128) return false;
    const salt = Buffer.from(String(s.salt || ''), 'base64');
    const expect = Buffer.from(String(s.hash || ''), 'base64');
    if (salt.length < 8 || expect.length !== keylen) return false;
    const got = scryptSync(token, salt, keylen, { N, r, p, maxmem: 512 * 1024 * 1024 });
    return timingSafeEqual(got, expect);
  } catch { return false; }
}

/** Resolve + verify the runner's registration. Missing/malformed/revoked row → refuse. */
export async function verifyPairing(store, { org, runnerId, token } = {}) {
  if (!store || typeof store.getJson !== 'function') return { ok: false, reason: 'no-store' };
  if (!ORG_RE.test(String(org || ''))) return { ok: false, reason: 'bad-org' };
  if (!SEG_RE.test(String(runnerId || ''))) return { ok: false, reason: 'missing-runner-id' };
  let row = null;
  try { row = await store.getJson(`runners/${org}/${runnerId}.json`); } catch { row = null; }
  if (!row || typeof row !== 'object') return { ok: false, reason: 'runner-not-registered' };
  if (row.status !== 'active') return { ok: false, reason: `runner-${String(row.status || 'malformed')}` };
  if (!verifyPairingToken(token, row)) return { ok: false, reason: 'pairing-token-mismatch' };
  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// Work-order validation — strict, before ANY execution (even injected executors).
// ---------------------------------------------------------------------------

/**
 * Validate a claimed order against the closed contract. Unknown type / malformed order /
 * org mismatch / live-write cms in a first-audit payload → { ok:false, reason } and the
 * caller marks the order failed. For first-audit the validated cfg (via buildConfig) is
 * returned so execution uses EXACTLY what was validated.
 */
export async function validateWorkOrder(order, { org = '_default' } = {}) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return { ok: false, reason: 'malformed-order' };
  if (typeof order.id !== 'string' || !SEG_RE.test(order.id)) return { ok: false, reason: 'malformed-order:id' };
  const t = order.type;
  if (typeof t !== 'string' || !WORK_ORDER_TYPES.includes(t)) return { ok: false, reason: `unknown-type:${String(t).slice(0, 64)}` };
  if (order.org != null && order.org !== org) return { ok: false, reason: `org-mismatch:${String(order.org).slice(0, 64)}` };

  if (t === 'first-audit') {
    const raw = order.payload && order.payload.config;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'first-audit:missing-config' };
    let cfg;
    try {
      const { buildConfig } = await import('./config.mjs');
      cfg = buildConfig(raw);
    } catch (e) { return { ok: false, reason: `first-audit:invalid-config:${String(e && e.message || e).slice(0, 120)}` }; }
    const cms = (cfg.cms && cfg.cms.type) || 'dryrun';
    if (!FIRST_AUDIT_CMS_ALLOW.includes(cms)) return { ok: false, reason: `first-audit:live-write-cms:${String(cms).slice(0, 64)}` };
    if (!SEG_RE.test(String(cfg.name || ''))) return { ok: false, reason: 'first-audit:bad-client-slug' };
    if (order.client != null && order.client !== cfg.name) return { ok: false, reason: 'first-audit:client-mismatch' };
    return { ok: true, cfg };
  }

  // sync-dashboard | weekly-run act on an EXISTING local client config by name.
  if (typeof order.client !== 'string' || !SEG_RE.test(order.client)) return { ok: false, reason: 'malformed-order:client' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dispatch — closed map, existing gated entry points only.
// ---------------------------------------------------------------------------

const DEFAULT_EXECUTORS = {
  // dashboard <client> --sync : push pending → pull decisions. No apply pass here — approved
  // decisions execute through the weekly routine / an explicit human `apply-approved`.
  'sync-dashboard': async (order, ctx) => {
    const { loadConfig } = await import('./config.mjs');
    const { syncDashboard } = await import('./dashboard.mjs');
    const cfg = loadConfig(order.client);
    const r = await syncDashboard(cfg, { log: ctx.log });
    return { approved: r?.approved ?? 0, rejected: r?.rejected ?? 0, skipped: r?.skipped ?? 0 };
  },
  // weekly <client> --push : the existing autonomous weekly cycle (cron target) — read loop →
  // consensus autopilot (PR-only) → dashboard sync (applies only human-APPROVED decisions
  // through PR adapters) → brief. `push:false` in the payload downgrades to plan-only.
  'weekly-run': async (order, ctx) => {
    const { loadConfig } = await import('./config.mjs');
    const { weeklyRoutine } = await import('./routine.mjs');
    const cfg = loadConfig(order.client);
    const push = !(order.payload && order.payload.push === false);
    return weeklyRoutine(cfg, { log: ctx.log, push });
  },
  // audit + propose + dashboard push for a payload-delivered config (already validated via
  // buildConfig + the cms allowlist — ctx.cfg is the validated object, nothing re-parsed).
  'first-audit': async (order, ctx) => {
    const cfg = ctx.cfg;
    if (!cfg) throw new Error('first-audit: validated config missing');
    const { runAudit } = await import('./audit.mjs');
    const { saveReport } = await import('./report.mjs');
    const { propose } = await import('./decide.mjs');
    const { pushDashboard } = await import('./dashboard.mjs');
    const audit = await runAudit(cfg, { log: ctx.log });
    saveReport(audit);
    await propose(cfg, { log: ctx.log });
    const pushed = await pushDashboard(cfg, { log: ctx.log, runId: order.id });
    return { client: cfg.name, auditScore: audit.score, pending: pushed?.count ?? 0, tiers: pushed?.tiers ?? null };
  },
};

const ACTION_DESC = {
  'sync-dashboard': (o) => `dashboard ${o.client} --sync (push pending → pull decisions)`,
  'weekly-run': (o) => `weekly ${o.client}${o.payload && o.payload.push === false ? '' : ' --push'} (existing weekly routine)`,
  'first-audit': (o) => `first-audit for payload config${o.client ? ` "${o.client}"` : ''} (audit → propose → dashboard push)`,
};

/** Small, JSON-safe result summary — never let a huge/cyclic result break the store write. */
function safeResult(result) {
  try {
    const s = JSON.stringify(result ?? null);
    if (s.length <= 4096) return JSON.parse(s);
    return { truncated: true, bytes: s.length };
  } catch { return { unserializable: true }; }
}

async function auditLog(store, org, runnerId, action, subject, detail) {
  try {
    if (typeof store.appendLog !== 'function') return;
    const at = new Date().toISOString();
    await store.appendLog(`audit/${org}/${at.slice(0, 7)}.ndjson`, {
      at, actorEmail: `runner:${runnerId}`, role: null, ip: null,
      action, subject: String(subject ?? '').slice(0, 128), detail: detail || {},
    });
  } catch { /* audit is best-effort on the runner side; the store enforces append-only */ }
}

/**
 * Validate + execute ONE claimed order, then mark it done|failed in the store.
 * Never throws; every path lands in a terminal status with a reason.
 */
export async function handleOrder(order, { store, org = '_default', runnerId = '?', log = () => {}, executors = DEFAULT_EXECUTORS, now = () => new Date() } = {}) {
  const id = (order && typeof order.id === 'string' && SEG_RE.test(order.id)) ? order.id : null;
  const finish = async (patch) => {
    if (id) {
      try {
        await store.putJson(`work-orders/${org}/${id}.json`,
          { ...order, ...patch, finishedAt: now().toISOString() },
          `runner ${runnerId}: ${patch.status} ${id}`);
      } catch { /* completion write best-effort; control plane re-queues stale claims */ }
    }
    await auditLog(store, org, runnerId, `work-order.${patch.status}`, id || 'malformed', patch.error ? { error: patch.error } : { type: order && order.type || null });
  };

  const v = await validateWorkOrder(order, { org });
  if (!v.ok) {
    log(`  ✗ order ${id || '(no id)'} refused: ${v.reason}`);
    await finish({ status: 'failed', error: v.reason });
    return { status: 'failed', error: v.reason };
  }
  const exec = executors[order.type];
  if (typeof exec !== 'function') { // belt-and-suspenders: allowlist gap = refusal, never a guess
    const reason = `unknown-type:${order.type}`;
    await finish({ status: 'failed', error: reason });
    return { status: 'failed', error: reason };
  }
  try {
    log(`  ▶ ${order.type} ${order.client || v.cfg?.name || ''} (${id})`);
    const result = await exec(order, { log, cfg: v.cfg || null, org, runnerId });
    await finish({ status: 'done', result: safeResult(result) });
    log(`  ✓ done ${id}`);
    return { status: 'done', result: safeResult(result) };
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    await finish({ status: 'failed', error: msg });
    log(`  ✗ failed ${id}: ${msg}`);
    return { status: 'failed', error: msg };
  }
}

// ---------------------------------------------------------------------------
// Plan-limit double-check (ARCHITECTURE-SAAS §6) — in-house `_default` is NEVER
// metered (dual-use mandate); any other org with a missing/malformed limits row
// pauses visibly, orders stay queued.
// ---------------------------------------------------------------------------

export async function limitsPause(store, org) {
  if (org === '_default') return null; // in-house mode: no limits exist, nothing metered
  let lim = null;
  try { lim = await store.getJson(`limits/${org}.json`); } catch { lim = null; }
  const wellFormed = lim && typeof lim === 'object'
    && ['sites', 'promptsPerWeek', 'experiments'].every((k) => Number.isFinite(lim[k]) && lim[k] >= 0);
  if (!wellFormed) return { reason: 'no-plan-limits-on-record' };
  try {
    const clients = await store.listDir(`pending/${org}`);
    if (Array.isArray(clients) && clients.length > lim.sites) return { reason: `over-site-limit:${clients.length}/${lim.sites}` };
  } catch { return { reason: 'limits-usage-unreadable' }; }
  return null;
}

// ---------------------------------------------------------------------------
// The poll loop.
// ---------------------------------------------------------------------------

/** Next poll delay: interval + positive jitter (thundering-herd guard). Exported for tests. */
export function nextDelayMs(intervalMs, jitterMs, rand = Math.random) {
  const base = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5 * 60_000;
  const jit = Number.isFinite(jitterMs) && jitterMs > 0 ? Math.floor(rand() * jitterMs) : 0;
  return Math.max(250, base + jit);
}

function sleepAbortable(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); if (signal) signal.removeEventListener('abort', done); resolve(); }
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * SEC hardening (adversarial review): the old heartbeat was a read-modify-write race — an
 * admin flipping runners/<org>/<id> to status:'revoked' between the runner's read and its
 * putJson was silently RESURRECTED by the heartbeat write. Now:
 *   · CAS drivers (optional getJsonMeta/putJsonRev pair — the gh wire is sha-CAS): read
 *     {doc, rev}, write ONLY at that rev; a concurrent change fails the put → re-read →
 *     revoked? STOP : skip one beat. The revocation can never be overwritten.
 *   · non-CAS drivers: re-read the row IMMEDIATELY before the write and merge the two
 *     heartbeat fields (lastHeartbeatAt, version) onto that FRESH row — a stale row is
 *     never written back.
 * Either way a revoked runner stops within one heartbeat cycle and never writes status.
 * Exported for tests.
 */
export async function heartbeat(store, org, runnerId, { now, version }) {
  const path = `runners/${org}/${runnerId}.json`;
  const gate = (row) => {
    if (!row || typeof row !== 'object') return { ok: false, reason: 'runner-not-registered' };
    if (row.status !== 'active') return { ok: false, reason: `runner-${String(row.status || 'malformed')}` }; // revoked mid-run → stop
    return null;
  };
  const reRead = async () => { try { return await store.getJson(path); } catch { return null; } };
  const beat = (row) => ({ ...row, lastHeartbeatAt: now().toISOString(), version }); // ONLY these two fields change

  if (typeof store.getJsonMeta === 'function' && typeof store.putJsonRev === 'function') {
    let meta = null;
    try { meta = await store.getJsonMeta(path); } catch { meta = null; }
    const row = meta && meta.doc;
    const bad = gate(row); if (bad) return bad;
    let put = null;
    try { put = await store.putJsonRev(path, beat(row), `heartbeat ${runnerId}`, meta.rev); } catch { put = null; }
    if (put && put.ok !== false) return { ok: true, row };
    const fresh = await reRead();                    // lost the CAS — someone changed the row under us
    const badF = gate(fresh); if (badF) return badF; // revoked/deleted → STOP; the revocation stands
    return { ok: true, row: fresh, stale: true };    // benign race (admin edit, still active) → skip one beat, never blind-retry
  }

  const row = await reRead();
  const bad = gate(row); if (bad) return bad;
  const fresh = await reRead();                      // re-read IMMEDIATELY before the write (race guard)
  const badF = gate(fresh); if (badF) return badF;
  try {
    const put = await store.putJson(path, beat(fresh), `heartbeat ${runnerId}`);
    if (put && put.ok !== false) return { ok: true, row: fresh };
    const after = await reRead();                    // write refused — was it a concurrent revocation?
    const badA = gate(after); if (badA) return badA;
    return { ok: false, reason: 'heartbeat-write-refused' };
  } catch { return { ok: true, row: fresh, stale: true }; } // one flaky write ≠ dead runner; pairing/claim stay gated
}

/**
 * Run the runner. Pairing is verified FIRST (mismatch → refuse, exit — never a retry loop
 * into a lockout). Then per poll: heartbeat → plan-limit double-check → claim at most ONE
 * order → validate → dispatch → mark done/failed. `once` = single poll (cron). `dryRun` =
 * read-only: prints planned work, claims nothing, writes nothing.
 *
 * @param {object} opts
 *   store       StoreDriver (required) — see store/CONTRACT.md §1
 *   org         org slug (default env SEENAI_ORG or '_default')
 *   runnerId    runner id (default env SEENAI_RUNNER_ID)
 *   token       raw pairing token (default env SEENAI_RUNNER_TOKEN)
 *   once/dryRun booleans
 *   intervalMs/jitterMs  poll cadence (defaults 5 min / 10% jitter)
 *   maxPolls    loop bound (tests; default Infinity)
 *   signal      AbortSignal — graceful shutdown (current order always finishes)
 *   executors   test seam — merged OVER the closed default dispatch map
 */
export async function runRunner(opts = {}) {
  const {
    store,
    org = process.env.SEENAI_ORG || '_default',
    runnerId = process.env.SEENAI_RUNNER_ID || '',
    token = process.env.SEENAI_RUNNER_TOKEN || process.env.SEENAI_PAIRING_TOKEN || '',
    once = false,
    dryRun = false,
    intervalMs = 5 * 60_000,
    jitterMs = Math.max(1000, Math.floor(intervalMs / 10)),
    maxPolls = Infinity,
    log = () => {},
    executors: executorOverrides = {},
    now = () => new Date(),
    rand = Math.random,
    signal = null,
    version = RUNNER_VERSION,
  } = opts;
  const executors = { ...DEFAULT_EXECUTORS, ...executorOverrides };

  if (!store || typeof store.getJson !== 'function' || typeof store.claimWorkOrder !== 'function') {
    log('✗ refusing to start: no store driver. Configure the gh store (gh auth) or DATABASE_URL.');
    return { ok: false, refused: 'no-store', processed: 0 };
  }
  if (typeof store.configured === 'function' && !store.configured()) {
    log('✗ refusing to start: the store wire is not configured.');
    return { ok: false, refused: 'store-not-configured', processed: 0 };
  }

  // Pairing gate — fail closed, with instructions, no retry (never lock the token out).
  const pair = await verifyPairing(store, { org, runnerId, token });
  if (!pair.ok) {
    log(`✗ pairing refused (${pair.reason}).`);
    log('  Fix: set SEENAI_ORG / SEENAI_RUNNER_ID / SEENAI_RUNNER_TOKEN to the values the');
    log('  control plane issued (Settings → Runners), or re-pair: seenai-runner pair --org <org> --token <token>.');
    log('  The runner will NOT retry a refused token.');
    return { ok: false, refused: pair.reason, processed: 0 };
  }
  log(`✓ paired: runner ${runnerId} · org ${org} · v${version}${dryRun ? ' · DRY-RUN (read-only)' : ''}`);

  // --dry-run: list queued work + what WOULD run. No claim, no heartbeat, zero writes.
  if (dryRun) {
    const planned = [];
    let names = [];
    try { names = await store.listDir(`work-orders/${org}`); } catch { names = []; }
    for (const n of Array.isArray(names) ? names : []) {
      let o = null;
      try { o = await store.getJson(`work-orders/${org}/${n}.json`); } catch { o = null; }
      if (!o || o.status !== 'queued') continue;
      const v = await validateWorkOrder(o, { org });
      const would = v.ok ? ACTION_DESC[o.type](o) : `REFUSE (${v.reason})`;
      planned.push({ id: o.id || n, type: o.type ?? null, client: o.client ?? null, would });
      log(`  plan: [${o.type ?? '?'}] ${o.id || n} → ${would}`);
    }
    if (!planned.length) log('  plan: queue empty — nothing to do.');
    return { ok: true, dryRun: true, planned, processed: 0, polls: 1 };
  }

  let processed = 0, polls = 0;
  const results = [];
  for (;;) {
    polls++;
    const hb = await heartbeat(store, org, runnerId, { now, version });
    if (!hb.ok) {
      log(`✗ stopping: ${hb.reason} (heartbeat re-check).`);
      return { ok: false, refused: hb.reason, processed, polls, results };
    }
    const pause = await limitsPause(store, org);
    if (pause) {
      log(`⏸ paused — ${pause.reason}. Orders stay queued; nothing executes until the plan is fixed.`);
    } else {
      let order = null;
      try { order = await store.claimWorkOrder(org, runnerId, WORK_ORDER_TYPES.slice()); }
      catch (e) { log(`  claim error (${String(e && e.message || e).slice(0, 120)}) — retrying next poll.`); }
      if (order) {
        await auditLog(store, org, runnerId, 'work-order.claim', order.id, { type: order.type ?? null });
        const r = await handleOrder(order, { store, org, runnerId, log, executors, now });
        processed++;
        results.push({ id: order.id ?? null, type: order.type ?? null, ...r });
      } else {
        log('  queue empty.');
      }
    }
    if (once || polls >= maxPolls || (signal && signal.aborted)) break;
    await sleepAbortable(nextDelayMs(intervalMs, jitterMs, rand), signal);
    if (signal && signal.aborted) { log('  shutdown requested — exiting cleanly.'); break; }
  }
  return { ok: true, processed, polls, results };
}

// ---------------------------------------------------------------------------
// Default store — prefer the shared driver module (S2) when present; otherwise a
// minimal built-in gh-repo driver. DATABASE_URL without a usable Postgres path
// REFUSES with instructions (never a silent fallback).
// ---------------------------------------------------------------------------

export async function createDefaultStore({ log = () => {}, org = process.env.SEENAI_ORG || '_default', storeOpts = {} } = {}) {
  let m = null;
  try { m = await import('./store/index.mjs'); }
  catch (e) { if (e && e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } // real driver error → surface, not mask
  if (m && typeof m.getStore === 'function') {
    // Shared store module (store/CONTRACT.md v1). defaultDriver 'gh' preserves the runner's
    // historical no-env wire (seenai-queue); DATABASE_URL/STORE_REPO selection + the
    // pg-missing refusal live inside getStore (fail closed, never a silent fallback).
    // storeOpts is a test seam (fake pg / fs root) — production callers pass nothing.
    const wrapped = await m.getStore(process.env, { org, defaultDriver: 'gh', ...storeOpts });
    return {
      configured: () => wrapped.configured(),
      getJson: (p) => wrapped.getJson(p),
      putJson: (p, doc, msg) => wrapped.putJson(p, doc, msg),
      deleteJson: (p, msg) => wrapped.deleteJson(p, msg),
      listDir: (p) => wrapped.listDir(p),
      getBlob: (p) => wrapped.getBlob(p),
      putBlob: (p, b, msg) => wrapped.putBlob(p, b, msg),
      appendLog: (p, row) => wrapped.appendLog(p, row),
      // Driver-signature claim bridged through the org-scoped wrapper so the wrapper's
      // runner-row-must-be-ACTIVE gate (CONTRACT §3.13) applies on top of the runner's own
      // heartbeat re-check — the MORE restrictive path. Org mismatch → deny (fail closed).
      claimWorkOrder: (o, runnerId, types) => (o === wrapped.org ? wrapped.claimWorkOrder(runnerId, types) : null),
      // Optional CAS pair (CONTRACT §1) bridged ONLY when the driver has it (gh sha-CAS) —
      // the heartbeat feature-detects it so a concurrent revocation fails the put.
      ...(typeof wrapped.getJsonMeta === 'function' && typeof wrapped.putJsonRev === 'function'
        ? { getJsonMeta: (p) => wrapped.getJsonMeta(p), putJsonRev: (p, doc, msg, rev) => wrapped.putJsonRev(p, doc, msg, rev) }
        : {}),
    };
  }
  if (m) { // shared module present but without the expected factory → never guess a wire
    throw new Error('src/store/index.mjs is present but exports no getStore() — refusing to guess a store wire (fail closed). Update seenai-runner and the store module together.');
  }
  if (process.env.DATABASE_URL) {
    try { await import('pg'); }
    catch {
      throw new Error('DATABASE_URL is set but the optional "pg" dependency is not installed.\n  Fix: npm install pg   — or unset DATABASE_URL to use the gh-repo store.');
    }
    throw new Error('DATABASE_URL is set but this build has no Postgres store driver (src/store/ not present).\n  Fix: update seo-bot to a build that ships the Postgres driver, or unset DATABASE_URL to use the gh-repo store.');
  }
  return ghStore({ log });
}

/** Minimal gh-repo StoreDriver (CONTRACT v0 wire): `gh api` against the private store repo.
 *  Runner-touched kinds (runners/, work-orders/, limits/, audit/) are org-prefixed for EVERY
 *  org including `_default` — the legacy unprefixed mapping only covers the v0 dashboard kinds. */
export function ghStore({ log = () => {} } = {}) {
  const repo = process.env.SEO_BOT_STORE_REPO || process.env.STORE_REPO || 'supahotthanos/seenai-queue';
  const api = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf-8', input, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  const okPath = (p) => typeof p === 'string' && p.length > 0 && p.split('/').every((s) => SEG_RE.test(s));
  const read = (p) => { const j = JSON.parse(api([`repos/${repo}/contents/${p}`])); return { sha: j.sha, text: Buffer.from(j.content || '', 'base64').toString('utf8') }; };
  const write = (p, text, message, sha) => {
    const body = JSON.stringify({ message, content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) });
    api([`repos/${repo}/contents/${p}`, '-X', 'PUT', '--input', '-'], body);
  };
  return {
    configured() { try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } },
    async getJson(p) { if (!okPath(p)) return null; try { return JSON.parse(read(p).text); } catch { return null; } },
    // Optional CAS pair (CONTRACT §1): rev = the blob sha. putJsonRev writes ONLY if the
    // file is still at rev — a concurrent writer (e.g. an admin revocation) fails the put.
    async getJsonMeta(p) { if (!okPath(p)) return null; try { const r = read(p); return { doc: JSON.parse(r.text), rev: r.sha }; } catch { return null; } },
    async putJsonRev(p, doc, message, rev) {
      if (!okPath(p)) return { ok: false };
      if (typeof rev !== 'string' || !rev) return { ok: false, error: 'rev-required' }; // CAS without a rev is a plain overwrite — refuse
      try { write(p, JSON.stringify(doc), message || `put ${p}`, rev); return { ok: true }; }
      catch { return { ok: false, race: true }; } // sha mismatch (or wire error): the caller must re-read, never retry blind
    },
    async putJson(p, doc, message) {
      if (!okPath(p)) return { ok: false };
      try { let sha = null; try { sha = read(p).sha; } catch { /* new file */ } write(p, JSON.stringify(doc), message || `put ${p}`, sha); return { ok: true }; }
      catch { return { ok: false }; }
    },
    async deleteJson(p, message) {
      if (!okPath(p)) return { ok: false };
      let sha; try { sha = read(p).sha; } catch { return { ok: true }; } // absent → ok
      try { api([`repos/${repo}/contents/${p}`, '-X', 'DELETE', '--input', '-'], JSON.stringify({ message: message || `delete ${p}`, sha })); return { ok: true }; }
      catch { return { ok: false }; }
    },
    async listDir(dir) {
      if (!okPath(dir)) return [];
      try { const rows = JSON.parse(api([`repos/${repo}/contents/${dir}`])); return (Array.isArray(rows) ? rows : []).map((f) => String(f.name || '').replace(/\.[A-Za-z0-9]+$/, '')).filter(Boolean); }
      catch { return []; }
    },
    async getBlob(p) { if (!okPath(p)) return null; try { const j = JSON.parse(api([`repos/${repo}/contents/${p}`])); return Buffer.from(j.content || '', 'base64'); } catch { return null; } },
    async putBlob(p, buf, message) {
      if (!okPath(p)) return { ok: false };
      try {
        let sha = null; try { sha = JSON.parse(api([`repos/${repo}/contents/${p}`])).sha; } catch { /* new */ }
        api([`repos/${repo}/contents/${p}`, '-X', 'PUT', '--input', '-'], JSON.stringify({ message: message || `blob ${p}`, content: Buffer.from(buf).toString('base64'), ...(sha ? { sha } : {}) }));
        return { ok: true };
      } catch { return { ok: false }; }
    },
    async appendLog(p, row) { // append-only: read + concat + sha-CAS PUT (CONTRACT §3.14)
      if (!okPath(p)) return { ok: false };
      try {
        let sha = null, text = '';
        try { const r = read(p); sha = r.sha; text = r.text; } catch { /* first row of the month */ }
        write(p, text + JSON.stringify(row) + '\n', 'audit append', sha);
        return { ok: true };
      } catch { return { ok: false }; }
    },
    async claimWorkOrder(org, runnerId, types) { // read + sha-CAS PUT; lost race → next order
      if (!ORG_RE.test(String(org || ''))) return null;
      const dir = `work-orders/${org}`;
      let rows = [];
      try { rows = JSON.parse(api([`repos/${repo}/contents/${dir}`])); } catch { return null; }
      for (const f of Array.isArray(rows) ? rows : []) {
        const name = String(f.name || '');
        if (!name.endsWith('.json') || !SEG_RE.test(name)) continue;
        const p = `${dir}/${name}`;
        let sha, order;
        try { const r = read(p); sha = r.sha; order = JSON.parse(r.text); } catch { continue; }
        if (!order || typeof order !== 'object' || order.status !== 'queued') continue;
        if (!Array.isArray(types) || !types.includes(order.type)) continue;
        const claimed = { ...order, status: 'claimed', claimedBy: runnerId, claimedAt: new Date().toISOString(), attempts: (Number(order.attempts) || 0) + 1 };
        try { write(p, JSON.stringify(claimed), `claim ${order.id || name} by ${runnerId}`, sha); return claimed; }
        catch { log(`  claim race lost on ${name} — trying next.`); }
      }
      return null;
    },
  };
}
