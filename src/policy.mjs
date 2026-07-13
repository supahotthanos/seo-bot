// seo-bot · policy — the auto-deploy decision engine (Epic 1, work-unit A11).
//
// For each proposal/task, decide AUTO-APPROVE vs QUEUE-FOR-HUMAN. OTTO ships a flat
// "Deploy all" button; we gate every write on a risk-tiered, evidence-backed policy.
//
// Auto-approve ONLY when BOTH hold:
//   (a) the fix is a low-risk DETERMINISTIC clamp (meta/title length), AND
//   (b) its change-class has a PROVEN non-negative history in the stats controller's
//       decisions ledger (no "revert" verdicts; at least one "keep"/neutral signal).
//
// ALWAYS queue (overrides everything) when ANY hold:
//   - the page path matches cfg.riskTiers.highRiskPathRe (home/pricing/book/consult…),
//   - severity exceeds cfg.riskTiers.autoApplyMaxSeverity,
//   - the change touches a legal-sensitive med-spa surface (reviews / before-after /
//     GLP-1 drug names / health claims),
//   - the page is high-traffic / high-revenue (computed from GSC impressions + GA4
//     conversions — its risk tier).
//
// Nothing here writes or applies. It returns a decision the orchestrator/review layer
// acts on. High-traffic + YMYL + legal med-spa pages NEVER auto-apply.

import { SEVERITY_RANK } from './util.mjs';
import { canAutoPromote, isPromotionIneligible } from './policy-promotion.mjs';

/** Adapters whose auto-apply path is a LIVE write (Edge Config / Worker deploy), not a
 *  mergeable PR. The E9 promotion lane must never auto-write live through these. */
const EDGE_LIVE_ADAPTERS = new Set(['edge', 'cloudflare-worker']);

/** Change-classes that are pure deterministic clamps (no LLM, reversible, low blast radius). */
export const DETERMINISTIC_FIX_TYPES = new Set(['meta', 'title']);

/** Regex flagging legal-sensitive med-spa surfaces that must never auto-apply. */
const LEGAL_SENSITIVE_RE =
  /\b(review|reviews|testimonial|before[\s-]?after|b&a|glp-?1|semaglutide|tirzepatide|ozempic|wegovy|mounjaro|zepbound|botox|filler|injectable|medical|health|clinical|cure|treat(?:s|ment)?|fda|prescription|dosage)\b/i;

/** Paths that read as legal-sensitive even without a keyword in the change body. */
const LEGAL_SENSITIVE_PATH_RE =
  /\/(reviews?|testimonials?|results|before-after|weight-?loss|glp-?1|conditions?|medical)\b/i;

/**
 * Compute a page's risk tier from first-party traffic/revenue signals.
 * @param {string} page  the URL of the proposal
 * @param {object} signals  { gscByPage:Map<path,{impressions,clicks}>, ga4ByPath:Map<path,{conversions,sessions}> }
 * @returns {{tier:'high'|'medium'|'low', impressions:number, conversions:number, reason:string}}
 */
export function pageRiskTier(page, signals = {}) {
  const path = pathOf(page);
  const gsc = signals.gscByPage?.get(path) || signals.gscByPage?.get(path.replace(/\/$/, '')) || null;
  const ga4 = signals.ga4ByPath?.get(path) || signals.ga4ByPath?.get(path.replace(/\/$/, '')) || null;
  // A PRESENT-but-non-finite signal (corrupt/overflowed import) must HARDEN the gate, not
  // relax to 0/low — a garbage revenue/traffic number on a money page should never auto-approve.
  if ((gsc && gsc.impressions != null && (!Number.isFinite(gsc.impressions) || gsc.impressions < 0)) || (ga4 && ga4.conversions != null && (!Number.isFinite(ga4.conversions) || ga4.conversions < 0))) {
    return { tier: 'high', impressions: 0, conversions: 0, reason: 'corrupt (non-finite) traffic/revenue signal — fail closed to high risk' };
  }
  const impressions = Number.isFinite(gsc?.impressions) ? gsc.impressions : 0;
  const conversions = Number.isFinite(ga4?.conversions) ? ga4.conversions : 0;
  const opts = signals.opts || {};
  const hiImpr = opts.highTrafficImpressions ?? 1000;
  const hiConv = opts.highRevenueConversions ?? 1;
  if (conversions >= hiConv) return { tier: 'high', impressions, conversions, reason: `${conversions} conversion(s) — revenue page` };
  if (impressions >= hiImpr) return { tier: 'high', impressions, conversions, reason: `${impressions} impressions — high-traffic page` };
  if (impressions >= Math.round(hiImpr / 4)) return { tier: 'medium', impressions, conversions, reason: `${impressions} impressions — moderate traffic` };
  return { tier: 'low', impressions, conversions, reason: impressions ? `${impressions} impressions` : 'no measured traffic' };
}

/** Pathname of a URL (defensive — proposals sometimes carry a baseUrl-only "page"). */
function pathOf(url) {
  try { return new URL(url).pathname || '/'; } catch { return String(url || '/'); }
}

/** Is this change-class proven non-negative in the stats decisions ledger? */
export function changeClassProven(type, statsDecisions = []) {
  const VALID = new Set(['keep', 'revert', 'try-next']);
  const forType = statsDecisions.filter((d) => d && VALID.has(d.decision) && (d.type === type || (d.taskKey || '').startsWith(`${type}:`) || classifyByPage(d) === type));
  // Unknown class OR no valid (string) decisions → not proven (conservative): require a real track record.
  if (!forType.length) return { proven: false, reason: 'no valid prior outcome data for this change-class' };
  const reverts = forType.filter((d) => d.decision === 'revert').length;
  if (reverts > 0) return { proven: false, reason: `${reverts}/${forType.length} prior changes of this class were reverted` };
  const wins = forType.filter((d) => d.decision === 'keep').length;
  // Non-negative = zero reverts. A "keep" is a stronger signal but neutral (try-next /
  // insufficient-data with no reverts) still counts as non-negative history.
  return { proven: true, reason: wins ? `${wins} kept, 0 reverted across ${forType.length}` : `0 reverted across ${forType.length} (no regressions)` };
}

/** Best-effort classifier for ledger rows that predate typed decisions. */
function classifyByPage(d) { return d?.type || null; }

/**
 * Decide policy for one proposal.
 * @param {object} proposal  { type, page, severity, autoApplicable, ... }
 * @param {object} cfg       client config (riskTiers, vertical)
 * @param {object} ctx       { stats: [decision rows], signals: {gscByPage, ga4ByPath, opts} }
 * @returns {{ action:'auto-approve'|'queue', risk:'low'|'medium'|'high', reasons:string[], blockers:string[] }}
 */
export function decidePolicy(proposal, cfg, { stats = [], signals = {} } = {}) {
  const reasons = [];
  const blockers = [];
  const rt = cfg.riskTiers || {};
  const maxSev = rt.autoApplyMaxSeverity || 'low';
  // Fail CLOSED: if maxSev is not a recognised key in SEVERITY_RANK (e.g. a typo or
  // a case-mismatch like "Low" instead of "low"), silently falling back to rank 3 would
  // make the gate maximally permissive. Instead treat an unknown key as rank -1 so the
  // severity check always blocks. The ?? 3 in the original comparand was the silent hole.
  if (!(maxSev in SEVERITY_RANK)) {
    blockers.push(`autoApplyMaxSeverity "${maxSev}" is not a known severity (critical/high/medium/low/info) — failing closed`);
    return { action: 'queue', risk: 'high', reasons, blockers };
  }
  const path = pathOf(proposal.page);

  // --- hard blockers (any one forces a queue) ---

  // 1) High-risk path (home/pricing/book/consult…) — always human.
  if (rt.highRiskPathRe) {
    let hit = false;
    try { hit = new RegExp(rt.highRiskPathRe, 'i').test(path) || new RegExp(rt.highRiskPathRe, 'i').test(proposal.page); } catch { hit = true; } // bad regex → fail CLOSED (block), never silently disable the guard
    if (hit) blockers.push(`high-risk path (matches /${rt.highRiskPathRe}/)`);
  }

  // 2) Severity over the auto-apply ceiling.
  if ((SEVERITY_RANK[proposal.severity] ?? -1) < (SEVERITY_RANK[maxSev] ?? 3)) {
    blockers.push(`severity "${proposal.severity}" exceeds/!=autoApplyMaxSeverity "${maxSev}" (unknown severity fails closed)`);
  }

  // 3) Legal-sensitive med-spa surface (reviews/before-after/GLP-1/health claims).
  const isMedspa = cfg.vertical === 'medspa';
  const flat = (v) => (v == null ? '' : typeof v === 'object' ? Object.values(v).map(flat).join(' ') : String(v));
  const bodyToScan = `${proposal.type} ${flat(proposal.current)} ${flat(proposal.proposed)}`;
  if (LEGAL_SENSITIVE_PATH_RE.test(path) || (isMedspa && LEGAL_SENSITIVE_RE.test(bodyToScan))) {
    blockers.push('legal-sensitive med-spa surface (reviews/before-after/GLP-1/health-claim) — never auto-apply (YMYL)');
  }

  // 4) High-traffic / high-revenue page tier.
  const risk = pageRiskTier(proposal.page, signals);
  if (risk.tier === 'high') blockers.push(`high-traffic/revenue page (${risk.reason})`);

  if (blockers.length) return { action: 'queue', risk: risk.tier, reasons, blockers };

  // --- auto-approve gate: (a) deterministic clamp AND (b) proven non-negative class ---

  // 'aggressive' mode widens the eligible class to ANY auto-applicable structural fix and
  // makes the proven-history check advisory — the VERIFIER CONSENSUS (+ change-ledger + CI
  // gate) becomes the gate. The hard blockers above (legal/YMYL/high-traffic/irreversible)
  // still apply in both modes.
  const aggressive = (cfg.autopilot?.mode || 'conservative') === 'aggressive';
  // E9 promotion lane: cfg.riskTiers.autoClasses may NOMINATE extra change-classes, but a
  // listed class widens the lane ONLY when canAutoPromote proves it in the decisions ledger
  // (zero reverts AND >=5 keeps) AT DECISION TIME. Config alone can NEVER widen the lane.
  // The hard blockers above (YMYL/legal, high-risk path, severity, high-traffic) already ran
  // and queue regardless of what this list says.
  const autoClasses = Array.isArray(rt.autoClasses) ? rt.autoClasses.map((c) => String(c)) : [];
  let promo = null;
  if (!DETERMINISTIC_FIX_TYPES.has(proposal.type) && autoClasses.includes(proposal.type)) {
    // Defense-in-depth: PROMOTION-INELIGIBLE classes (robots/noindex, redirects/301,
    // h1/headings, guardIrreversible's set, map-pack-judged local-*) never consult the
    // ledger at all — canAutoPromote re-checks the same set, so both paths fail closed
    // even if one of them ever drifts.
    promo = isPromotionIneligible(proposal.type)
      ? { ok: false, reason: `class "${proposal.type}" is PROMOTION-INELIGIBLE (index-affecting / redirect / visible-text / irreversible / map-pack-judged) — hard-excluded from the auto lane regardless of history` }
      : canAutoPromote(proposal.type, stats);
  }
  const promoted = promo?.ok === true;
  // E9 promotion lane × live edge adapters: a promoted (autoClasses-earned) class must NOT
  // auto-write LIVE to Edge Config / a Worker — decisions.ndjson is an unauthenticated local
  // file, so an earned lane may only land as a mergeable PR. Deterministic meta/title clamps
  // under the ORIGINAL conservative lane (and the explicit aggressive mode) keep their
  // pre-E9 behavior — this queues ONLY changes whose eligibility comes from the promo lane.
  if (promoted && !aggressive && EDGE_LIVE_ADAPTERS.has(cfg.cms?.type)) {
    blockers.push(`promoted class "${proposal.type}" + live edge adapter "${cfg.cms.type}" — promoted-lane changes route to the queue/PR path, never a live Edge Config/Worker write (fail closed)`);
    return { action: 'queue', risk: risk.tier, reasons, blockers };
  }
  const eligible = proposal.autoApplicable === true && (aggressive || DETERMINISTIC_FIX_TYPES.has(proposal.type) || promoted);
  if (!eligible) {
    blockers.push(proposal.autoApplicable
      ? (promo
        ? `class "${proposal.type}" is listed in riskTiers.autoClasses but the decisions ledger does not back it (${promo.reason}) — config alone cannot widen the auto lane`
        : `change-class "${proposal.type}" is not a low-risk deterministic clamp (set autopilot.mode:"aggressive" to widen)`)
      : 'not auto-applicable (needs authoring/review)');
    return { action: 'queue', risk: risk.tier, reasons, blockers };
  }
  reasons.push(aggressive ? `aggressive: ${proposal.type} (auto-applicable) → verifier consensus gates it`
    : promoted ? `promoted class "${proposal.type}" — earned via decisions ledger (${promo.reason})`
    : `deterministic ${proposal.type} clamp`);

  const proof = changeClassProven(proposal.type, stats);
  if (!proof.proven) {
    if (!aggressive) { blockers.push(`unproven change-class: ${proof.reason}`); return { action: 'queue', risk: risk.tier, reasons, blockers }; }
    reasons.push(`unproven class (${proof.reason}) — verifier consensus + change-ledger are the safety net`);
  } else { reasons.push(`proven non-negative history (${proof.reason})`); }
  reasons.push(`page risk tier: ${risk.tier} (${risk.reason})`);

  return { action: 'auto-approve', risk: risk.tier, reasons, blockers: [] };
}

/**
 * Build the traffic/revenue signal maps the policy needs, from a GSC + GA4 pull.
 * Callers (orchestrator) already have these objects; this just normalizes them.
 */
export function buildSignals(gsc, ga4, opts = {}) {
  const norm = (u) => { try { return new URL(u).pathname; } catch { return String(u || ''); } };
  const gscByPage = new Map();
  for (const p of (gsc?.pages || [])) {
    const path = norm(p.keys?.[0] || p.page || '');
    if (path) gscByPage.set(path, { impressions: p.impressions || 0, clicks: p.clicks || 0, position: p.position });
  }
  const ga4ByPath = new Map();
  for (const r of (ga4?.rows || [])) {
    if (r.page) ga4ByPath.set(r.page, { conversions: r.conversions || 0, sessions: r.sessions || 0 });
  }
  return { gscByPage, ga4ByPath, opts };
}

/**
 * Decide policy for a batch of proposals at once (the orchestrator's step-4 hook).
 * Returns { auto:[...], queued:[...], decisions:Map<id|taskKey, decision> }.
 */
export function decideBatch(proposals = [], cfg, { stats = [], signals = {} } = {}) {
  const auto = [];
  const queued = [];
  const decisions = new Map();
  for (const p of proposals) {
    const d = decidePolicy(p, cfg, { stats, signals });
    decisions.set(p.id ?? `${p.type}:${p.page}`, d);
    (d.action === 'auto-approve' ? auto : queued).push({ ...p, policy: d });
  }
  return { auto, queued, decisions };
}

/** Read the per-client stats decisions ledger (decisions.ndjson) for the proof check. */
export async function loadStatsDecisions(client) {
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROOT } = await import('./config.mjs');
  const f = join(ROOT, 'reports', client, 'decisions.ndjson');
  if (!existsSync(f)) return [];
  try {
    return readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; } // unreadable / partial write → fail soft, never crash the autopilot
}
