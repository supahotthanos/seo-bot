// seo-bot · experiments/classes — which proposal classes may become EDGE EXPERIMENTS.
//
// SINGLE SOURCE OF TRUTH: edge/cloaking-guard.mjs. The guard's EDGE_SAFE_FIELDS allowlist
// (title / meta description / canonical / robots / og / twitter / hreflang / JSON-LD /
// answer-capsule) is the ONLY definition of "head-only, identical for every UA". This module
// does NOT restate that list — it imports it and maps proposal types onto it, so a change to
// the guard automatically changes what the experiment loop may nominate. If the two ever
// disagreed, the loop could nominate an experiment whose edge payload the guard then refuses
// at apply time (or worse, the inverse). Deriving keeps them provably in lockstep.
//
// FAIL-CLOSED: any proposal whose type is missing, unmapped, or normalizes to a field outside
// the allowlist (or inside CLOAKING_FIELDS — body/H1/visible text) is {safe:false}. Unknown
// never means "probably fine"; body/copy changes graduate via a source PR, never an edge test.

import { EDGE_SAFE_FIELDS, CLOAKING_FIELDS, fieldOf, classifyProposal } from '../edge/cloaking-guard.mjs';

/**
 * EDGE-SAFE is NOT the same invariant as EXPERIMENT-SAFE. A field can be servable at the
 * edge without cloaking (identical for every UA) yet still be unable to run as a live A/B:
 *   • 'robots' — a noindex variant DEINDEXES its own arm, destroying the impression/CTR
 *     denominator for the entire locked horizon before SRM can catch it at evaluation
 *     (E9's noindexFix emits type 'robots-noindex', and nomination targets HIGH-traffic
 *     clusters — exactly the pages that must never be deindexed by an experiment).
 *   • 'hreflang' — re-routes impressions between locales, corrupting arm assignment.
 * These fields stay applyable through the normal gated edge/PR path; they are subtracted
 * AFTER deriving from EDGE_SAFE_FIELDS so they can never become an experiment arm
 * (fail-closed: the treatment must not destroy its own measurement denominator).
 */
export const EXPERIMENT_EXCLUDED = new Set(['robots', 'hreflang']);

/**
 * The canonical experiment classes, DERIVED from the guard's allowlist (never restated),
 * MINUS the experiment-excluded fields (edge-safe ≠ experiment-safe — see above).
 * Each allowlist alias is normalized through fieldOf() and re-checked against the guard, so
 * the result is exactly the set of canonical fields the cloaking guard would let through
 * that are also safe to measure.
 * @returns {Set<string>}
 */
export function experimentClasses() {
  const out = new Set();
  for (const alias of EDGE_SAFE_FIELDS) {
    const field = fieldOf(alias);
    if (EDGE_SAFE_FIELDS.has(field) && !CLOAKING_FIELDS.has(field) && !EXPERIMENT_EXCLUDED.has(field)) out.add(field);
  }
  return out;
}

/**
 * Decide whether ONE proposal may become an edge experiment variant.
 * Delegates the actual safety judgement to the cloaking guard's classifyProposal() — this
 * function only adds the experiment-loop framing ({safe, field, reason}) on top, so the
 * guard stays the single arbiter of head-safety.
 *
 * @param {{type?:string}} proposal  a decide.mjs proposal (only .type is inspected)
 * @returns {{safe:boolean, field:string|null, reason:string}}
 */
export function classifyExperimentSafe(proposal) {
  const type = proposal?.type;
  if (typeof type !== 'string' || !type.trim()) {
    return { safe: false, field: null, reason: 'proposal has no usable type — cannot map to an override class; refusing (fail-closed).' };
  }
  const c = classifyProposal(proposal);
  if (!c.ok) return { safe: false, field: c.field || null, reason: c.reason || 'refused by the cloaking guard (fail-closed).' };
  if (EXPERIMENT_EXCLUDED.has(c.field)) {
    return { safe: false, field: c.field, reason: `"${c.field}" is edge-servable but NOT experiment-safe — a variant on it can destroy its own measurement denominator (e.g. a noindex arm deindexes itself for the whole locked horizon before SRM can kill it). Apply via the gated edge/PR path, never as an A/B arm (fail-closed).` };
  }
  return { safe: true, field: c.field, reason: `"${c.field}" is head-only (EDGE_SAFE_FIELDS) — eligible for a deterministic per-page edge experiment.` };
}
