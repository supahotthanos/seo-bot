// seo-bot · index-discipline — the safety rail for programmatic/directory pages. A page
// generator that indexes its whole thin tail earns the sitewide scaled-content-abuse
// demotion it was trying to avoid. This decides, per page: INDEX (meets real-data
// thresholds), NOINDEX (thin — no unique data / too few listings / no reviews), 301
// (zero-engagement + stale → consolidate), or WAIT (a Google core update is rolling out —
// freeze net-new indexing, per updates.mjs). The decider is pure + unit-tested; the page
// generator (P0) calls it on every row before publish.

const DEFAULTS = { minListings: 3, minWords: 250, minReviews: 1, staleDays: 180 };

/**
 * Decide the index action for ONE page from its real-data facts.
 * facts: { url, hasUniqueData, listings, reviews, words, clicks90d, ageDays, coreUpdateActive }
 * Any unknown numeric field is treated as "unknown" (doesn't force thin on its own).
 */
export function decideIndex(facts = {}, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { url = '', hasUniqueData = false, listings = null, reviews = null, words = null, clicks90d = null, ageDays = null, coreUpdateActive = false } = facts;

  // 1) Thin → noindex. Thin = no unique data AND (too few listings OR too little content) AND no reviews.
  const fewListings = listings != null ? listings < o.minListings : false;
  const thinContent = words != null ? words < o.minWords : false;
  const noReviews = reviews != null ? reviews < o.minReviews : true;
  const sparse = listings != null ? fewListings : thinContent; // prefer the directory signal (listings) when present
  if (!hasUniqueData && sparse && noReviews) {
    return { url, action: 'noindex', reason: `thin: ${listings != null ? listings + ' listings' : (words ?? '?') + ' words'}, ${reviews ?? 0} reviews, no unique data` };
  }
  // 2) Zero-engagement + stale → 301 consolidate.
  if (clicks90d === 0 && ageDays != null && ageDays > o.staleDays) {
    return { url, action: '301', reason: `0 clicks in 90d, ${ageDays}d old → consolidate/redirect to the parent` };
  }
  // 3) Core update active → hold net-new index/publish changes (don't add pages mid-rollout).
  if (coreUpdateActive) {
    return { url, action: 'wait', reason: 'Google core/spam update rolling out — freeze net-new indexing (updates.mjs)' };
  }
  // 4) Meets thresholds → index.
  return { url, action: 'index', reason: hasUniqueData ? 'has unique data' : `meets thresholds (${listings ?? '?'} listings, ${reviews ?? '?'} reviews)` };
}

/** Classify a batch of page-facts. Pulls the live core-update state once. */
export async function indexDiscipline(pages = [], { log = () => {}, opts = {} } = {}) {
  let coreUpdateActive = false;
  try { const { googleUpdates } = await import('./updates.mjs'); coreUpdateActive = (await googleUpdates({ log: () => {} })).coreUpdateActive; } catch { /* best effort */ }
  const decisions = pages.map((p) => decideIndex({ ...p, coreUpdateActive }, opts));
  const by = decisions.reduce((m, d) => { m[d.action] = (m[d.action] || 0) + 1; return m; }, {});
  log(`  Index-discipline: ${decisions.length} pages → index ${by.index || 0} · noindex ${by.noindex || 0} · 301 ${by['301'] || 0} · wait ${by.wait || 0}${coreUpdateActive ? ' (CORE UPDATE — holding)' : ''}`);
  return { decisions, summary: by, coreUpdateActive };
}
