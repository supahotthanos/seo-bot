// seo-bot · dashboard-contract — the data contract between the bot and the dashboard.
//
// tierFor() maps a pending change to one of three approval sections using the bot's REAL
// risk signals (policy.action/risk/blockers, severity, type, autoApplicable, verifier
// consensus, screenshot-review verdict/magnitude). The bot stamps `tier` at publish time;
// the dashboard NEVER recomputes risk — it only renders and collects decisions.
//
//   green = "Almost auto-approve"  (what the autopilot would have pushed unattended)
//   amber = "Mild approve"         (queued for a soft reason — the everyday bulk-accept set)
//   red   = "Dangerous"            (legal/YMYL/critical/high-risk/blocked — look individually)
//
// FAIL-CLOSED: anything we cannot positively verify as safe falls to amber or red, never green.

export const TIERS = ['green', 'amber', 'red'];
export const TIER_LABEL = { green: 'Almost auto-approve', amber: 'Mild approve', red: 'Dangerous — review each' };

// Med-spa FLAG-ONLY / legal-sensitive types (src/rules.mjs) — always red, never bulk-applied.
const LEGAL_TYPES = new Set(['glp1-rx-claims', 'before-after-disclaimer', 'review-authenticity', 'health-claim-superlatives']);
const DETERMINISTIC_TYPES = new Set(['meta', 'title']);          // src/policy.mjs DETERMINISTIC_FIX_TYPES
const HIGH_RISK_PATH = /(^\/?$)|\/(pricing|book|consult|contact|checkout|cart|appointment)(\/|$)/i; // src/config riskTiers

const truthy = v => v === true;
const has = (arr, re) => Array.isArray(arr) && arr.some(x => re.test(String(x)));
const pathOf = (u) => { try { return new URL(u).pathname || '/'; } catch { return String(u || '/'); } };

/** Map one change to 'green' | 'amber' | 'red'. Defensive: missing signals fail closed. */
export function tierFor(change = {}) {
  const { severity, type, autoApplicable, page = '', policy = {}, consensus = null, screenshot = null } = change;
  const blockers = policy.blockers || [];
  const path = pathOf(page);
  // A deterministic meta/title length-clamp is not a substantive content edit, so an
  // incidental legal-keyword match in its text shouldn't force "dangerous" — it's "mild".
  const deterministicClamp = DETERMINISTIC_TYPES.has(type) && truthy(autoApplicable) && (severity === 'low' || severity == null);

  // ---- RED (any of) ----
  if (LEGAL_TYPES.has(type)) return 'red';                                  // genuine legal-content change
  if (has(blockers, /legal|ymyl|glp|review|before-after|health-claim/i) && !deterministicClamp) return 'red';
  if (severity === 'critical') return 'red';
  if (policy.risk === 'high') return 'red';                                 // high-traffic/revenue page
  if (HIGH_RISK_PATH.test(path)) return 'red';                             // home/pricing/book/consult…
  if (consensus && (consensus.consensus === false || consensus.available === false)) return 'red';
  if (screenshot && (screenshot.verdict === 'unsafe' || Number(screenshot.magnitude) > 25)) return 'red';
  if (screenshot && screenshot.verdict === 'review') return 'red';             // fail closed: LLM unavailable / reviewer silent
  if (!truthy(autoApplicable) && (severity === 'high' || severity === 'critical')) return 'red';

  // ---- GREEN (all of) ----
  const consensusOk = truthy(consensus && consensus.consensus);
  const shotOk = screenshot && screenshot.verdict === 'safe' && typeof screenshot.magnitude === 'number' && Number.isFinite(screenshot.magnitude) && screenshot.magnitude <= 5; // unmeasured (null/undefined/NaN) magnitude is NOT "safe" → never green
  const detClass = DETERMINISTIC_TYPES.has(type) || (type === 'img-alt' && screenshot && Number(screenshot.magnitude) === 0);
  if (policy.action === 'auto-approve' && consensusOk && shotOk && detClass) return 'green';

  // ---- AMBER (everything else not red/green) ----
  return 'amber';
}

/** Pure "what is this change actually doing" overview for the dashboard: visible-text change
 *  magnitude + the words added/removed. Lets a reviewer see the full picture (before, after,
 *  AND what else moved) without a live render. No deps — safe to ship to the dashboard layer. */
export function changeOverview(before, after) {
  const s = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const tok = (v) => s(v).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const a = new Set(tok(before)), b = new Set(tok(after));
  let inter = 0; for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  const magnitude = (!a.size && !b.size) ? 0 : Math.round((1 - inter / (union || 1)) * 100);
  const added = [...b].filter((w) => !a.has(w));
  const removed = [...a].filter((w) => !b.has(w));
  return { magnitude, addedCount: added.length, removedCount: removed.length, added: added.slice(0, 40), removed: removed.slice(0, 40) };
}

/** Build the pending-change record the bot publishes (matches the dashboard schema). */
export function buildPendingRecord(task = {}, { proposal = {}, policy = {}, consensus = null, screenshot = null, client, runId } = {}) {
  const base = {
    schema: 1,
    client: client || task.client,
    taskId: task.id || task.taskId,
    taskKey: task.key || `${proposal.type}:${proposal.page || proposal.url}`,
    type: proposal.type,
    page: proposal.page || proposal.url || '',
    severity: proposal.severity || null,
    ev: proposal.priority ?? proposal.ev ?? null,
    autoApplicable: !!proposal.autoApplicable,
    current: proposal.current ?? proposal.before ?? null,
    proposed: proposal.proposed ?? proposal.after ?? null,
    rationale: proposal.rationale || proposal.why || proposal.report || '',
    policy: { action: policy.action || null, risk: policy.risk || null, reasons: policy.reasons || [], blockers: policy.blockers || [] },
    consensus, screenshot,
    status: task.status || 'queued',
    publishedAt: new Date().toISOString(),
    runId: runId || null,
  };
  base.overview = changeOverview(base.current, base.proposed); // before/after + what else changes
  base.tier = tierFor({ ...base, ...{ severity: base.severity, type: base.type, page: base.page, autoApplicable: base.autoApplicable, policy: base.policy, consensus, screenshot } });
  return base;
}

/** Group an array of pending records into the three sections, newest first. */
export function groupByTier(records = []) {
  const g = { green: [], amber: [], red: [] };
  for (const r of records) (g[r.tier] || g.amber).push(r);
  for (const k of TIERS) g[k].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return g;
}
