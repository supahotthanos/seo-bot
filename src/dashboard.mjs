// seo-bot · dashboard — the bot↔dashboard wire (push pending, pull decisions, apply approved).
//
// The bot runs LOCALLY (needs the `claude` CLI + `gh` + git working trees); the dashboard is
// remote. So: `dashboard push` publishes tiered pending changes, the founder approves in the UI,
// `dashboard pull` turns approvals into task-status transitions, and `apply-approved` executes
// ONLY the approved set through the existing PR adapters (journaled, rollback-able).
//
// --local uses files under reports/<client>/ (fully offline, used for tests). Without --local
// it talks to the deployed dashboard store over HTTPS with a bearer token (SEO_BOT_DASHBOARD_*).
//
// Invariants preserved: PR-only adapters, fail-closed tiering, legal/YMYL stays RED, every
// executed write journaled to the change-ledger.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadConfig } from './config.mjs';
import { loadLatestProposals } from './apply/index.mjs';
import { currentTasks, upsertFromProposals, setStatus } from './tasks.mjs';
import { decidePolicy } from './policy.mjs';
import { buildPendingRecord, groupByTier } from './dashboard-contract.mjs';
import { computeSov, promptMatrix } from './measure/sov.mjs';
import { panelSummary as qbPanelSummary, varianceDecomposition as qbVariance, rankStability as qbRankStability, shareOfVoice as qbShareOfVoice } from './measure/query-bank-analytics.mjs';
import { getStore } from './store/index.mjs';
import { buildAutonomySection } from './scheduler.mjs';

const dir = (client) => join(ROOT, 'reports', client);
const pendingFile = (client) => join(dir(client), 'dashboard-pending.json');
const decisionsFile = (client) => join(dir(client), 'dashboard-decisions.json');

function readJson(f, dflt) { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : dflt; } catch { return dflt; } }
function loadStats(client) { const f = join(dir(client), 'decisions.ndjson'); if (!existsSync(f)) return []; return readFileSync(f, 'utf-8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

/** Best-effort: pull per-change consensus/screenshot verdicts from the last autopilot run. */
function enrichmentFor(client) {
  const j = readJson(join(dir(client), 'autopilot-latest.json'), null);
  const map = new Map();
  let rows = j && (j.results || j.changes || j.proposals);
  if (!Array.isArray(rows)) rows = [];
  for (const r of rows) {
    const key = r.taskKey || `${r.type}:${r.page || r.url}`;
    map.set(key, { consensus: r.consensus || null, screenshot: r.screenshot || null });
  }
  return map;
}

// Remote store: ONE driver interface (src/store/index.mjs, store/CONTRACT.md). With no env
// configured this resolves to the gh driver against the same private seenai-queue repo the
// bot has always used (`gh api`, sha-CAS puts — extracted verbatim); DATABASE_URL opts into
// Postgres; SEENAI_ORG opts into a non-'_default' org. --local flows never construct a store.
async function remoteStore() { return getStore(process.env, { defaultDriver: 'gh' }); }

/** Upload before/after PNGs to the (private) store so the dashboard can render them server-side
 *  for the gated reviewer. Best-effort: never let a flaky upload break the pending push. */
async function uploadShots(store, client, records, log = () => {}) {
  for (const r of records) {
    const s = r.screenshot; if (!s) continue;
    for (const k of ['beforeShot', 'afterShot']) {
      const f = s[k];
      if (!(f && typeof f === 'string' && existsSync(f))) continue;
      const name = `${String(r.taskId || r.taskKey)}-${k}.png`.replace(/[^A-Za-z0-9._-]/g, '_');
      try {
        const res = await store.writeShot(client, name, readFileSync(f), `shot ${r.taskId} ${k}`);
        if (!res.ok) throw new Error(res.error || 'store write failed');
        s[k + 'Path'] = res.path; // store-relative path; dashboard server fetches authed (no public URL → stays client-invisible)
      } catch (e) { log(`  shot upload skipped (${k}): ${e.message}`); }
    }
  }
}

/** Read the most recent AI-visibility capture for a client (reports/<client>/ai-visibility | data/ai-visibility). */
function readLatestVisibility(client, root = ROOT) {
  for (const d of [join(root, 'reports', client, 'ai-visibility'), join(root, 'data', 'ai-visibility')]) {
    if (!existsSync(d)) continue;
    const files = readdirSync(d).filter((f) => f.endsWith('.json')).sort();
    if (files.length) { try { return JSON.parse(readFileSync(join(d, files[files.length - 1]), 'utf-8')); } catch { /* */ } }
  }
  return null;
}

/** PUBLISH per-client prompt tracking: which prompts rank, on which engines, where they don't, + SoV. */
export async function pushTracking(cfg, { local = false, log = () => {} } = {}) {
  const client = cfg.name;
  const vis = readLatestVisibility(client);
  if (!vis || !vis.results?.length) { log(`  tracking: no AI-visibility capture for ${client} — run "measure ${client}" first.`); return { client, captured: false }; }
  const sov = safe(() => computeSov(vis, { cfg }), null);
  const matrix = safe(() => promptMatrix(vis), { engines: [], prompts: [] });
  const payload = {
    client, brand: cfg.brand, capturedAt: vis.ranAt || null, generatedAt: new Date().toISOString(),
    engines: matrix.engines, overall: sov?.overall || null, perEngine: sov?.engines || null, prompts: matrix.prompts,
  };
  if (local) { mkdirSync(dir(client), { recursive: true }); writeFileSync(join(dir(client), 'dashboard-tracking.json'), JSON.stringify(payload, null, 2)); }
  else {
    const store = await remoteStore();
    const res = await store.writeTracking(client, payload, `push tracking ${client} (${matrix.prompts.length} prompts)`);
    if (!res.ok) throw new Error(res.error || 'tracking store write failed'); // visible failure, exactly like the old gh throw
  }
  log(`  tracking: ${matrix.prompts.length} prompts × ${matrix.engines.length} engines pushed${local ? ' (local)' : ''}.`);
  return { client, captured: true, prompts: matrix.prompts.length, engines: matrix.engines.length };
}

// ---- dashboard artifact bundle -------------------------------------------------------
//
// ONE JSON per client that the (rebuilt) dashboard consumes read-only. Assembled from
// whatever report artifacts exist on disk — every section is OPTIONAL: a missing artifact
// yields `null` for that section PLUS a hints[] entry naming the CLI command that
// produces it (coverage honesty: the dashboard shows "not measured yet — run X", never a
// fabricated zero). Suppression / noise-floor / verification-caveat fields ride along
// untouched so the dashboard can render honesty markers, not just numbers.

/** Hard cap on the serialized bundle (bytes). Row arrays are trimmed OLDEST-first until
 *  the bundle fits; every trim is recorded in bundle.meta.trimmed. */
export const MAX_BUNDLE_BYTES = Math.floor(1.5 * 1024 * 1024);

/** Row arrays clampBundle may trim, as paths into the bundle (append-ordered ⇒ index 0 is oldest). */
const TRIM_TARGETS = [
  ['decisions', 'rows'],
  ['experiments', 'rows'],
  ['offsite', 'rows'],
  ['visibility', 'trend', 'rows'],
  ['agentAnalytics', 'neverFetchedSample'],
  ['agentAnalytics', 'lag', 'pairs'],
];

/** CLI command (per section) that produces the missing artifact — surfaces in hints[]. */
const BUNDLE_HINTS = {
  summary: (c) => `run ${c}`,
  decisions: (c) => `stats ${c}`,
  experiments: (c) => `experiments ${c}`,
  visibility: (c) => `measure ${c}`,
  geogrid: (c) => `geogrid ${c} --kw "<primary keyword>"`,
  onpageCoverage: () => 'onpage-coverage',
  offsite: (c) => `offsite-exec ${c}`,
  agentAnalytics: (c) => `agents ${c}`,
  local: (c) => `local ${c}`,
  priors: () => 'priors --rebuild',
  autonomy: () => 'schedule install',
};

function arrAt(obj, path) {
  let o = obj;
  for (const k of path) { if (!o || typeof o !== 'object') return null; o = o[k]; }
  return Array.isArray(o) ? o : null;
}

/** Defensive NDJSON reader: unreadable file → null (section reads as missing, never a crash). */
function readNdjson(file) {
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf-8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return null; }
}

/** Tail of trend.csv (header + last n data rows), per-client dir first, shared data/ dir second. */
function trendTail(client, root, n = 90) {
  for (const f of [join(root, 'reports', client, 'ai-visibility', 'trend.csv'), join(root, 'data', 'ai-visibility', 'trend.csv')]) {
    if (!existsSync(f)) continue;
    try {
      const lines = readFileSync(f, 'utf-8').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length) return { header: lines[0], rows: lines.slice(1).slice(-n) };
    } catch { /* unreadable → keep looking / null */ }
  }
  return null;
}

/** Most recent geogrid-*.json for a client (by its own ranAt stamp). */
function latestGeogrid(client, root) {
  const d = join(root, 'reports', client);
  if (!existsSync(d)) return null;
  let files = [];
  try { files = readdirSync(d).filter((f) => /^geogrid-.*\.json$/.test(f)); } catch { return null; }
  let best = null;
  for (const f of files) {
    const j = readJson(join(d, f), null);
    if (j && (!best || String(j.ranAt || '') > String(best.ranAt || ''))) best = j;
  }
  return best;
}

/** On-page coverage, gated on the operator having RUN `onpage-coverage` (the md artifact
 *  exists) — then re-verified LIVE via verifyRegistry so the bundle carries structured,
 *  self-verified data instead of parsed markdown. Any failure → null (fail closed). */
async function coverageSection(root) {
  if (!existsSync(join(root, 'reports', 'onpage-coverage.md'))) return null;
  try {
    const { verifyRegistry } = await import('../scripts/onpage-coverage.mjs');
    const v = await verifyRegistry();
    const ORDER = ['autoApply', 'readyFix', 'propose', 'detect'];
    const surfaces = (v.rows || []).map((r) => {
      const cells = r.cells || {};
      const level = ORDER.find((l) => cells[l]?.status === 'ok')
        || (ORDER.some((l) => cells[l]?.status === 'human-by-design') ? 'human-by-design' : 'none');
      const broken = ORDER.filter((l) => cells[l]?.status === 'broken').length;
      return { id: r.id, level, broken };
    });
    return { summary: v.summary || null, brokenCount: (v.broken || []).length, surfaces };
  } catch { return null; }
}

/**
 * Clamp a bundle to maxBytes by trimming TRIM_TARGETS row arrays OLDEST-first (arrays are
 * append-ordered, so index 0 is the oldest row). Largest array is trimmed first, 20% per
 * pass. Every trim is recorded in bundle.meta.trimmed = [{section, removed, order}] and the
 * final size is stamped in bundle.meta.sizeBytes — the dashboard can always tell the user
 * what was cut. Exported for tests.
 */
export function clampBundle(bundle, { maxBytes = MAX_BUNDLE_BYTES } = {}) {
  if (!bundle || typeof bundle !== 'object') return bundle;
  bundle.meta = bundle.meta && typeof bundle.meta === 'object' ? bundle.meta : {};
  bundle.meta.trimmed = Array.isArray(bundle.meta.trimmed) ? bundle.meta.trimmed : [];
  const size = () => Buffer.byteLength(JSON.stringify(bundle), 'utf8');
  let guard = 0;
  while (size() > maxBytes && guard++ < 500) {
    let bestPath = null, bestArr = null;
    for (const path of TRIM_TARGETS) {
      const arr = arrAt(bundle, path);
      if (arr && arr.length && (!bestArr || arr.length > bestArr.length)) { bestArr = arr; bestPath = path; }
    }
    if (!bestArr) break; // nothing trimmable left — meta.sizeBytes stays honest below
    const drop = Math.max(1, Math.ceil(bestArr.length * 0.2));
    bestArr.splice(0, drop); // OLDEST first
    const key = bestPath.join('.');
    const rec = bundle.meta.trimmed.find((t) => t.section === key);
    if (rec) rec.removed += drop; else bundle.meta.trimmed.push({ section: key, removed: drop, order: 'oldest-first' });
  }
  bundle.meta.sizeBytes = size();
  return bundle;
}

/**
 * Build reports/<client>/dashboard-bundle.json — the artifact bundle the dashboard consumes.
 *
 * BUNDLE SHAPE (v1) — the contract the dashboard rebuild codes against. Every section is
 * `null` when its artifact is missing, with a matching hints[] entry:
 * {
 *   version: 1,
 *   client, brand, baseUrl, generatedAt,                    // identity
 *   meta:   { sizeBytes, trimmed: [{section, removed, order:'oldest-first'}] },
 *   hints:  [{ section, command }],                         // "not measured yet — run <command>"
 *   summary:    <run-latest.json as-is> | null,             // 9-stage run summary fields
 *   decisions:  { total, counts:{keep,revert,'try-next','insufficient-data'},
 *                 rows:[last 50 decisions.ndjson rows, each with .decision verdict] } | null,
 *   experiments:{ total, statusCounts:{<status>:n} (latest status per experiment id),
 *                 rows:[last 200 experiments.ndjson event rows] } | null,
 *   visibility: { capturedAt, sov: <computeSov result — engines carry belowNoiseFloor,
 *                 noiseFloorPct, precisionPct, CIs; overall included>, trend:{header,
 *                 rows:[last 90 trend.csv lines]} } | null,  // suppression fields INCLUDED
 *   geogrid:    <latest geogrid-*.json as-is (keyword, score ATRP/SoLV, results)> | null,
 *   onpageCoverage: { summary, brokenCount, surfaces:[{id, level:
 *                 'autoApply'|'readyFix'|'propose'|'detect'|'human-by-design'|'none',
 *                 broken}] } | null,                        // live-verified, gated on the md artifact
 *   offsite:    { counts:{actionable, rejected, byTier:{amber,red}, byAction:{send,submit,
 *                 paste,pay}}, rows:[≤200 worksheet rows], rejected:[≤50] } | null,
 *   agentAnalytics: { ranAt, parse:{readCount,skippedCount,format}, totals, rangesAvailable,
 *                 agents (per-crawler totals), neverFetchedCount, neverFetchedSample:[≤50],
 *                 neverFetchedCaveat, lag (incl. .reason when unavailable), fetchedPages,
 *                 sitePages } | null,                       // verification caveats INCLUDED
 *   local:      <local.json as-is (findings, proposals, suppressed, reviewMath, geogrid)> | null,
 *   priors:     <reports/_portfolio/priors.json as-is> | null,
 *   autonomy:   { installed:{daily,weekly}|null, lastRun:{at,kind,ok,pushed,queued,error}|null,
 *                 nextRuns:[{kind,at}]|null, heartbeatAgeMs, recent:[≤5 of {at,kind,ok}] } | null
 *                                                          // scheduler heartbeat (src/scheduler.mjs)
 * }
 *
 * Read-only over existing artifacts: builds from disk, writes ONLY dashboard-bundle.json.
 * @param {object} cfg loaded client config
 * @param {{root?:string, maxBytes?:number, log?:Function}} [opts] root/maxBytes are test seams
 * @returns {Promise<{bundle:object, path:string}>}
 */
export async function buildDashboardBundle(cfg, { root = ROOT, maxBytes = MAX_BUNDLE_BYTES, log = () => {} } = {}) {
  const client = cfg.name;
  const rdir = join(root, 'reports', client);
  const hints = [];
  const miss = (section) => { hints.push({ section, command: BUNDLE_HINTS[section](client) }); return null; };

  const summary = readJson(join(rdir, 'run-latest.json'), null);

  const decRows = readNdjson(join(rdir, 'decisions.ndjson'));
  const decisions = decRows ? (() => {
    const counts = {};
    for (const d of decRows) { const v = d && d.decision; if (v) counts[v] = (counts[v] || 0) + 1; }
    return { total: decRows.length, counts, rows: decRows.slice(-50) };
  })() : null;

  const expRows = readNdjson(join(rdir, 'experiments.ndjson'));
  const experiments = expRows ? (() => {
    const latest = new Map();
    for (const e of expRows) if (e && e.id) latest.set(e.id, e.status || 'unknown');
    const statusCounts = {};
    for (const s of latest.values()) statusCounts[s] = (statusCounts[s] || 0) + 1;
    return { total: latest.size, statusCounts, rows: expRows.slice(-200) };
  })() : null;

  const vis = readLatestVisibility(client, root);
  const trend = trendTail(client, root, 90);
  const visBase = (vis || trend)
    ? { capturedAt: vis?.ranAt || null, sov: vis ? safe(() => computeSov(vis, { cfg }), null) : null, trend }
    : null;
  // In-house query-bank PANEL (Peec-AI) — compact, CI-carrying summary for the Visibility area:
  // the variance decomposition (day/spelling/engine), client SoV with CI, and the per-city leaderboard.
  const qbObs = readNdjson(join(root, 'reports', 'query-bank', client, 'observations.ndjson'));
  const queryBank = (qbObs && qbObs.length) ? safe(() => {
    const sum = qbPanelSummary(qbObs);
    const decomp = qbVariance(qbObs, { topK: 5 });
    const sov = cfg.brand ? qbShareOfVoice(qbObs, cfg.brand) : null;
    return {
      observations: sum.observations, engines: sum.engines, cities: sum.cities.length, variants: sum.variants.length, days: sum.days.length, canMeasure: sum.canMeasure,
      variance: { dominant: decomp.dominant, factors: decomp.factors.map((f) => ({ factor: f.factor, comparisons: f.comparisons, overlap: f.meanOverlap, churn: f.meanChurn, orderAgreement: f.orderAgreement, movement: f.movement, status: f.status })) },
      sov: sov ? { appearanceRate: sov.overall.appearanceRate, ci: sov.overall.ci, n: sov.overall.n, byEngine: sov.byEngine } : null,
      leaderboard: qbRankStability(qbObs, { by: 'cityBrand', topK: 10 }).slice(0, 40),
    };
  }, null) : null;
  const visibility = (visBase || queryBank) ? { ...(visBase || {}), queryBank: queryBank || null } : null;

  const geogrid = latestGeogrid(client, root);
  const onpageCoverage = await coverageSection(root);

  const wsJson = readJson(join(rdir, 'offsite-worksheet.json'), null);
  const offsite = wsJson ? (() => {
    const rows = Array.isArray(wsJson.rows) ? wsJson.rows : [];
    const rejected = Array.isArray(wsJson.rejected) ? wsJson.rejected : [];
    const byTier = {}, byAction = {};
    for (const r of rows) {
      if (r?.tier) byTier[r.tier] = (byTier[r.tier] || 0) + 1;
      if (r?.action) byAction[r.action] = (byAction[r.action] || 0) + 1;
    }
    return { counts: { actionable: rows.length, rejected: rejected.length, byTier, byAction }, rows: rows.slice(0, 200), rejected: rejected.slice(0, 50) };
  })() : null;

  const aa = readJson(join(rdir, 'agent-analytics.json'), null);
  const agentAnalytics = aa ? {
    ranAt: aa.ranAt || null,
    parse: aa.parse || null,
    totals: aa.totals || null,
    rangesAvailable: aa.rangesAvailable ?? null,
    agents: aa.agents || null,
    neverFetchedCount: Array.isArray(aa.neverFetched) ? aa.neverFetched.length : null,
    neverFetchedSample: Array.isArray(aa.neverFetched) ? aa.neverFetched.slice(0, 50) : [],
    neverFetchedCaveat: aa.neverFetchedCaveat ?? null, // verification caveat rides along (coverage honesty)
    lag: aa.lag || null,                               // carries .reason when not computable
    fetchedPages: aa.fetchedPages ?? null,
    sitePages: aa.sitePages ?? null,
  } : null;

  const local = readJson(join(rdir, 'local.json'), null);
  const priors = readJson(join(root, 'reports', '_portfolio', 'priors.json'), null);

  // autonomy: null-safe over heartbeat/history/install-marker files; treated as "missing"
  // (null + hint) only when NO scheduler artifact exists at all — same coverage honesty.
  const autoSec = buildAutonomySection({ root });
  const autonomy = (autoSec.installed || autoSec.lastRun || autoSec.recent.length) ? autoSec : null;

  const bundle = {
    version: 1,
    client, brand: cfg.brand || null, baseUrl: cfg.baseUrl || null,
    generatedAt: new Date().toISOString(),
    meta: { sizeBytes: 0, trimmed: [] },
    hints,
    summary: summary ?? miss('summary'),
    decisions: decisions ?? miss('decisions'),
    experiments: experiments ?? miss('experiments'),
    visibility: visibility ?? miss('visibility'),
    geogrid: geogrid ?? miss('geogrid'),
    onpageCoverage: onpageCoverage ?? miss('onpageCoverage'),
    offsite: offsite ?? miss('offsite'),
    agentAnalytics: agentAnalytics ?? miss('agentAnalytics'),
    local: local ?? miss('local'),
    priors: priors ?? miss('priors'),
    autonomy: autonomy ?? miss('autonomy'),
  };
  clampBundle(bundle, { maxBytes });

  mkdirSync(rdir, { recursive: true });
  const path = join(rdir, 'dashboard-bundle.json');
  writeFileSync(path, JSON.stringify(bundle, null, 2));
  const present = Object.keys(BUNDLE_HINTS).filter((k) => bundle[k] !== null);
  log(`  bundle: ${present.length}/${Object.keys(BUNDLE_HINTS).length} sections (${hints.length} missing → hints) · ${bundle.meta.sizeBytes} bytes${bundle.meta.trimmed.length ? ` · trimmed ${bundle.meta.trimmed.map((t) => `${t.section}−${t.removed}`).join(', ')}` : ''} → ${path}`);
  return { bundle, path };
}

/**
 * Build the bundle and publish it to the remote store as artifacts/<client>.json (the same
 * gh-contents mechanism as pending/). --local writes reports/<client>/dashboard-bundle.json
 * only (fully offline; used by tests). Returns the store target either way so callers/tests
 * can verify the push path without a network.
 */
export async function publishBundle(cfg, { local = false, root = ROOT, log = () => {} } = {}) {
  const { bundle, path } = await buildDashboardBundle(cfg, { root, log });
  const storeTarget = `artifacts/${cfg.name}.json`;
  if (!local) {
    const store = await remoteStore();
    const res = await store.writeArtifact(cfg.name, bundle, `publish bundle ${cfg.name} (${bundle.meta.sizeBytes}b)`);
    if (!res.ok) throw new Error(res.error || 'bundle store write failed');
  }
  log(`  bundle ${local ? 'written (local only)' : `pushed → ${storeTarget}`}`);
  return { client: cfg.name, path, storeTarget, pushed: !local, sizeBytes: bundle.meta.sizeBytes, missing: bundle.hints.length };
}

/** PUBLISH: build tiered pending records from current proposed/queued tasks. */
export async function pushDashboard(cfg, { local = false, runId = null, log = () => {} } = {}) {
  const client = cfg.name;
  const data = loadLatestProposals(cfg);
  const proposals = data?.proposals || [];
  if (proposals.length) upsertFromProposals(client, proposals, { actor: 'auto' });
  const tasks = currentTasks(client);
  const byKey = new Map(tasks.map(t => [t.taskKey, t]));
  const stats = loadStats(client);
  const enrich = enrichmentFor(client);

  const records = [];
  for (const p of proposals) {
    const key = `${p.type}:${p.page}`;
    const task = byKey.get(key);
    if (!task || !['proposed', 'queued'].includes(task.status)) continue; // only undecided items
    const policy = safe(() => decidePolicy(p, cfg, { stats, signals: {} }), { action: 'queue', risk: 'medium', reasons: [], blockers: ['policy-eval-failed'] });
    const e = enrich.get(key) || {};
    records.push(buildPendingRecord(task, { proposal: p, policy, consensus: e.consensus || null, screenshot: e.screenshot || null, client, runId }));
  }
  // Before/after visual review: DANGEROUS tier always, PLUS any change that touches visual
  // content (charts/images/tables/embeds — isVisualChange), so the reviewer compares pixels,
  // not just words, before accepting. Capture is capped per push (bounded wall-clock; skips are
  // logged honestly). Skipped offline (--local) and if cfg.screenshots:false.
  if (!local && cfg.screenshots !== false) {
    try {
      const { reviewProposal, isVisualChange } = await import('./screenshot-review.mjs');
      const wants = records.filter((x) => !x.screenshot && (x.tier === 'red' || isVisualChange(x)));
      const cap = Number(cfg.notify?.maxShotsPerPush) > 0 ? Number(cfg.notify.maxShotsPerPush) : 12;
      if (wants.length > cap) log(`  shots: capturing ${cap}/${wants.length} candidates (cap) — rest push without visuals`);
      for (const r of wants.slice(0, cap)) {
        try {
          const sdir = join(dir(client), 'shots', String(r.taskId || r.taskKey).replace(/[^A-Za-z0-9._-]/g, '_'));
          mkdirSync(sdir, { recursive: true });
          r.screenshot = await reviewProposal(r.page, { current: r.current, proposed: r.proposed, type: r.type, dir: sdir });
        } catch { /* never block the push on one capture failure */ }
      }
    } catch { /* screenshot module unavailable — push without visuals */ }
  }
  const payload = { client, generatedAt: new Date().toISOString(), runId, count: records.length, records };

  if (local) { mkdirSync(dir(client), { recursive: true }); writeFileSync(pendingFile(client), JSON.stringify(payload, null, 2)); }
  else { // shots first → records carry their store paths
    const store = await remoteStore();
    await uploadShots(store, client, records, log);
    const res = await store.writePending(client, payload, `push pending ${client} (${payload.count})`);
    if (!res.ok) throw new Error(res.error || 'pending store write failed'); // visible failure, exactly like the old gh throw
  }

  try { await pushTracking(cfg, { local, log }); } catch (e) { log('  tracking push skipped: ' + e.message); } // per-prompt rankings ride along with the pending push
  try { await publishBundle(cfg, { local, log }); } catch (e) { log('  bundle publish skipped: ' + e.message); } // artifact bundle rides along too (artifacts/<client>.json)
  // Slack mirror: high-urgency items → operator channel, each with a one-click deep link into
  // /approvals?focus=<taskId> (screenshots + accept/reject live on the card). Best-effort ALWAYS —
  // the queue is the source of truth; a dead webhook never breaks the push.
  if (!local) {
    try { const { notifyApprovals } = await import('./notify.mjs'); await notifyApprovals(cfg, { records, runId }, { log }); }
    catch (e) { log('  slack notify skipped: ' + String(e.message || e).slice(0, 120)); }
  }
  const g = groupByTier(records);
  log(`  pushed ${records.length} pending → green ${g.green.length} · amber ${g.amber.length} · red ${g.red.length}${local ? ' (local)' : ''}`);
  return { ...payload, tiers: { green: g.green.length, amber: g.amber.length, red: g.red.length } };
}

/** PULL: turn dashboard decisions into task-status transitions (idempotent). */
export async function pullDashboard(cfg, { local = false, apply = false, confirm = false, log = () => {} } = {}) {
  const client = cfg.name;
  const decisions = local
    ? (readJson(decisionsFile(client), { decisions: [] }).decisions || [])
    : await (await remoteStore()).readDecisions(client);
  const tasks = new Map(currentTasks(client).map(t => [t.id, t]));
  let approved = 0, rejected = 0, skipped = 0;
  for (const d of decisions) {
    const t = tasks.get(d.taskId);
    if (!t) { skipped++; continue; }
    const target = d.decision === 'approve' ? 'approved' : d.decision === 'reject' ? 'rejected' : null;
    if (!target) { skipped++; continue; }
    if (t.status === target || ['deployed', 'verified', 'rolled_back'].includes(t.status)) { skipped++; continue; } // idempotent
    setStatus(client, d.taskId, target, { actor: d.actor || 'founder', note: d.bulk ? `dashboard:${d.tier}:bulk` : 'dashboard' });
    target === 'approved' ? approved++ : rejected++;
  }
  log(`  pulled decisions → approved ${approved} · rejected ${rejected} · skipped ${skipped}`);
  let applied = null;
  if (apply && approved) applied = await applyApproved(cfg, { confirm, log });
  return { approved, rejected, skipped, applied };
}

/** EXECUTE: apply ONLY the approved tasks' proposals via the PR adapter; mark deployed. */
export async function applyApproved(cfg, { confirm = false, log = () => {} } = {}) {
  const client = cfg.name;
  const approvedKeys = new Set(currentTasks(client).filter(t => t.status === 'approved').map(t => t.taskKey));
  if (!approvedKeys.size) { log('  no approved tasks to apply.'); return { applied: [] }; }
  const data = loadLatestProposals(cfg);
  const filtered = (data?.proposals || []).filter(p => approvedKeys.has(`${p.type}:${p.page}`));
  if (!filtered.length) { log('  approved tasks have no matching proposals (re-run propose).'); return { applied: [] }; }

  const type = cfg.cms?.type || 'dryrun';
  const PR_ADAPTERS = new Set(['nextjs', 'edge', 'cloudflare-worker']);
  if (!PR_ADAPTERS.has(type) && type !== 'dryrun') { log(`  refusing to auto-apply via non-PR adapter "${type}" — left approved for manual apply.`); return { applied: [], refused: type }; }

  log(`  applying ${filtered.length} APPROVED proposal(s) via "${type}"${confirm ? '' : ' (preview)'} …`);
  const adapters = { nextjs: './apply/nextjs.mjs', edge: './apply/edge.mjs', 'cloudflare-worker': './apply/cloudflare-worker.mjs', dryrun: './apply/dryrun.mjs' };
  const mod = await import(adapters[type] || adapters.dryrun);
  const fn = mod.applyNextjs || mod.applyEdge || mod.applyCloudflareWorker || mod.applyDryrun;
  const result = await fn(cfg, { ...data, proposals: filtered }, { log, confirm });

  if (confirm && result?.applied?.length) {
    try { const { recordChanges } = await import('./change-ledger.mjs'); recordChanges(client, result.applied, { adapter: type }); } catch { /* ledger is best-effort */ }
    // Mark ONLY the tasks whose change actually landed as deployed; partial/failed stay
    // 'approved' for retry (never a false "deployed").
    const appliedFiles = new Set((result.applied || []).map((a) => String(a.url || '').replace(/^[\\/]/, '')));
    const fullSuccess = result.applied.length >= filtered.length;
    const commit = result.pr || result.branch || null;
    let marked = 0;
    for (const p of filtered) {
      const t = currentTasks(client).find((x) => x.taskKey === `${p.type}:${p.page}` && x.status === 'approved');
      if (!t) continue;
      const file = (p.patch && p.patch.file) || (p.fileWrite && p.fileWrite.path);
      const landed = fullSuccess || (file && appliedFiles.has(String(file).replace(/^[\\/]/, '')));
      if (landed) { setStatus(client, t.id, 'deployed', { actor: 'bot', commit, note: 'apply-approved' }); marked++; }
    }
    log(`  ${marked} task(s) marked deployed; ${filtered.length - marked} left approved for retry.`);
  } else if (confirm) {
    log('  nothing applied cleanly — approved tasks left in queue for retry.');
  }
  return result;
}

/** push → pull → (apply). */
export async function syncDashboard(cfg, opts = {}) {
  await pushDashboard(cfg, opts);
  return pullDashboard(cfg, opts);
}

// ---- standalone CLI (also wired into bin/seo-bot.mjs) ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [, , cmd, clientArg, ...rest] = process.argv;
  const flags = new Set(rest);
  const opts = { local: flags.has('--local'), apply: flags.has('--apply'), confirm: flags.has('--yes'), log: (m) => console.log(m) };
  const cfg = loadConfig(clientArg);
  const run = { push: pushDashboard, pull: pullDashboard, sync: syncDashboard, 'apply-approved': applyApproved, track: pushTracking, bundle: publishBundle }[cmd];
  if (!run) { console.error('usage: node src/dashboard.mjs <push|pull|sync|apply-approved|track|bundle> <client> [--local] [--apply] [--yes]'); process.exit(1); }
  run(cfg, opts).then(r => { console.log(JSON.stringify(r?.tiers || r?.approved !== undefined ? { tiers: r.tiers, approved: r.approved, rejected: r.rejected } : r, null, 2)); }).catch(e => { console.error('failed:', e.message); process.exit(1); });
}

function safe(fn, dflt) { try { return fn(); } catch { return dflt; } }
