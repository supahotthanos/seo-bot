// Rebuild a published prospect deck IN PLACE — same slug, SAME TOKEN (links already
// texted to the founders keep working) — with a fresh crawl + the current grading code.
// Deliberately NO Slack post and NO GHL callback: this is a re-score, not a new audit
// event, so nobody gets re-texted. Built 2026-07-23 for the honest-AEO recalibration.
//
// Usage (from repo root, .env providing SEO_BOT_STORE_REPO; gh auth for the token):
//   node scripts/rebuild-prospect-deck.mjs veinandmedspa.com parfaire.com
import { getStore } from '../src/store/index.mjs';
import { buildConfig } from '../src/config.mjs';
import { runAudit } from '../src/audit.mjs';
import { propose } from '../src/decide.mjs';
import { buildProspectAudit } from '../src/prospect-audit.mjs';
import { makePrecallPanelSampler } from '../src/measure/precall-panel-sampler.mjs';

const log = (m) => console.log(m);
const store = await getStore(process.env, { defaultDriver: 'gh' });

for (const raw of process.argv.slice(2)) {
  const domain = String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9][a-z0-9.-]{2,80}\.[a-z]{2,}$/.test(domain)) { log(`skip ${raw}: bad domain`); continue; }
  const slug = domain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const path = `prospects/_default/${slug}.json`;
  const prior = await store.getJson(path);
  if (!prior || !prior.token) { log(`skip ${domain}: no published deck at ${path} (rebuild only re-scores existing decks)`); continue; }

  log(`\n=== ${domain} — rebuilding (prior aeo ${prior.grades?.aeo?.score ?? '?'} / overall ${prior.grades?.overall ?? '?'})`);
  const cfg = buildConfig({
    name: `lead-${slug}`.slice(0, 60).replace(/-+$/, ''),
    brand: String(prior.brand || domain).slice(0, 80),
    domain, cms: { type: 'dryrun' }, vertical: 'medspa', audit: { maxPages: 25 },
  });
  const audit = await runAudit(cfg, { log });
  let proposals = [];
  try { const pr = await propose(cfg, { log }); proposals = pr?.proposals || []; } catch { /* deck ships on the audit alone */ }
  const deck = await buildProspectAudit(cfg, {
    audit, proposals, log,
    panelSampler: makePrecallPanelSampler({ domain }), // live own-metro sample when this seat has a capture Chrome
  });
  deck.token = prior.token;   // keep every already-shared /prospect/<slug>?k=<token> link alive
  const put = await store.putJson(path, deck, `rebuild prospect deck ${domain} (honest-AEO rescore, token preserved)`);
  if (!put || !put.ok) { log(`  PUBLISH FAILED: ${(put && put.error) || '?'}`); continue; }
  log(`  ✓ republished — aeo ${prior.grades?.aeo?.score ?? '?'}→${deck.grades.aeo.score} · overall ${prior.grades?.overall ?? '?'}→${deck.grades.overall} · same URL /prospect/${slug}?k=${deck.token}`);
}
