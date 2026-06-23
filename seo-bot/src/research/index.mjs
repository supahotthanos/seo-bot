// seo-bot · research/index — CLI-facing helpers that wire acquisition (fetcher)
// to credibility (scorer). Demonstrates the invariant end to end: a scraped post
// is a CLAIM that must earn its way to a rule PROPOSAL — and a human still edits rules.

import { fetchTweet, fetchRss, fetchSmart } from './fetcher.mjs';
import { routeProposal } from './credibility.mjs';

export async function researchFetch(target, { log = () => {} } = {}) {
  let r;
  if (/^\d{6,}$/.test(target) || /x\.com|twitter\.com/.test(target)) r = await fetchTweet(target);
  else if (/\.(xml|rss)(\?|$)|\/feed\/?$/.test(target)) r = await fetchRss(target);
  else r = await fetchSmart(target);
  log(JSON.stringify(r, null, 2));
  return r;
}

function printRoute(route, log) {
  const eligible = route.bucket === 'auto_apply' || route.bucket === 'human_review';
  log(`\n  CREDIBILITY: ${route.score.toFixed(2)}  →  ${route.bucket.toUpperCase()}`);
  log(`    source tier : ${route.sourceTier} (${route.sourceWeight})${route.sourceName ? ` — ${route.sourceName}` : ''}`);
  log(`    evidence    : ${route.evidenceStrength} (${route.evidenceWeight})`);
  log(`    independent corroborators: ${route.independentCorroborators.length} (strong: ${route.strongIndependentCorroborators})`);
  if (route.redFlags.length) log(`    red flags   : ${route.redFlags.join(', ')}`);
  if (route.veto) log(`    ⚠ contradicts Google May-2026 veto list`);
  log(`    reasons     : ${route.reasons.join(' | ')}`);
  if (route.veto) log(`    → FLAGGED: contradicts Google's own guidance — surface to a human to REJECT; never adopt.`);
  else if (eligible) log(`    → eligible to be PROPOSED as a rule change (a human still edits rules.mjs).`);
  else log(`    → NOT eligible to change a rule on its own — needs independent corroboration.`);
  log('');
}

/** Fetch a tweet and score it as a claim — the full scrape→claim→bucket demo. */
export async function researchScoreTweet(id, { log = () => {} } = {}) {
  const t = await fetchTweet(id);
  if (!t.ok) { log(`fetch failed: ${JSON.stringify(t.notes)}`); return t; }
  log(`\n  @${t.user.screenName} (${t.user.name}${t.user.verified ? ' ✓' : ''}), ${t.createdAt}`);
  log(`  "${(t.text || '').replace(/\s+/g, ' ').slice(0, 240)}"`);
  const route = routeProposal({ text: t.text, sourceKey: t.sourceKey, url: t.url, sourceIdentified: true, corroborators: [] });
  printRoute(route, log);
  return { tweet: t, route };
}

/** Score an arbitrary claim string. --source x:@handle|domain, --traced, --corroborators a,b */
export async function researchScore(text, opts = {}, { log = () => {} } = {}) {
  const route = routeProposal({
    text, sourceKey: opts.source || 'unknown', sourceIdentified: !!opts.source,
    tracedToPrimary: !!opts.traced,
    corroborators: (opts.corroborators || []).map(c => ({ rootKey: c, tier: opts.corroboratorTier || 'LARGE_N_INDEP' })),
  });
  log(`  claim: "${text.slice(0, 160)}"  [source: ${opts.source || 'unknown'}]`);
  printRoute(route, log);
  return route;
}
