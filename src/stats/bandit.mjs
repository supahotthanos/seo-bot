// seo-bot · stats/bandit — Beta-Bernoulli Thompson sampler for title/meta A/B arms.
//
// Each title/meta variant is an arm whose CTR is a Bernoulli proportion (a click is a
// success, an impression is a trial). The conjugate posterior is Beta(α, β) with
//   α = 1 + clicks,  β = 1 + (impressions − clicks)   (Beta(1,1) = uniform prior).
// Thompson sampling draws one CTR sample per arm from its posterior and plays the arm
// with the highest draw — so allocation tracks "probability this arm is best," exploring
// uncertain arms and exploiting confident winners WITHOUT the fixed exploration tax of
// epsilon-greedy. This is how we decide which title/meta variant to serve next, before
// the locked-horizon z-test (significance.mjs) renders the final keep/rollback verdict.
//
// Pure functions, no I/O, no deps. Sampling uses Math.random (Date.now-free); pass a
// seeded rng for reproducible tests. The same Beta machinery feeds bandit allocation AND
// posterior-probability summaries (probabilityBest) for reporting.

/** Standard Gamma(k≥0, θ=1) sampler (Marsaglia-Tsang). Used to build Beta draws. */
function sampleGamma(k, rng) {
  if (k <= 0) return 0;
  if (k < 1) {
    // Boost: Gamma(k) = Gamma(k+1) · U^(1/k)  (Stuart's theorem) to keep MT valid.
    return sampleGamma(k + 1, rng) * Math.pow(rng(), 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do {
      // Box-Muller standard normal from two uniforms.
      const u1 = Math.max(rng(), 1e-12), u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(rng(), 1e-12);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Draw one sample from Beta(α, β) via two Gammas: Beta = Ga(α) / (Ga(α)+Ga(β)). */
export function sampleBeta(alpha, beta, rng = Math.random) {
  const a = sampleGamma(alpha, rng);
  const b = sampleGamma(beta, rng);
  return a + b === 0 ? 0.5 : a / (a + b);
}

/** @typedef {{id:string, clicks:number, impr:number, alpha?:number, beta?:number}} Arm */

/** Beta(α,β) posterior for one arm. clicks=successes, impr=trials. Floors counts at 0. */
export function posterior(arm) {
  const clicks = Math.max(0, arm?.clicks || 0);
  const impr = Math.max(clicks, arm?.impr || 0); // impressions can't be below clicks
  const alpha = (arm?.alpha ?? 1) + clicks;
  const beta = (arm?.beta ?? 1) + (impr - clicks);
  return { alpha, beta, mean: alpha / (alpha + beta), n: impr };
}

/** Posterior mean CTR for an arm (the point estimate; use CIs for decisions). */
export function posteriorMeanCtr(arm) {
  return posterior(arm).mean;
}

/**
 * Update an arm's observed counts with a fresh GSC reading (immutable; returns a new arm).
 * Counts are CUMULATIVE totals from GSC for the variant window, so we SET (not add) —
 * GSC already aggregates. Pass {addClicks, addImpr} only if you're streaming deltas.
 * @param {Arm} arm
 * @param {{clicks?:number, impr?:number, addClicks?:number, addImpr?:number}} obs
 * @returns {Arm}
 */
export function updatePosterior(arm, obs = {}) {
  const base = { ...arm };
  if (obs.addClicks != null || obs.addImpr != null) {
    base.clicks = Math.max(0, (arm?.clicks || 0) + (obs.addClicks || 0));
    base.impr = Math.max(base.clicks, (arm?.impr || 0) + (obs.addImpr || 0));
  } else {
    if (obs.clicks != null) base.clicks = Math.max(0, obs.clicks);
    if (obs.impr != null) base.impr = Math.max(base.clicks ?? 0, obs.impr);
  }
  return base;
}

/**
 * Thompson sample: draw one CTR from each arm's posterior, return the winning arm.
 * @param {Arm[]} arms
 * @param {{rng?:Function}} opts
 * @returns {{arm:Arm, index:number, draws:number[], draw:number}}
 */
export function sampleArm(arms, { rng = Math.random } = {}) {
  if (!Array.isArray(arms) || !arms.length) return { arm: null, index: -1, draws: [], draw: 0 };
  const draws = arms.map((a) => { const p = posterior(a); return sampleBeta(p.alpha, p.beta, rng); });
  let best = 0;
  for (let i = 1; i < draws.length; i++) if (draws[i] > draws[best]) best = i;
  return { arm: arms[best], index: best, draws, draw: draws[best] };
}

/**
 * Monte-Carlo estimate of P(arm is best) for each arm — the allocation weights a
 * Thompson sampler converges to, and a clean "how sure are we?" report for the loop.
 * @param {Arm[]} arms
 * @param {{reps?:number, rng?:Function}} opts
 * @returns {Array<{id:string, pBest:number, meanCtr:number, n:number}>}
 */
export function probabilityBest(arms, { reps = 4000, rng = Math.random } = {}) {
  if (!Array.isArray(arms) || !arms.length) return [];
  const post = arms.map(posterior);
  const wins = new Array(arms.length).fill(0);
  for (let r = 0; r < reps; r++) {
    let best = 0, bestDraw = -1;
    for (let i = 0; i < post.length; i++) {
      const d = sampleBeta(post[i].alpha, post[i].beta, rng);
      if (d > bestDraw) { bestDraw = d; best = i; }
    }
    wins[best]++;
  }
  return arms.map((a, i) => ({ id: a.id ?? String(i), pBest: wins[i] / reps, meanCtr: post[i].mean, n: post[i].n }));
}

/**
 * Allocate the next N impression-slots across arms by Thompson sampling (one draw per
 * slot). Returns a count per arm — the recommended traffic split for the next window.
 * @param {Arm[]} arms
 * @param {{slots?:number, rng?:Function}} opts
 * @returns {Array<{id:string, slots:number, share:number}>}
 */
export function allocate(arms, { slots = 100, rng = Math.random } = {}) {
  if (!Array.isArray(arms) || !arms.length) return [];
  const counts = new Array(arms.length).fill(0);
  for (let s = 0; s < slots; s++) counts[sampleArm(arms, { rng }).index]++;
  return arms.map((a, i) => ({ id: a.id ?? String(i), slots: counts[i], share: counts[i] / slots }));
}
