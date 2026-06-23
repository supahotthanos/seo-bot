#!/usr/bin/env node
// seo-bot · test suite — institutionalizes the correctness invariants the verifier and
// manual runs have been checking ad hoc, so regressions are caught automatically.
// Pure node, no deps:  node seo-bot/test/run.mjs   (exit 1 on any failure)

import { scoreContent } from '../src/content/gates.mjs';
import { twoProportionZTest, minSampleForProportion, bhReject, differenceInDifferences } from '../src/stats/significance.mjs';
import { decideChange } from '../src/stats/feedback.mjs';
import { routeProposal, classifySource } from '../src/research/credibility.mjs';
import { actionable } from '../src/tactics/registry.mjs';
import { loadConfig, listConfigs, buildConfig } from '../src/config.mjs';
import { parseRobots } from '../src/crawl.mjs';
import { parsePage, auditPage } from '../src/rules.mjs';
import { CITATION_TARGETS } from '../src/listings/targets.mjs';

let pass = 0, fail = 0;
const out = [];
const check = (name, cond) => { if (cond) { pass++; out.push(`  ✓ ${name}`); } else { fail++; out.push(`  ✗ ${name}`); } };
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

// ---- content gates: slop is rejected, real copy passes, "Dr." reviewer accepted ----
const slop = 'Morpheus8 is the best with guaranteed results! Costs $950, works 100% of the time. 45000 patients. https://www.healthline.com/x';
const slopR = scoreContent(slop, {});
check('gates: slop draft scores 0', slopR.score === 0);
check('gates: slop fails hard gates', slopR.hardPass === false && slopR.hardFails.includes('no-fabrication'));

const goodBrief = { title: 'Morpheus8 in Aventura', targetQuery: 'morpheus8 in aventura', city: 'Aventura', author: { name: 'Dr. Jane Doe', role: 'MD' }, dataPoints: ['$700 to $1500 per session', 'series of 3 treatments', '4 to 6 weeks apart', '53.6% facial revenue share'], primarySources: ['https://www.fda.gov', 'https://pubmed.ncbi.nlm.nih.gov/31234567/'], schemaTypes: ['MedicalBusiness', 'Service'], hasOwnMedia: true, internalLinks: 3 };
const goodDraft = `## What does Morpheus8 in Aventura cost, and how many sessions?

Morpheus8 in Aventura typically costs $700 to $1500 per session, and most skin-tightening plans
run as a series of 3 treatments spaced 4 to 6 weeks apart. The number depends on the area.

Morpheus8 is FDA-cleared RF microneedling ([FDA](https://www.fda.gov)). A peer-reviewed overview
is on [PubMed](https://pubmed.ncbi.nlm.nih.gov/31234567/). Facial treatments hold a 53.6% revenue
share. Many Aventura patients pair Morpheus8 with a HydraFacial between sessions in Aventura.

[Aventura pricing](/aventura) · [Book](/book)

Medically reviewed by Dr. Jane Doe, MD. Last reviewed June 2026.`;
const goodR = scoreContent(goodDraft, goodBrief, { priorTexts: [] });
check('gates: real cited draft passes all hard gates', goodR.hardPass === true);
check('gates: "Dr. Jane Doe, MD" reviewer line accepted (regex fix)', goodR.hard['medical-reviewer'] === true);
check('gates: PubMed-cited draft has 0 unsourced numbers (URL-strip fix)', goodR.stats.unsourcedNumbers === 0);
check('gates: real draft is publish-eligible (>=80)', goodR.publishEligible === true);
check('gates: intent-match rubric beats keyword-stuffing (real cost page > stuffed query)',
  scoreContent('## How much does Botox cost in Aventura?\n\nBotox in Aventura typically costs $12 to $16 per unit, $200 to $400 per session.', { targetQuery: 'botox cost aventura' }).components['intent-match']
  > scoreContent('botox cost aventura botox cost aventura botox cost aventura filler text here', { targetQuery: 'botox cost aventura' }).components['intent-match']);

// ---- significance ----
const z = twoProportionZTest(100, 1000, 130, 1000);
check('stats: 10% vs 13% CTR is significant (p~0.0355)', z.significant && near(z.pValue, 0.0355, 0.005));
check('stats: 10% vs 10.8% is NOT significant', !twoProportionZTest(100, 1000, 108, 1000).significant);
check('stats: min sample for 10%->11% lift ~14751/arm', Math.abs(minSampleForProportion(0.10, 0.10) - 14751) < 50);
const rej = bhReject([0.001, 0.04, 0.8], 0.05);
check('stats: BH-FDR rejects the tiny+small p, keeps the large', rej[0] === true && rej[2] === false);
const did = differenceInDifferences({ clicks: 100, impressions: 1000 }, { clicks: 130, impressions: 1000 }, { clicks: 100, impressions: 1000 }, { clicks: 115, impressions: 1000 });
check('stats: DiD subtracts the market move', near(did.didCtr, 0.015, 0.001));

// ---- decision controller ----
const big = { before: { clicks: 100, impressions: 2000 }, after: { clicks: 160, impressions: 2000 }, days: 28 };
check('decide: clear significant win -> keep', decideChange(big).decision === 'keep');
check('decide: noise -> try-next', decideChange({ before: { clicks: 100, impressions: 2000 }, after: { clicks: 104, impressions: 2000 }, days: 28 }).decision === 'try-next');
check('decide: significant regression -> revert', decideChange({ before: { clicks: 100, impressions: 2000 }, after: { clicks: 60, impressions: 2000 }, days: 28 }).decision === 'revert');
check('decide: CTR win but conversions tank -> revert (guardrail)', decideChange({ ...big, guardrail: { before: { conversions: 80, sessions: 1000 }, after: { conversions: 40, sessions: 1000 } } }).decision === 'revert');
check('decide: locked horizon in future -> insufficient-data (no peeking)', decideChange({ ...big, opts: { lockedHorizonDate: '2099-01-01', nowMs: Date.parse('2026-06-21') } }).decision === 'insufficient-data');
check('decide: thin data -> insufficient-data', decideChange({ before: { clicks: 5, impressions: 50 }, after: { clicks: 8, impressions: 60 }, days: 5 }).decision === 'insufficient-data');

// ---- credibility / quarantine ----
const chou = routeProposal({ text: 'BrowserBlast ranks you in 48 hours guaranteed', sourceKey: 'jackychou.com', sourceIdentified: true });
check('credibility: Jacky Chou claim quarantined -> discard', chou.bucket === 'discard' && chou.score < 0.2);
const veto = routeProposal({ text: 'Add an llms.txt file to boost AI visibility', sourceKey: 'x:@authorityhacker', sourceIdentified: true });
check('credibility: veto-list claim (llms.txt) -> human_review + veto flag', veto.bucket === 'human_review' && veto.veto === true);
const gabe = routeProposal({ text: 'Google detects AI spam', sourceKey: 'x:@glenngabe', sourceIdentified: true, corroborators: [] });
check('credibility: lone practitioner tweet -> not auto/human (discard/watch)', gabe.bucket === 'discard' || gabe.bucket === 'watch');

// ---- tactics: illegal hard-excluded even when opted in ----
const act = actionable({ tacticsOptIn: ['programmatic-seo', 'fake-reviews'] }).map((t) => t.id);
check('tactics: fake-reviews excluded despite opt-in', !act.includes('fake-reviews'));
check('tactics: opted-in grey lever IS actionable', act.includes('programmatic-seo'));
check('tactics: white-hat auto levers present', act.includes('server-rendered') && act.includes('answer-first'));
// New AEO plays from the 13-operator pioneer recon:
const act2 = actionable({ tacticsOptIn: ['aeo-city-listicle'] }).map((t) => t.id);
check('tactics: AEO source-cluster recon is auto-actionable', act2.includes('aeo-source-cluster-map') && act2.includes('aeo-bing-first'));
check('tactics: opted-in city-listicle lever IS actionable', act2.includes('aeo-city-listicle'));
check('tactics: AEO prompt-injection is NEVER actionable (do-not-automate)', !act2.includes('aeo-prompt-injection'));
check('tactics: reddit-account-farming hard-excluded even if opted in', !actionable({ tacticsOptIn: ['reddit-account-farming'] }).map((t) => t.id).includes('reddit-account-farming'));

// ---- crawl: robots parsing (AI-crawler blocks + sitemaps) ----
const robots = parseRobots('User-agent: GPTBot\nDisallow: /\nUser-agent: *\nDisallow:\nSitemap: https://x.com/sitemap.xml');
check('crawl: robots detects a blocked AI crawler (GPTBot)', robots.blockedAICrawlers.includes('GPTBot'));
check('crawl: robots parses the Sitemap directive', robots.sitemaps.includes('https://x.com/sitemap.xml'));

// ---- rules: parse + audit a synthetic page ----
const cfgX = buildConfig({ domain: 'examplemedspa.com' });
check('config: buildConfig produces a valid config from a domain', cfgX.baseUrl === 'https://examplemedspa.com' && !!cfgX.name);
const pp = parsePage('<html lang="en"><head><title>Botox in Miami</title><script type="application/ld+json">{"@type":"MedicalBusiness"}</script></head><body><h1>Botox</h1><p>' + 'word '.repeat(400) + '</p></body></html>', 'https://examplemedspa.com/p', cfgX);
check('rules: parsePage extracts title', pp.title === 'Botox in Miami');
check('rules: parsePage collects JSON-LD types', pp.jsonLdTypes.map((t) => t.toLowerCase()).includes('medicalbusiness'));
const auditNoTitle = auditPage({ url: 'https://examplemedspa.com/x', ok: true, status: 200, html: '<html><body><p>' + 'word '.repeat(400) + '</p></body></html>' }, cfgX);
check('rules: a page with no <title> flags a critical title finding', auditNoTitle.findings.some((f) => f.rule === 'title' && f.severity === 'critical'));

// ---- listings: tier-1 entity graph present ----
const t1 = CITATION_TARGETS.filter((t) => t.tier === 1).map((t) => t.id);
check('listings: tier-1 entity graph = GBP + Apple Business + Bing Places', t1.includes('gbp') && t1.includes('apple-business') && t1.includes('bing-places'));

// ---- credibility: source classification (white-hat vs adversarial quarantine) ----
check('credibility: Edward Sturm is NAMED_PRACTITIONER (white-hat, not quarantined)', classifySource('edwardsturm.com').tier === 'NAMED_PRACTITIONER');
check('credibility: Jacky Chou is ADVERSARIAL_SIGNAL (quarantined)', classifySource('jackychou.com').tier === 'ADVERSARIAL_SIGNAL');

// ---- gates: disallowed source (Healthline) fails primary-citations ----
const disBrief = { dataPoints: ['$5 a', 'b', 'c'], author: { name: 'X', role: 'MD' }, primarySources: ['https://www.fda.gov'], city: 'Miami', targetQuery: 't', schemaTypes: ['Article', 'FAQPage'] };
const disDraft = 'Medically reviewed by Dr. X, MD. Last reviewed June 2026. [a](https://www.healthline.com/x) [b](https://www.fda.gov) [c](https://www.fda.gov/y)';
check('gates: a Healthline citation fails the primary-citations gate', scoreContent(disDraft, disBrief).hard['primary-citations'] === false);

// ---- geogrid: deterministic grid + scoring math ----
const { buildGrid, scoreGrid } = await import('../src/geogrid.mjs');
const gg = buildGrid(40.0, -75.0, 5, 3);
check('geogrid: 5x5 builds 25 pins', gg.length === 25);
check('geogrid: center pin is the input lat/lng', gg.some((p) => p.row === 2 && p.col === 2 && near(p.lat, 40.0, 1e-6) && near(p.lng, -75.0, 1e-6)));
check('geogrid: corners are offset from center', !near(gg[0].lat, 40.0, 1e-6) && !near(gg[0].lng, -75.0, 1e-6));
const gs = scoreGrid([{ rank: 1 }, { rank: 2 }, { rank: 8 }, { rank: null }]);
check('geogrid: SoLV = % pins in top 3', gs.solv === 50);
check('geogrid: ATRP buckets unranked at 21', near(gs.atrp, (1 + 2 + 8 + 21) / 4, 0.05));

// ---- serp: deterministic Share-of-Voice + CTR weighting ----
const { shareOfVoice, ctrWeight } = await import('../src/serp.mjs');
check('serp: all-#1 SoV = 100%', shareOfVoice([1, 1, 1]) === 100);
check('serp: unranked contributes 0 to SoV', shareOfVoice([1, 99]) === 50);
check('serp: CTR weight is monotonic decreasing', ctrWeight(1) > ctrWeight(2) && ctrWeight(2) > ctrWeight(10) && ctrWeight(11) === 0);

// ---- locations: back-compat synthesis + doorway guard + brief fan-out ----
const { listLocations, auditLocations, locationPageBriefs } = await import('../src/locations.mjs');
const single = listLocations({ brand: 'X', listings: { canonicalNap: { name: 'X', street: '1 A St', city: 'Miami', state: 'FL', zip: '33101', phone: '305-555-1212' } } });
check('locations: synthesizes one location from legacy fields', single.length === 1 && single[0].nap.city === 'Miami');
const multiCfg = { name: '_t', brand: 'X', locations: [{ name: 'A', nap: { city: 'Miami', state: 'FL' } }, { name: 'B', nap: { city: 'Miami', state: 'FL' } }], services: ['botox', 'filler'] };
check('locations: per-location×service briefs = locs×services', locationPageBriefs(multiCfg).length === 4);
const aud = auditLocations(multiCfg, { log: () => {} });
check('locations: duplicate-city + no-unique multi-location flags doorway risk', aud.doorwayRisk === true);

// ---- integrity: anti-fabricated-authority + small-n + irreversible guards ----
const { verifyReviewer, confidenceGate, guardIrreversible, coverageHonesty } = await import('../src/integrity.mjs');
const rvText = 'Medically reviewed by Dr. Jane Doe, MD. Last reviewed June 2026.';
check('integrity: byline in registry verifies', verifyReviewer(rvText, [{ name: 'Jane Doe', credentials: 'MD' }]).verified === true);
check('integrity: byline NOT in registry is flagged (fabricated authority)', verifyReviewer(rvText, [{ name: 'John Smith' }]).verified === false);
check('integrity: no registry → unverified (null), not blocked', verifyReviewer(rvText, []).verified === null);
check('integrity: a fake byline FAILS the medical-reviewer gate when a registry is set', scoreContent(goodDraft, goodBrief, { reviewers: [{ name: 'Someone Else' }] }).hard['medical-reviewer'] === false);
check('integrity: a real reviewer still passes the gate', scoreContent(goodDraft, goodBrief, { reviewers: [{ name: 'Jane Doe', credentials: 'MD' }] }).hard['medical-reviewer'] === true);
check('integrity: small-n number is suppressed from client', confidenceGate(0.42, 8, { minN: 14 }).show === false);
check('integrity: sufficient-n number is shown', confidenceGate(0.42, 30, { minN: 14 }).show === true);
check('integrity: a 301 is blocked without confirm + snapshot', guardIrreversible('301-redirect', { confirm: false }).blocked === true);
check('integrity: a 301 proceeds with confirm + snapshot', guardIrreversible('301-redirect', { confirm: true, hasSnapshot: true }).allowed === true);
check('integrity: "no issues" honesty downgrades on raw-only partial coverage', coverageHonesty({ checked: 5, total: 30, rendered: false }).complete === false);
// Adversarial regressions (verifier-found): substring/superset impostors must NOT verify.
check('integrity: substring impostor "Charlie Leeson" vs registry "Lee" is rejected', verifyReviewer('Medically reviewed by Charlie Leeson, MD.', [{ name: 'Lee' }]).verified === false);
check('integrity: superset impostor "Jane Doe Aesthetics Team" is rejected (non-person)', verifyReviewer('Medically reviewed by the Jane Doe Aesthetics Team, MD.', [{ name: 'Jane Doe' }]).verified === false);
check('integrity: middle-initial "Jane Q. Doe" still verifies vs "Jane Doe"', verifyReviewer('Medically reviewed by Dr. Jane Q. Doe, MD. Last reviewed June 2026.', [{ name: 'Jane Doe' }]).verified === true);
check('integrity: non-person "our content team" rejected even with no registry', verifyReviewer('Medically reviewed by our content team, MD.', []).verified === false);
check('integrity: confidenceGate fails CLOSED on Infinity', confidenceGate(0.42, Infinity, { minN: 14 }).show === false);
check('integrity: coverageHonesty never reports >100%', coverageHonesty({ checked: 50, total: 30, rendered: true }).coveragePct <= 100);
// No content template may emit a deprecated rich-result schema type.
const { CONTENT_TEMPLATES } = await import('../src/content/templates.mjs');
const DEAD = new Set(['FAQPage', 'HowTo', 'QAPage']);
check('content: no template emits a deprecated rich schema type', Object.values(CONTENT_TEMPLATES).every((t) => (t.schemaTypes || []).every((s) => !DEAD.has(s))));

// ---- content-decay scorer (pure, deterministic) ----
const { scoreDecay } = await import('../src/content/decay.mjs');
const dR = [{ keys: ['/botox-aventura'], clicks: 10, impressions: 500, position: 8 }, { keys: ['/about'], clicks: 90, impressions: 300 }, { keys: ['/new'], clicks: 5, impressions: 50 }];
const dP = [{ keys: ['/botox-aventura'], clicks: 50, impressions: 600 }, { keys: ['/about'], clicks: 100, impressions: 300 }];
const decayed = scoreDecay(dR, dP);
check('decay: flags the 80%-drop money page', decayed.some((d) => d.page === '/botox-aventura' && d.dropPct === 80));
check('decay: excludes the <20%-drop page', !decayed.some((d) => d.page === '/about'));
check('decay: excludes low-impression page (<100 impr)', !decayed.some((d) => d.page === '/new'));
check('decay: money page ranks first by severity', decayed[0].page === '/botox-aventura');

// ---- index-discipline decider (pure) ----
const { decideIndex } = await import('../src/index-discipline.mjs');
check('index: thin page (0 listings/reviews, no data) → noindex', decideIndex({ url: '/x', hasUniqueData: false, listings: 0, reviews: 0 }).action === 'noindex');
check('index: rich page (5 listings, 3 reviews) → index', decideIndex({ url: '/x', listings: 5, reviews: 3 }).action === 'index');
check('index: unique-data page always indexes', decideIndex({ url: '/x', hasUniqueData: true, listings: 0, reviews: 0 }).action === 'index');
check('index: zero-clicks + stale → 301 consolidate', decideIndex({ url: '/x', listings: 5, reviews: 3, clicks90d: 0, ageDays: 365 }).action === '301');
check('index: core update freezes net-new indexing → wait', decideIndex({ url: '/x', listings: 5, reviews: 3, coreUpdateActive: true }).action === 'wait');

// ---- CI gate verdict (pure) ----
const { gateVerdict } = await import('../src/gate.mjs');
check('gate: clean audit passes', gateVerdict({ score: 90, bySeverity: { critical: 0, high: 2 } }, { minScore: 70, maxCritical: 0 }).passed === true);
check('gate: critical over cap fails with exit 10', (() => { const v = gateVerdict({ score: 90, bySeverity: { critical: 3 } }, { minScore: 70, maxCritical: 0 }); return v.passed === false && v.exitCode === 10; })());
check('gate: score below floor fails', gateVerdict({ score: 50, bySeverity: {} }, { minScore: 70 }).passed === false);
check('gate: critical regression vs green baseline fails', gateVerdict({ score: 90, bySeverity: { critical: 2 } }, { maxCritical: 5 }, { score: 92, critical: 0 }).passed === false);

// ---- P0 page generator (pure builders) ----
const { buildCityListicle, cityStats } = await import('../src/generate/pages.mjs');
const spaFix = [
  { name: 'A Spa', city: 'Miami', state: 'FL', rating: 5, review_count: 200, address: '1 A St', price_range: '$$', services: ['Botox'] },
  { name: 'B Spa', city: 'Miami', state: 'FL', rating: 4.5, review_count: 50, address: '2 B St' },
  { name: 'C Spa', city: 'Miami', state: 'FL', rating: 4.8, review_count: 500, address: '3 C St' },
];
const lst = buildCityListicle('Miami', 'FL', spaFix);
check('generate: ranks by rating × review volume (C: 4.8×500 beats A: 5×200)', lst.items[0].name === 'C Spa');
check('generate: emits ItemList JSON-LD of MedicalBusiness items', lst.jsonLd['@type'] === 'ItemList' && lst.jsonLd.itemListElement[0].item['@type'] === 'MedicalBusiness');
check('generate: answer capsule carries real city stats', /3 med spas/.test(lst.answerCapsule));
check('generate: cityStats totals real reviews', cityStats(spaFix).totalReviews === 750);
const { buildCityStats } = await import('../src/generate/pages.mjs');
const st = buildCityStats('Miami', 'FL', spaFix);
check('generate: stats page emits Dataset schema + rating bands', st.jsonLd['@type'] === 'Dataset' && st.ratingBands['4.5★+'] === 3);
const { buildComparison } = await import('../src/generate/pages.mjs');
const cmp = buildComparison(spaFix[0], spaFix[2], { city: 'Miami', state: 'FL' });
check('generate: comparison page is factual table + verify disclaimer', /\| Rating \|/.test(cmp.markdown) && /confirm current pricing/.test(cmp.markdown));

// ---- CWV template patch mapper (pure) ----
const { cwvTemplatePatches } = await import('../src/perf/cwv-template.mjs');
const cwvPatches = cwvTemplatePatches({ lcpElement: '<img src="/hero.jpg" class="hero">', opportunities: [{ id: 'render-blocking-resources', title: 'rbr' }, { id: 'modern-image-formats', title: 'fmt' }, { id: 'layout-shift-elements', title: 'cls' }] });
check('cwv-template: preloads the LCP image w/ fetchpriority', cwvPatches.some((p) => p.type === 'head' && /preload.*hero\.jpg.*fetchpriority/.test(p.code)));
check('cwv-template: defers render-blocking JS', cwvPatches.some((p) => /defer/.test(p.code)));
check('cwv-template: maps image-format opp → next/image', cwvPatches.some((p) => /next\/image/.test(p.code)));

// ---- autopilot verifier-consensus (pure tally) + the live-push safety gate ----
const { tallyConsensus, PR_ADAPTERS, parseVerdict } = await import('../src/autopilot.mjs');
check('autopilot: unanimous safe → consensus', tallyConsensus([{ safe: true }, { safe: true }, { safe: true }], { n: 3, threshold: 3 }).consensus === true);
check('autopilot: one dissent → NO consensus (fail-closed)', tallyConsensus([{ safe: true }, { safe: false, reason: 'risky' }, { safe: true }], { n: 3, threshold: 3 }).consensus === false);
check('autopilot: empty votes → no consensus', tallyConsensus([], { n: 3, threshold: 3 }).consensus === false);
// the #1 invariant: never auto-push via a live-overwrite adapter (wordpress) — PR/diff paths only
check('autopilot: push adapters are PR/diff only, NEVER wordpress', !PR_ADAPTERS.has('wordpress') && PR_ADAPTERS.has('nextjs') && PR_ADAPTERS.has('edge'));
check('autopilot: unparseable verifier output → null (caller maps to UNSAFE)', parseVerdict('I think it looks fine to ship') === null);
check('autopilot: parseVerdict reads the safe flag from messy output', parseVerdict('verdict: {"safe":true,"risk":"low"} ok?').safe === true);
check('autopilot: a null/unparseable vote blocks consensus (fail-closed)', tallyConsensus([{ safe: true }, { safe: true }, null], { n: 3, threshold: 3 }).consensus === false);
// edge overlay MERGE: a new run must not drop a prior path's override (cross-run data loss)
const { mergeOverlays } = await import('../src/apply/edge.mjs');
const _m = mergeOverlays({ '/a': { title: 'A', _meta: { ids: ['1'] } } }, { '/b': { title: 'B', _meta: { ids: ['2'] } } });
check('edge: mergeOverlays keeps prior paths (no cross-run data loss)', _m['/a']?.title === 'A' && _m['/b']?.title === 'B');

// ---- daily brief flagging (pure) ----
const { flagChange, buildBrief } = await import('../src/brief.mjs');
check('brief: autopilot change on a /reviews path is flagged', flagChange({ runId: 'autopilot-2026-06-23', url: '/reviews/x', adapter: 'nextjs' }).length > 0);
check('brief: a clean low-risk nextjs change is not flagged', flagChange({ runId: 'autopilot-2026-06-23', url: '/botox-cost-aventura', adapter: 'nextjs', before: 'old' }).length === 0);
check('brief: wordpress live overwrite is flagged', flagChange({ adapter: 'wordpress', url: '/x' }).some((f) => /WordPress/.test(f)));
const bf = buildBrief('demo', [{ ts: '2026-06-23T10:00:00.000Z', url: '/x', field: 'meta', runId: 'autopilot-2026-06-23', adapter: 'nextjs', before: 'a' }]);
check('brief: separates autopilot vs human + renders markdown', bf.autopilot === 1 && /## demo/.test(bf.markdown));

// ---- migration redirect mapper (pure) ----
const { matchUrl, buildRedirectMap } = await import('../src/migrate.mjs');
const cands = [{ path: '/botox-aventura', tokens: ['botox', 'aventura'] }, { path: '/services/fillers', tokens: ['services', 'fillers'] }];
check('migrate: exact path → exact 301', matchUrl('/botox-aventura', cands).confidence === 'exact');
check('migrate: token-similar old URL → high-confidence match', matchUrl('/aventura-botox.html', cands).newPath === '/botox-aventura');
check('migrate: unrelated old URL → flagged for manual', matchUrl('/contact-us-2019', cands).confidence === 'none');
const rm = buildRedirectMap(['https://old.com/botox-aventura', 'https://old.com/random-xyz'], ['https://new.com/botox-aventura', 'https://new.com/services/fillers']);
check('migrate: redirect map separates auto-matched from manual', rm.auto.length === 1 && rm.manual.length === 1);

// ---- policy: aggressive 'push everything' mode (verifier becomes the gate; hard blocks stay) ----
const { decidePolicy } = await import('../src/policy.mjs');
const altFix = { type: 'img-alt', page: 'https://x.com/botox-aventura', severity: 'low', autoApplicable: true };
check('policy: conservative QUEUES a non-meta/title fix', decidePolicy(altFix, { vertical: 'medspa', autopilot: { mode: 'conservative' } }, {}).action === 'queue');
check('policy: aggressive lets a structural fix through (to the verifier)', decidePolicy(altFix, { vertical: 'medspa', autopilot: { mode: 'aggressive' } }, {}).action === 'auto-approve');
check('policy: aggressive STILL hard-blocks a legal-sensitive /reviews path', decidePolicy({ type: 'meta', page: 'https://x.com/reviews', severity: 'low', autoApplicable: true }, { vertical: 'medspa', autopilot: { mode: 'aggressive' } }, {}).action === 'queue');

// ---- per-client prompt discovery (pure templating) ----
const { generatePrompts } = await import('../src/measure/discover.mjs');
const gp = generatePrompts({ brand: 'Glow Spa', services: ['botox', 'filler'], serviceAreaGeos: ['Austin'], competitors: ['Ideal Image'] });
check('discover: brand-intent prompt present', gp.some((p) => /glow spa reviews/i.test(p)));
check('discover: service×city money prompt present', gp.some((p) => /best botox in austin/i.test(p)));
check('discover: cost-intent prompt present', gp.some((p) => /botox cost in austin/i.test(p)));
check('discover: competitor comparison present', gp.some((p) => /glow spa vs ideal image/i.test(p)));
check('discover: no unfilled {placeholders}', gp.every((p) => !/\{.*\}/.test(p)));
const gpNoBrand = generatePrompts({ services: ['botox'], serviceAreaGeos: ['Reno'] });
check('discover: missing brand → no "undefined" prompts', gpNoBrand.length > 0 && gpNoBrand.every((p) => !/undefined|null/i.test(p)));

// ---- ultrareview hardening regressions ----
const { dedupeSpas } = await import('../src/generate/pages.mjs');
const dd = dedupeSpas([
  { name: 'Glow Spa', address: '1 Main St', phone: '111' },
  { name: 'Glow Spa', address: '1 Main St', phone: '' },     // same business, phone missing
  { name: 'Glow Spa', address: '1 Main St', phone: '222' },  // same business, different phone
  { name: 'Other Spa', address: '2 Oak Ave', phone: '333' },
]);
check('dedupe: same name+address collapses regardless of phone (was 452 dupes leaking)', dd.length === 2);
// tallyConsensus imported above (line ~217); test the new fail-closed clamp:
check('consensus: threshold 0 does NOT pass with zero safe votes (fail-closed)', tallyConsensus([{ safe: false }, { safe: false }], { n: 2, threshold: 0 }).consensus === false);

// ---- config integrity ----
check('config: every client config loads + has brand/domain', listConfigs().every((n) => { try { const c = loadConfig(n); return !!(c.brand && c.domain); } catch { return false; } }));

// ---- report ----
console.log(`\nseo-bot test suite\n${'-'.repeat(40)}`);
console.log(out.join('\n'));
console.log(`${'-'.repeat(40)}\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
