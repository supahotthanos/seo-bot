// seo-bot · stats/significance — the math behind "only change things when it's
// statistically significant." Pure functions, no deps. CTR and conversion are
// proportions, so a two-proportion z-test is the right tool; we gate on a minimum
// sample + minimum elapsed days first (you cannot judge significance on thin data),
// and support difference-in-differences to subtract a core-update/seasonality move.

const erf = (x) => {
  // Abramowitz & Stegun 7.1.26 (max error ~1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
export const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Two-proportion z-test (pooled). c=successes, n=trials. Returns z, two-sided p, significant. */
export function twoProportionZTest(c1, n1, c2, n2, alpha = 0.05) {
  if (![c1, n1, c2, n2].every(Number.isFinite) || n1 <= 0 || n2 <= 0 || c1 < 0 || c2 < 0 || c1 > n1 || c2 > n2) return { ok: false, reason: 'empty, non-finite, or successes>trials' };
  const p1 = c1 / n1, p2 = c2 / n2;
  const pPool = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { ok: true, p1, p2, z: 0, pValue: 1, significant: false };
  const z = (p2 - p1) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { ok: true, p1, p2, diff: p2 - p1, z, pValue, significant: pValue < alpha, direction: p2 > p1 ? 'up' : p2 < p1 ? 'down' : 'flat' };
}

/** Wilson score CI for a proportion (better than normal approx at small n). */
export function wilsonCI(c, n, z = 1.96) {
  if (!Number.isFinite(c) || !Number.isFinite(n) || n <= 0 || c < 0 || c > n) return [0, 0];
  const p = c / n;
  const d = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return [(center - margin) / d, (center + margin) / d];
}

/** Per-group sample size to detect a lift from p0→p0*(1+mde) at given alpha/power. */
export function minSampleForProportion(p0, mde, alpha = 0.05, power = 0.8) {
  if (!(p0 > 0) || !(mde > 0) || p0 >= 1) return Infinity; // can't size a test off a 0/1 baseline or non-positive lift
  const zA = 1.959963985, zB = power >= 0.8 ? 0.841621234 : 0.674489750;
  const p1 = p0, p2 = Math.min(0.999, p0 * (1 + mde));
  const pbar = (p1 + p2) / 2;
  const num = (zA * Math.sqrt(2 * pbar * (1 - pbar)) + zB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  return Math.ceil(num / ((p2 - p1) ** 2));
}

/** Gate: do we have enough data + elapsed time to judge at all? */
export function enoughData({ impressions = 0, days = 0 } = {}, { minImpressions = 1000, minDays = 14 } = {}) {
  return Number.isFinite(impressions) && Number.isFinite(days) && impressions >= minImpressions && days >= minDays;
}

/** Benjamini-Hochberg FDR. Given p-values, return boolean reject[] at level q.
 *  Testing many pages at alpha=0.05 manufactures false winners; this controls it.
 *  NaN p-values are treated as 1 (never reject) so a degenerate test cannot
 *  corrupt the sort order of valid p-values or become a false discovery. */
export function bhReject(pvals, q = 0.05) {
  const m = pvals.length;
  if (!m) return [];
  // Sanitise: NaN → 1 (most conservative; never below any BH threshold)
  const safe = pvals.map((p) => (Number.isFinite(p) ? p : 1));
  const order = safe.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  let maxK = -1;
  for (let k = 0; k < m; k++) if (order[k].p <= ((k + 1) / m) * q) maxK = k;
  const reject = new Array(m).fill(false);
  for (let k = 0; k <= maxK; k++) reject[order[k].i] = true;
  return reject;
}

/** Percentile bootstrap CI for a sample mean (AI-visibility reps: 5-7pp noise floor →
 *  a single run is meaningless; aggregate >=10 reps and report a CI). */
export function bootstrapCI(samples, { reps = 2000, alpha = 0.05 } = {}) {
  const n = samples.length;
  if (!n || !samples.every(Number.isFinite)) return { mean: 0, lo: 0, hi: 0 };
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const means = [];
  for (let r = 0; r < reps; r++) { let s = 0; for (let i = 0; i < n; i++) s += samples[(Math.random() * n) | 0]; means.push(s / n); }
  means.sort((a, b) => a - b);
  return { mean, lo: means[Math.floor((alpha / 2) * reps)], hi: means[Math.floor((1 - alpha / 2) * reps)] };
}

/**
 * Difference-in-differences for CTR: did the CHANGED page move more than a CONTROL
 * set over the same window? Subtracts a market-wide move (core update / seasonality).
 * Each arg = {clicks, impressions} before/after. Returns the DiD on CTR + a z-test
 * of the treatment delta against the control delta (approx via pooled SEs).
 */
export function differenceInDifferences(treatBefore, treatAfter, ctrlBefore, ctrlAfter) {
  // Require all four arms. Missing control data means we cannot subtract a
  // market-wide move, so we must not produce a significance verdict — return a
  // clearly insufficient result rather than silently dividing by a fabricated
  // zero control and potentially yielding a false positive.
  if (!treatBefore || !treatAfter || !ctrlBefore || !ctrlAfter) {
    return { ok: false, reason: 'insufficient data: control arm missing', didCtr: 0, treatDelta: 0, controlDelta: 0, z: 0, pValue: 1, significant: false };
  }
  // Domain-validate every arm (same as twoProportionZTest) — negative clicks / clicks>impressions
  // / non-finite produce a negative variance that FABRICATES significance. Fail closed.
  const badArm = (x) => ![x.clicks, x.impressions].every(Number.isFinite) || x.clicks < 0 || x.impressions < 0 || x.clicks > x.impressions;
  if ([treatBefore, treatAfter, ctrlBefore, ctrlAfter].some(badArm)) return { ok: false, reason: 'insufficient data: non-finite or out-of-domain arm', didCtr: 0, treatDelta: 0, controlDelta: 0, z: 0, pValue: 1, significant: false };
  const ctr = (x) => (x.impressions ? x.clicks / x.impressions : 0);
  const dTreat = ctr(treatAfter) - ctr(treatBefore);
  const dCtrl = ctr(ctrlAfter) - ctr(ctrlBefore);
  const did = dTreat - dCtrl;
  // variance of each CTR ≈ p(1-p)/n; var of DiD = sum of the four
  const v = (x) => { const p = ctr(x); return x.impressions ? (p * (1 - p)) / x.impressions : 0; };
  const seDid = Math.sqrt(v(treatAfter) + v(treatBefore) + v(ctrlAfter) + v(ctrlBefore));
  const z = seDid ? did / seDid : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { ok: true, didCtr: did, treatDelta: dTreat, controlDelta: dCtrl, z, pValue, significant: pValue < 0.05 };
}
