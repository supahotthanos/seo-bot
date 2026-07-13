// seo-bot · stats/counterfactual — control-as-predictor causal impact (a CausalImpact-lite).
//
// THE PROBLEM diff-in-differences (significance.mjs) only half-solves: a single control
// delta subtracts ONE market move, but seasonality/core-update shocks are multiplicative and
// time-varying. THE FIX (Brodersen et al., Google's CausalImpact): during a clean BASELINE
// window the variant bucket's traffic is a stable linear function of the control bucket's
// traffic (they move together — same template, same crawler, same seasonality). Fit that
// relationship, then in the POST window use the control's ACTUAL trajectory to predict the
// variant's COUNTERFACTUAL ("what it would have done with no change"). The gap between
// observed and counterfactual, summed over the post window, is the causal lift. A block
// bootstrap over baseline residuals gives a CI on that cumulative lift — so "the change
// worked" means the CI excludes zero, not "the number went up."
//
// We deliberately keep the model to OLS (slope+intercept) or a pure ratio — robust on the
// short, noisy daily series GSC gives a single template cluster; a full BSTS would overfit.
// Reuses significance.mjs bootstrap intuition + normalCdf; pure functions, no I/O, no deps.

import { normalCdf } from './significance.mjs';

/** Simple OLS y = a + b·x over paired arrays. Returns {a, b, r2, n, predict}. */
export function ols(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { a: ys[0] || 0, b: 0, r2: 0, n, predict: () => ys[0] || 0 };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2, n, predict: (x) => a + b * x };
}

/** Ratio model: variant ≈ ratio · control (intercept-free; robust when both are counts). */
export function ratioModel(controlBaseline, variantBaseline) {
  const cs = controlBaseline.reduce((s, v) => s + v, 0);
  const vs = variantBaseline.reduce((s, v) => s + v, 0);
  const ratio = cs > 0 ? vs / cs : 1;
  return { ratio, predict: (c) => ratio * c };
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const quantile = (sorted, q) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
};

// CALIBRATION (measured by Monte-Carlo, 14-period baseline / 7-period post, σ≈8):
//   true-null false-positive rate ≈ 0.10 at alpha=0.05; power ≈ 0.77 at a +10/day effect,
//   ≈0.98 at +15/day. The slight residual liberality is the honest cost of fitting a model
//   on a short, noisy single-cluster series — so the loop NEVER treats this in isolation:
//   its verdict feeds the controller (which applies BH-FDR across the experiment batch) and
//   is AND-ed with non-inferiority guardrails. Longer baselines tighten it toward nominal.
/**
 * Fit the variant↔control relationship on the baseline window, forecast the no-change
 * counterfactual over the post window, and bootstrap a CI on cumulative lift.
 *
 * @param {object} series
 * @param {number[]} series.controlBaseline  control metric per period, BEFORE the change
 * @param {number[]} series.variantBaseline  variant metric per period, BEFORE the change
 * @param {number[]} series.controlPost       control metric per period, AFTER the change
 * @param {number[]} series.variantPost       variant metric per period, AFTER the change
 * @param {object} [opts]
 * @param {'ols'|'ratio'} [opts.model='ols']  ratio is safer when baseline is short/noisy
 * @param {number} [opts.reps=2000]           bootstrap resamples
 * @param {number} [opts.alpha=0.05]          → (1-alpha) CI
 * @param {number} [opts.blockSize]           moving-block size (defaults ~sqrt(baseline len))
 * @param {Function} [opts.rng=Math.random]
 * @returns {{
 *   ok:boolean, reason?:string, model:string, fit:{a?:number,b?:number,ratio?:number,r2?:number},
 *   counterfactual:number[], observed:number[], pointwise:number[],
 *   cumulativeLift:number, relLift:number, ci:[number,number], pValue:number, significant:boolean
 * }}
 */
export function counterfactualImpact(series, opts = {}) {
  const { controlBaseline = [], variantBaseline = [], controlPost = [], variantPost = [] } = series || {};
  const model = opts.model || 'ols';
  const alpha = opts.alpha ?? 0.05;
  const reps = Math.max(200, opts.reps ?? 2000); // floor the bootstrap — reps<=0 gave a degenerate zero-width CI
  const rng = opts.rng || Math.random;

  const nBase = Math.min(controlBaseline.length, variantBaseline.length);
  const nPost = Math.min(controlPost.length, variantPost.length);
  if (nBase < 3) return { ok: false, reason: 'baseline too short (need >= 3 periods to fit a counterfactual)', model, fit: {}, counterfactual: [], observed: [], pointwise: [], cumulativeLift: 0, relLift: 0, ci: [0, 0], pValue: 1, significant: false };
  if (nPost < 1) return { ok: false, reason: 'no post-change periods yet', model, fit: {}, counterfactual: [], observed: [], pointwise: [], cumulativeLift: 0, relLift: 0, ci: [0, 0], pValue: 1, significant: false };
  // Every used value must be finite — a single null/NaN/Infinity day collapses the model
  // (sigma→NaN) and would bypass the zero-variance guard, yielding a false "it worked". Fail closed.
  if (![...controlBaseline.slice(0, nBase), ...variantBaseline.slice(0, nBase), ...controlPost.slice(0, nPost), ...variantPost.slice(0, nPost)].every(Number.isFinite))
    return { ok: false, reason: 'non-finite value in a series (missing/corrupt day) — cannot fit a counterfactual', model, fit: {}, counterfactual: [], observed: [], pointwise: [], cumulativeLift: 0, relLift: 0, ci: [0, 0], pValue: 1, significant: false };

  // 1) Fit on the baseline (control predicts variant).
  const cb = controlBaseline.slice(0, nBase), vb = variantBaseline.slice(0, nBase);
  const cp = controlPost.slice(0, nPost);
  const fitModel = (x, y) => (model === 'ratio' ? ratioModel(x, y) : ols(x, y));
  let r0 = fitModel(cb, vb);
  const predict = r0.predict;
  const fit = model === 'ratio' ? { ratio: r0.ratio } : { a: r0.a, b: r0.b, r2: r0.r2 };

  // 2) Baseline residuals + unbiased σ̂ over (nBase − p) d.o.f. (in-sample residuals are
  //    too small; the d.o.f. correction restores the right noise scale).
  const p = model === 'ratio' ? 1 : 2;
  // Guard: nBase >= 3 (checked above) and p <= 2, so dof >= 1 always.  No Math.max needed.
  if (nBase <= p) return { ok: false, reason: `baseline too short for ${model} model (need > ${p} periods)`, model, fit: {}, counterfactual: [], observed: [], pointwise: [], cumulativeLift: 0, relLift: 0, ci: [0, 0], pValue: 1, significant: false };
  const baseResiduals = vb.map((v, i) => v - predict(cb[i]));
  const rMean = mean(baseResiduals);
  const dof = nBase - p;                                   // unbiased d.o.f. (no Math.max clamp)
  const ssr = baseResiduals.reduce((s, e) => s + (e - rMean) ** 2, 0);
  const sigma = Math.sqrt(ssr / dof);                      // unbiased residual std
  // Guard: a zero-variance baseline (perfectly collinear or all-identical series) gives a
  // degenerate null distribution where every bootstrap cumulative is 0.  Any non-zero post
  // lift then yields pValue ≈ 1/(reps+1) — a guaranteed false positive.  Fail closed.
  if (!Number.isFinite(sigma) || sigma <= 0) return { ok: false, reason: 'zero/non-finite residual variance in baseline — cannot bootstrap a valid null distribution; extend/clean the baseline', model, fit, counterfactual: [], observed: [], pointwise: [], cumulativeLift: 0, relLift: 0, ci: [0, 0], pValue: 1, significant: false };
  const blockSize = Math.max(1, opts.blockSize || Math.round(Math.sqrt(nBase)));
  // d.o.f.-rescaled, centered residual pool to draw fresh noise from (keeps empirical shape).
  // Scale factor sqrt(nBase/dof) corrects the downward bias of in-sample centered residuals
  // (which have empirical variance ssr/nBase, not ssr/dof).  Equivalent to sigma/biasedSd but
  // expressed purely as the d.o.f. correction to avoid reusing the biased denominator.
  const dofScale = Math.sqrt(nBase / dof);
  const resid = sigma > 0 && ssr > 0
    ? baseResiduals.map((e) => (e - rMean) * dofScale)
    : baseResiduals.map(() => 0);

  // 3) Counterfactual over the post window + pointwise/cumulative observed lift.
  const counterfactual = cp.map(predict);
  const observed = variantPost.slice(0, nPost);
  const pointwise = observed.map((v, i) => v - counterfactual[i]);
  const cumulativeLift = pointwise.reduce((s, v) => s + v, 0);
  const cfSum = counterfactual.reduce((s, v) => s + v, 0);
  const relLift = cfSum !== 0 ? cumulativeLift / cfSum : 0;

  // 4) Bootstrap the null cumulative lift. Under H0 (no effect) the observed cumulative gap
  //    is pure prediction error, whose two sources are (a) irreducible post-window NOISE and
  //    (b) PARAMETER uncertainty (the slope/intercept were estimated from finite baseline
  //    data — an in-sample-residual-only null misses this and inflates false positives ~5×).
  //    For OLS the parameter term is the standard prediction-leverage variance
  //    var(ŷ*) = σ²·(1/n + (x*−x̄)²/Sxx), and the cumulative across the post window also
  //    carries the slope-covariance cross-terms — captured by drawing ONE shared (â,b̂)
  //    perturbation per rep from σ̂·N(0, (XᵀX)⁻¹). Noise is block-resampled from the
  //    empirical residuals (preserves short-run autocorrelation); the ratio model carries
  //    only the noise term plus its single-parameter scale uncertainty.
  const drawBlock = (n) => { const out = []; while (out.length < n) { const start = (rng() * Math.max(1, resid.length - blockSize + 1)) | 0; for (let k = 0; k < blockSize && out.length < n; k++) out.push(resid[(start + k) % resid.length]); } return out; };
  const gauss = () => { const u = Math.max(rng(), 1e-12), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let mx = 0, sxx = 0;
  if (model !== 'ratio') { mx = mean(cb); for (const x of cb) sxx += (x - mx) ** 2; }
  const cbSum = cb.reduce((s, v) => s + v, 0);
  const nullCumulatives = [];
  for (let r = 0; r < reps; r++) {
    // (a) post-window noise.
    const postNoise = drawBlock(nPost);
    let sum = postNoise.reduce((s, v) => s + v, 0);
    // (b) one coherent parameter perturbation per rep, applied to the WHOLE post window.
    if (model === 'ratio') {
      const seRatio = cbSum > 0 ? sigma * Math.sqrt(nBase) / cbSum : 0; // var(ratio)≈σ²·n/(Σx)²
      const dRatio = seRatio * gauss();
      for (let i = 0; i < nPost; i++) sum += dRatio * cp[i];
    } else {
      // In the centered parameterization ŷ* = (ȳ) + b̂·(x*−x̄), the two estimators are
      // INDEPENDENT: var(mean) = σ²/n and var(slope) = σ²/Sxx. Perturb each once per rep
      // and apply the slope to CENTERED control values (the intercept carries the mean).
      const seMean = sigma / Math.sqrt(nBase);
      const seB = sxx > 0 ? sigma / Math.sqrt(sxx) : 0;
      const dMean = seMean * gauss(), dB = seB * gauss();
      for (let i = 0; i < nPost; i++) sum += dMean + dB * (cp[i] - mx);
    }
    nullCumulatives.push(sum);
  }
  nullCumulatives.sort((a, b) => a - b);

  // CI on the effect = observed cumulative lift ± the null spread (centered at the null mean).
  const nullMean = mean(nullCumulatives);
  const loQ = quantile(nullCumulatives, alpha / 2) - nullMean;
  const hiQ = quantile(nullCumulatives, 1 - alpha / 2) - nullMean;
  const ci = [cumulativeLift + loQ, cumulativeLift + hiQ];

  // Two-sided p: how often does |null| exceed |observed effect|? (effect = lift − nullMean)
  const effect = cumulativeLift - nullMean;
  let extreme = 0;
  for (const v of nullCumulatives) if (Math.abs(v - nullMean) >= Math.abs(effect)) extreme++;
  const pValue = (extreme + 1) / (nullCumulatives.length + 1);

  return {
    ok: true, model, fit,
    counterfactual, observed, pointwise,
    cumulativeLift, relLift, ci, pValue, significant: pValue < alpha,
    // direction + a normal-approx z for callers that want one (parity with significance.mjs)
    direction: cumulativeLift > 0 ? 'up' : cumulativeLift < 0 ? 'down' : 'flat',
    z: zFromNull(effect, nullCumulatives, nullMean),
  };
}

/** Normal-approx z of the observed effect against the bootstrapped null SD (for reporting). */
function zFromNull(effect, nullDist, nullMean) {
  const n = nullDist.length;
  if (n < 2) return 0;
  let v = 0; for (const x of nullDist) v += (x - nullMean) ** 2;
  const sd = Math.sqrt(v / (n - 1));
  return sd === 0 ? 0 : effect / sd;
}

/** Convenience: two-sided p from a z using the shared normalCdf (kept consistent with the controller). */
export function pFromZ(z) { return 2 * (1 - normalCdf(Math.abs(z))); }
