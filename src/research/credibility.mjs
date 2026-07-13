// seo-bot · research/credibility — "be smart, don't take info as true."
//
// Everything the fetcher scrapes (an X post, a vendor blog, a "study") enters as a
// CLAIM and is scored here. The output gates whether a claim may even be PROPOSED as
// a change to the bot's audit rules. The hard invariant: this layer NEVER writes to
// rules.mjs — a human hand-edits rules after reading the brief. Scrapling closes no loop.
//
// score = 0.6*sourceTier + 0.4*evidenceStrength  − Σ redFlags  + corroborationBonus
//   • SIFT: if the source isn't identified OR a "study" claim doesn't trace to a
//     fetchable primary, score is capped at thresholds.traceCap (→ watch, never apply).
//   • Veto: a claim pushing a tactic on Google's May-2026 "you don't need this" list
//     can NEVER be auto_apply — forced to human_review.
//   • Independence: corroborators are deduped by root (study/vendor/author/url) so a
//     tweet resyndicated by 3 blogs counts ONCE. This dedup is load-bearing.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRUST = JSON.parse(readFileSync(join(__dirname, '..', '..', 'config', 'source-trust.json'), 'utf-8'));

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

/** Resolve a sourceKey ("x:@handle") or URL to a tier record. */
export function classifySource(sourceKeyOrUrl) {
  if (!sourceKeyOrUrl) return { tier: 'UNKNOWN', weight: TRUST.tierWeights.UNKNOWN, veto: false, biasFlags: [] };
  const k = String(sourceKeyOrUrl).toLowerCase();
  // exact handle match first
  let rec = TRUST.sources.find(s => s.kind === 'handle' && k === s.key.toLowerCase());
  // else domain substring match
  if (!rec) {
    let host = k;
    try { host = new URL(k.startsWith('http') ? k : `https://${k}`).hostname.replace(/^www\./, ''); } catch {}
    rec = TRUST.sources.find(s => { if (s.kind !== 'domain') return false; const key = s.key.toLowerCase(); return host === key || host.endsWith('.' + key); });
  }
  if (!rec) return { tier: 'UNKNOWN', weight: TRUST.tierWeights.UNKNOWN, veto: false, biasFlags: [], name: undefined };
  return { tier: rec.tier, weight: TRUST.tierWeights[rec.tier] ?? TRUST.tierWeights.UNKNOWN, veto: !!rec.veto, biasFlags: rec.biasFlags || [], name: rec.name };
}

export function evidenceWeight(strength) {
  return TRUST.evidenceWeights[strength] ?? TRUST.evidenceWeights.ASSERTION;
}

/** Heuristic classifier: shape of a claim's text → evidence-strength key. Advisory. */
export function classifyEvidence(text = '') {
  const t = text.toLowerCase();
  if (/\b(a\/b test|randomi[sz]ed|control group|holdout|controlled experiment)\b/.test(t)) return 'CONTROLLED_EXPERIMENT';
  if (/\b(i (?:saw|noticed|think|believe)|in my experience|anecdotal)\b/.test(t)) return 'ANECDOTE';
  if (/\b(case study|we saw|after we|client|one site)\b/.test(t)) return 'CASE_STUDY';
  if (/\b(\d{3,}|\d+(?:,\d{3})+)\b.*\b(sites?|pages?|queries|domains?|brands?|samples?)\b/.test(t) || /\bcorrelat|\br\s*=\s*0?\.\d/.test(t)) return 'LARGE_N_CORRELATION';
  return 'ASSERTION';
}

/** Does the text push a tactic Google's May-2026 guide says is unnecessary? */
export function contradictsGoogleVeto(text = '') {
  const t = text.toLowerCase();
  return TRUST.googleVetoList.some(v => t.includes(v.toLowerCase().split(' for ')[0]));
}

/** Heuristic red-flag detector over a claim's text. Returns flag keys present. */
export function detectRedFlags(text = '', { isVendor = false, fundingDisclosed = false } = {}) {
  const t = text.toLowerCase();
  const flags = [];
  if (isVendor && !fundingDisclosed) flags.push('vendorFundedUndisclosed');
  if (/\b(best|top \d+|affiliate|coupon|discount code|sign up|buy now)\b/.test(t) && /\breview|listicle|vs\b/.test(t)) flags.push('affiliateOrListicle');
  if (/\b(data shows|study shows|proven)\b/.test(t) && /\bi (?:saw|noticed)\b/.test(t)) flags.push('anecdoteDressedAsData');
  if (/\branking|traffic\b/.test(t) && /\b(jumped|dropped|tanked|surged)\b/.test(t) && !/\bcore update|holiday|season|isolated|controlled\b/.test(t)) flags.push('recencySeasonalityConfound');
  if (/\b(winners|top performers|sites that rank)\b/.test(t) && /\ball (?:did|have|use)\b/.test(t) && !/\bcompared|control|loser\b/.test(t)) flags.push('survivorshipBias');
  if (/\b(study|data|analysis)\b/.test(t) && !/\b(method|sample|n\s*=|how we)\b/.test(t)) flags.push('noMethodology');
  return flags;
}

/** Dedup corroborators by their independence root → count of INDEPENDENT sources.
 *  When a corroborator carries no identity field (rootKey/studyId/vendor/author/
 *  rootUrl/url) it is treated as a DISTINCT anonymous source — not collapsed with
 *  other identity-less corroborators.  A per-call counter produces a unique,
 *  stable sentinel for each such entry so the dedup Map never merges them.
 */
export function dedupeIndependent(corroborators = []) {
  const roots = new Map();
  let anonCounter = 0;
  for (const c of corroborators) {
    const identityKey = c.rootKey || c.studyId || c.vendor || c.author || c.rootUrl || c.url;
    const root = identityKey
      ? String(identityKey).toLowerCase()
      : `__anon_${anonCounter++}__`;
    if (!roots.has(root)) roots.set(root, c.tier || 'UNKNOWN');
  }
  return [...roots.entries()].map(([root, tier]) => ({ root, tier }));
}

/**
 * Score a claim ∈ [0,1].
 * claim = {
 *   text, sourceKey|url, evidenceStrength?, tracedToPrimary?, sourceIdentified?,
 *   extraordinariness?(0..1), corroborators?:[{rootKey|vendor|author|url, tier}],
 *   redFlags?:[], isVendor?, fundingDisclosed?
 * }
 */
export function scoreClaim(claim) {
  const src = classifySource(claim.sourceKey || claim.url);
  const sourceW = src.weight;
  const evStrength = claim.evidenceStrength || classifyEvidence(claim.text || '');
  const evW = evidenceWeight(evStrength);

  let score = 0.6 * sourceW + 0.4 * evW;

  // Red flags from: the claim, text heuristics, AND the source's bias flags that
  // map to a known red flag (e.g. manipulationVendor/selfPromotingTooling on Jacky Chou).
  const srcFlags = (src.biasFlags || []).filter((b) => TRUST.redFlags[b] !== undefined);
  const flags = new Set([...(Array.isArray(claim.redFlags) ? claim.redFlags : []), ...srcFlags, ...detectRedFlags(claim.text || '', { isVendor: claim.isVendor || src.biasFlags?.includes('vendorFunded'), fundingDisclosed: claim.fundingDisclosed })]);
  // single-source fanout: relay/social with no independent corroborator
  const indep = dedupeIndependent(claim.corroborators || []);
  if (indep.length <= 1 && ['REPORTING_RELAY', 'ANON_SOCIAL'].includes(src.tier)) flags.add('singleSourceFanout');
  for (const f of flags) score += (TRUST.redFlags[f] || 0);

  // corroboration bonus (independent, capped)
  if (indep.length > 1) score += Math.min(0.2, 0.1 * (indep.length - 1));

  // SIFT hard caps
  const investigated = claim.sourceIdentified !== false && src.tier !== 'UNKNOWN';
  const isStudyClaim = /\b(study|research|data|analysis|experiment)\b/i.test(claim.text || '');
  const tracedOk = isStudyClaim ? claim.tracedToPrimary === true : true;
  if (!investigated || !tracedOk) score = Math.min(score, TRUST.thresholds.traceCap);

  return {
    score: clamp(score),
    sourceTier: src.tier, sourceWeight: sourceW, sourceName: src.name,
    evidenceStrength: evStrength, evidenceWeight: evW,
    redFlags: [...flags], independentCorroborators: indep,
    veto: contradictsGoogleVeto(claim.text || ''),
    investigated, tracedToPrimary: tracedOk,
    extraordinary: (claim.extraordinariness || 0) > TRUST.thresholds.extraordinarinessScrutiny,
  };
}

/**
 * Route a scored claim into a bucket. NOTE: "auto_apply" here means "promote to the
 * human-review queue as a high-confidence proposal" — there is NO code path from this
 * routine to a rules.mjs write. A human always types the rule change.
 */
export function routeProposal(claim) {
  const s = scoreClaim(claim);
  const th = TRUST.thresholds;
  const strongTierW = TRUST.tierWeights[th.strongCorroborationTier];
  const strongIndep = s.independentCorroborators.filter(c => (TRUST.tierWeights[c.tier] ?? 0) >= strongTierW).length;
  const reasons = [];

  let bucket;
  if (s.veto) { bucket = 'human_review'; reasons.push('contradicts Google May-2026 veto list — cannot auto-apply'); }
  else if (s.score >= th.autoApply && strongIndep >= th.minStrongCorroborators) { bucket = 'auto_apply'; reasons.push(`score ${s.score.toFixed(2)} + ${strongIndep} strong independent corroborators (still requires human sign-off)`); }
  else if (s.score >= th.humanReview && s.independentCorroborators.length >= 2) { bucket = 'human_review'; reasons.push(`score ${s.score.toFixed(2)} with ${s.independentCorroborators.length} independent corroborators`); }
  else if (s.score >= th.watch) { bucket = 'watch'; reasons.push(`score ${s.score.toFixed(2)} — track, re-check next run; not a proposal`); }
  else { bucket = 'discard'; reasons.push(`score ${s.score.toFixed(2)} — single anecdote / low trust`); }

  if (!s.tracedToPrimary) reasons.push('study claim not traced to a fetchable primary (capped)');
  if (s.redFlags.length) reasons.push(`red flags: ${s.redFlags.join(', ')}`);

  return { ...s, bucket, strongIndependentCorroborators: strongIndep, reasons };
}

export const THRESHOLDS = TRUST.thresholds;
