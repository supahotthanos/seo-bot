// seo-bot · stats/guardrails — the "don't win the battle and lose the war" layer.
//
// A title/meta experiment optimizes ONE metric (CTR). Guardrails make sure that win didn't
// quietly tank the things that actually matter. Three independent checks, then a verdict:
//
//   1. NON-INFERIORITY tests on each guardrail metric — GA4 conversion rate, total organic
//      clicks, Core Web Vitals (CrUX p75 via data/crux.mjs), AI-citation rate (via
//      measure.mjs). Non-inferiority (NOT a plain two-sided test) is the right tool: we want
//      to PROVE the variant is "no meaningfully worse than control within a margin," because
//      failing to find harm is not the same as proving safety. A metric is BREACHED only when
//      the CI shows it dropped MORE than the allowed margin — a real, bounded regression.
//   2. SRM (Sample-Ratio Mismatch) — a chi-square on the impressions split vs the intended
//      ratio. If traffic didn't split as designed (a bucketing/instrumentation bug), the whole
//      experiment is INVALID and any "lift" is an artifact. Industry standard pre-check.
//   3. decide() — fuses 1+2 into keep | rollback | insufficient, fail-CLOSED on breach.
//
// Reuses significance.mjs (two-proportion z, normalCdf); no I/O, no deps. The CrUX/measure
// numbers are passed IN as already-collected readings (callers fetch via data/crux.mjs /
// measure.mjs), so this stays a pure decision function the loop and tests can drive directly.

import { twoProportionZTest, normalCdf } from './significance.mjs';

/**
 * Non-inferiority / regression test for a PROPORTION (conversion rate, citation rate, CTR…).
 * Returns THREE distinct states — the distinction matters for a rollback decision:
 *   nonInferior : the (1−alpha) CI lower bound on (pV − pC) sits ABOVE −margin → certified safe.
 *   breached    : we can affirmatively PROVE harm — the CI UPPER bound is still below −margin,
 *                 i.e. we're confident the drop EXCEEDS the tolerated margin. This is what
 *                 triggers rollback (a demonstrated regression, not mere low power).
 *   else        : "uncertified" — point estimate fine-ish but not enough data to prove either.
 *                 NOT a rollback; the loop should wait for more data (insufficient), never
 *                 revert a variant just because we couldn't yet certify it.
 * @returns {{ok, pC, pV, diff, margin, lowerBound, upperBound, nonInferior, breached, z, reason}}
 */
export function nonInferiorityProportion(cConv, cN, vConv, vN, { marginPct = 0.1, alpha = 0.05, biggerIsBetter = true } = {}) {
  if (![cConv, cN, vConv, vN].every(Number.isFinite) || cN <= 0 || vN <= 0 || cConv < 0 || vConv < 0 || cConv > cN || vConv > vN) return { ok: false, reason: 'empty, non-finite, or out-of-domain sample', breached: false, nonInferior: false };
  const pC = cConv / cN, pV = vConv / vN;
  const diff = pV - pC;
  // Pooled SE (consistent with the rest of significance.mjs).
  const pPool = (cConv + vConv) / (cN + vN);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / cN + 1 / vN)) || 1e-9;
  const zUse = alpha === 0.05 ? 1.6448536269514722 : invNormOneSided(alpha);
  const margin = pC > 0 ? marginPct * pC : marginPct * 0.01; // zero baseline → small absolute margin so the test still functions (not a 0 margin that disables it)
  const lowerBound = diff - zUse * se;
  const upperBound = diff + zUse * se;
  if (biggerIsBetter) {
    const nonInferior = lowerBound > -margin;            // certified within tolerance
    const breached = upperBound < -margin;               // proven worse than tolerance
    const reason = nonInferior ? `non-inferior (CI lower ${lowerBound.toFixed(4)} > −margin ${(-margin).toFixed(4)})`
      : breached ? `BREACH: CI upper ${upperBound.toFixed(4)} < −margin ${(-margin).toFixed(4)} — proven worse by > ${(marginPct * 100).toFixed(0)}%`
        : `uncertified (CI [${lowerBound.toFixed(4)}, ${upperBound.toFixed(4)}] straddles −margin ${(-margin).toFixed(4)}) — need more data`;
    return { ok: true, pC, pV, diff, margin, lowerBound, upperBound, nonInferior, breached, z: diff / se, reason };
  }
  // smaller-is-better metric (rare for proportions): mirror the inequality.
  const nonInferior = upperBound < margin;
  const breached = lowerBound > margin;
  return { ok: true, pC, pV, diff, margin, lowerBound, upperBound, nonInferior, breached, z: diff / se, reason: nonInferior ? 'non-inferior (smaller-is-better)' : breached ? 'BREACH (smaller-is-better metric proven past margin)' : 'uncertified (smaller-is-better)' };
}

/** One-sided z critical value for a given alpha (inverse normal, Acklam approx). */
function invNormOneSided(alpha) {
  // P(Z > z) = alpha → z = Φ⁻¹(1−alpha). Newton on normalCdf (cheap, monotone).
  let z = 1.64, p = 1 - alpha;
  for (let i = 0; i < 40; i++) {
    const f = normalCdf(z) - p;
    const d = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    if (d < 1e-12) break;
    z -= f / d;
  }
  return z;
}

/**
 * Non-inferiority for a CONTINUOUS metric reading (CrUX p75 ms, total clicks count) where we
 * have point values + a tolerated relative margin. Lighter than the proportion test (no n),
 * used when a metric is a single field reading rather than a success/trial pair.
 * For CWV (smaller-is-better): breach when variant rises > margin above control.
 * For clicks/sessions (bigger-is-better): breach when variant falls > margin below control.
 * @returns {{ok, control, variant, relChange, margin, breached, reason}}
 */
export function nonInferiorityValue(control, variant, { marginPct = 0.1, biggerIsBetter = true, label = 'metric' } = {}) {
  if (!Number.isFinite(control) || !Number.isFinite(variant) || control < 0 || variant < 0) return { ok: false, breached: false, reason: `${label}: missing / non-finite / negative reading — cannot certify (fail-closed)` };
  if (control === 0) return { ok: true, skipped: true, control, variant, relChange: 0, margin: marginPct, breached: false, reason: `${label}: control baseline 0 — skipped` };
  const relChange = (variant - control) / Math.abs(control);
  let breached;
  if (biggerIsBetter) breached = relChange < -marginPct;     // dropped too far
  else breached = relChange > marginPct;                      // rose too far (e.g. LCP got slower)
  return { ok: true, control, variant, relChange, margin: marginPct, breached, reason: breached ? `BREACH: ${label} moved ${(relChange * 100).toFixed(1)}% (margin ±${(marginPct * 100).toFixed(0)}%, ${biggerIsBetter ? 'bigger' : 'smaller'} is better)` : `${label} ok (${(relChange * 100).toFixed(1)}%)` };
}

/**
 * Sample-Ratio Mismatch: chi-square goodness-of-fit on the observed split vs intended.
 * observed = [nControl, nVariant] (impressions/assignments). expectedRatio = [wC, wV].
 * A small p (< srmAlpha, default 0.001 — SRM uses a tight alpha) means the split is broken
 * → the experiment is INVALID regardless of any apparent lift.
 * @returns {{ok, chiSquare, pValue, mismatch, observed, expected}}
 */
export function srmCheck(observed, expectedRatio = [0.5, 0.5], { srmAlpha = 0.001 } = {}) {
  if (observed.length !== expectedRatio.length) return { ok: false, mismatch: false, reason: `srmCheck: observed length (${observed.length}) ≠ expectedRatio length (${expectedRatio.length}) — cannot compute chi-square` };
  const total = observed.reduce((s, v) => s + v, 0);
  const wSum = expectedRatio.reduce((s, v) => s + v, 0) || 1;
  if (total <= 0) return { ok: false, mismatch: false, reason: 'no assignments' };
  if (!observed.every((v) => Number.isFinite(v) && v >= 0)) return { ok: false, mismatch: false, reason: 'non-finite or negative observed counts — invalid split data' };
  const expected = expectedRatio.map((w) => (w / wSum) * total);
  let chi = 0;
  for (let i = 0; i < observed.length; i++) { if (expected[i] > 0) chi += ((observed[i] - expected[i]) ** 2) / expected[i]; }
  // df=1 for two arms: p = P(χ²₁ > chi) = 2·(1 − Φ(√chi)).
  const pValue = observed.length === 2 ? 2 * (1 - normalCdf(Math.sqrt(chi))) : chiSqSurvival(chi, observed.length - 1);
  const mismatch = pValue < srmAlpha;
  return { ok: true, chiSquare: chi, pValue, mismatch, observed, expected, reason: mismatch ? `SRM: split ${observed.join(':')} ≠ intended (χ²=${chi.toFixed(2)}, p=${pValue.toExponential(2)}) — experiment INVALID` : `split ok (χ²=${chi.toFixed(2)})` };
}

/** χ² survival function for df>1 (Wilson-Hilferty cube-root normal approx; df=1 handled inline). */
function chiSqSurvival(x, df) {
  if (x <= 0) return 1;
  const t = Math.pow(x / df, 1 / 3);
  const m = 1 - 2 / (9 * df);
  const s = Math.sqrt(2 / (9 * df));
  return 1 - normalCdf((t - m) / s);
}

/**
 * The guardrail verdict. Runs SRM + every supplied guardrail check, then fuses.
 *
 * @param {object} input
 * @param {[number,number]} [input.split]            [controlImpr, variantImpr] for SRM
 * @param {[number,number]} [input.expectedRatio]    intended split (default 50/50)
 * @param {object} [input.conversion] {cConv,cN,vConv,vN}    GA4 conversion rate (proportion NI)
 * @param {object} [input.clicks]     {control, variant}     total organic clicks (value NI, bigger-better)
 * @param {object} [input.cwv]        {control:{lcp,inp,cls}, variant:{...}}  CrUX p75 (value NI, smaller-better)
 * @param {object} [input.citation]   {cConv,cN,vConv,vN}    AI-citation rate (proportion NI)
 * @param {object} [opts] { marginPct, alpha, srmAlpha, cwvMarginPct }
 * @returns {{decision:'keep'|'rollback'|'insufficient', breaches:string[], srm, checks:object, reason:string}}
 */
export function decide(input = {}, opts = {}) {
  const marginPct = opts.marginPct ?? 0.1;
  const cwvMarginPct = opts.cwvMarginPct ?? 0.1;
  const checks = {};
  const breaches = [];
  const uncertified = [];
  let compared = 0; // count of guardrails that produced a REAL comparison (not merely present / empty / skipped)

  // SRM first — a broken split invalidates everything downstream.
  let srm = null;
  if (input.split) {
    // A split that cannot be integrity-checked (non-2-arm, or corrupt/non-finite counts) must
    // NOT be treated as "healthy" — fail closed, never promote on an unverifiable randomization.
    if (input.split.length !== 2) return { decision: 'insufficient', breaches: [], uncertified: [], srm: null, checks, reason: `SRM split must have exactly 2 arms (got ${input.split.length}) — cannot verify randomization; fail closed.` };
    srm = srmCheck(input.split, input.expectedRatio || [0.5, 0.5], { srmAlpha: opts.srmAlpha ?? 0.001 });
    if (srm.mismatch) return { decision: 'rollback', breaches: [srm.reason], srm, checks, reason: 'Sample-ratio mismatch — experiment is invalid; rolling back the variant assignment.' };
    if (!srm.ok) return { decision: 'insufficient', breaches: [], uncertified: [], srm, checks, reason: `split integrity unverifiable (${srm.reason}) — fail closed; do not promote.` };
  }

  // GA4 conversion rate (bigger is better) — non-inferiority on a proportion.
  if (input.conversion && input.conversion.cN > 0 && input.conversion.vN > 0) {
    const r = nonInferiorityProportion(input.conversion.cConv, input.conversion.cN, input.conversion.vConv, input.conversion.vN, { marginPct, alpha: opts.alpha ?? 0.05, biggerIsBetter: true });
    checks.conversion = r; if (r.ok) compared++;
    if (r.breached) breaches.push('GA4 conversion rate — ' + r.reason); else if (!r.nonInferior) uncertified.push('GA4 conversion rate');
  }
  // AI-citation rate (bigger is better) — non-inferiority on a proportion.
  if (input.citation && input.citation.cN > 0 && input.citation.vN > 0) {
    const r = nonInferiorityProportion(input.citation.cConv, input.citation.cN, input.citation.vConv, input.citation.vN, { marginPct, alpha: opts.alpha ?? 0.05, biggerIsBetter: true });
    checks.citation = r; if (r.ok) compared++;
    if (r.breached) breaches.push('AI-citation rate — ' + r.reason); else if (!r.nonInferior) uncertified.push('AI-citation rate');
  }
  // Total organic clicks (bigger is better) — value non-inferiority.
  if (input.clicks && input.clicks.control != null && input.clicks.variant != null) {
    const r = nonInferiorityValue(input.clicks.control, input.clicks.variant, { marginPct, biggerIsBetter: true, label: 'organic clicks' });
    checks.clicks = r; if (r.ok && !r.skipped) compared++;
    if (r.breached) breaches.push(r.reason); else if (!r.ok || r.skipped) uncertified.push('organic clicks (no clean reading)'); // corrupt/non-finite/zero-baseline → can't certify
  }
  // Core Web Vitals (smaller is better) — value non-inferiority per metric.
  if (input.cwv && input.cwv.control && input.cwv.variant) {
    checks.cwv = {};
    for (const k of ['lcp', 'inp', 'cls']) {
      if (input.cwv.control[k] == null || input.cwv.variant[k] == null) continue;
      const r = nonInferiorityValue(input.cwv.control[k], input.cwv.variant[k], { marginPct: cwvMarginPct, biggerIsBetter: false, label: `CWV ${k.toUpperCase()}` });
      checks.cwv[k] = r; if (r.ok && !r.skipped) compared++;
      if (r.breached) breaches.push(r.reason); else if (!r.ok || r.skipped) uncertified.push(`CWV ${k.toUpperCase()} (no clean reading)`); // corrupt/non-finite → can't certify
    }
  }

  if (breaches.length) return { decision: 'rollback', breaches, uncertified, srm, checks, reason: `${breaches.length} guardrail breach(es) — rolling back even if the primary metric improved.` };
  // Certify on REAL comparisons only — an empty/all-null/skipped metric block (e.g. CrUX returned no
  // field data) must NEVER count as a passed guardrail. Zero real comparisons → fail closed.
  if (compared === 0) return { decision: 'insufficient', breaches: [], uncertified, srm, checks, reason: 'no guardrail produced a real comparison (missing/empty/zero-baseline metrics) — cannot certify safety (fail-closed).' };
  // No proven harm, but if a guardrail couldn't be certified for lack of power, don't claim "safe" —
  // hold as insufficient so the loop waits rather than auto-promoting on a blind spot (fail-closed).
  if (uncertified.length && !opts.allowUncertified) return { decision: 'insufficient', breaches: [], uncertified, srm, checks, reason: `no breach, but ${uncertified.length} guardrail(s) underpowered (${uncertified.join(', ')}) — wait for more data before promoting.` };
  return { decision: 'keep', breaches: [], uncertified, srm, checks, reason: 'all guardrails non-inferior' + (srm && srm.ok && !srm.mismatch ? ' + split healthy' : '') + (uncertified.length ? ` (${uncertified.length} uncertified, allowed)` : '') + ' — safe to keep/promote.' };
}
