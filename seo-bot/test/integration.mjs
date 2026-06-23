#!/usr/bin/env node
// seo-bot · END-TO-END integration test. Unit tests prove each module; this proves the
// OPERATING LOOP composes on *connected* data — by feeding fixture GSC/GA4/AI-visibility
// inputs through the real modules and asserting the real artifacts come out. It's the
// closest proof of "it runs a loop on connected data" achievable without live credentials.
//
//   node seo-bot/test/integration.mjs     (exit 1 on any failure; cleans up its fixtures)

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { analyzeSources } from '../src/sources/index.mjs';
import { scoreContent } from '../src/content/gates.mjs';
import { contentApprove, contentPublish } from '../src/content/index.mjs';
import { decideChange } from '../src/stats/feedback.mjs';
import { verifyBot } from '../src/verifier.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLIENT = '_inttest';
const CFG_FILE = join(ROOT, 'seo-bot', 'config', `${CLIENT}.json`);
const REP = join(ROOT, 'seo-bot', 'reports', CLIENT);
const AIV = join(REP, 'ai-visibility');
const DRAFTS = join(REP, 'drafts');

// Self-contained fixture config so this test runs in ANY checkout (no real client needed).
const FIXTURE_CFG = {
  name: CLIENT, brand: 'Example Med Spa', aliases: ['example med spa'],
  domain: 'example.com', baseUrl: 'https://example.com',
  competitors: ['Yelp', 'RealSelf', 'Healthgrades'],
  cms: { type: 'nextjs', repoPath: '.', branchPrefix: 'seo-bot/' },
  vertical: 'medspa', reviewers: [{ name: 'Dr. Jane Doe', role: 'MD' }],
  gsc: { enabled: false }, engines: ['perplexity', 'google_aio'],
};

let pass = 0, fail = 0; const out = [];
const check = (name, cond) => { if (cond) { pass++; out.push(`  ✓ ${name}`); } else { fail++; out.push(`  ✗ ${name}`); } };
const cleanup = () => { for (const p of [AIV, DRAFTS, join(REP, 'sources.json'), join(REP, 'sources.md'), join(REP, 'content-scores.ndjson'), CFG_FILE]) { try { rmSync(p, { recursive: true, force: true }); } catch {} } };

try {
  mkdirSync(dirname(CFG_FILE), { recursive: true });
  writeFileSync(CFG_FILE, JSON.stringify(FIXTURE_CFG, null, 2));
  const cfg = loadConfig(CLIENT);

  // --- Stage A: SOURCES — fixture AI-visibility capture -> off-site worklist ---
  mkdirSync(AIV, { recursive: true });
  writeFileSync(join(AIV, 'fixture.json'), JSON.stringify({
    ranAt: '2026-06-21T00:00:00.000Z', summary: { perplexity: {}, google_aio: {} },
    results: [
      { engine: 'perplexity', prompt: 'best med spa', citedDomains: ['yelp.com', 'reddit.com', 'realself.com', 'threebestrated.com'] },
      { engine: 'google_aio', prompt: 'botox cost', citedDomains: ['reddit.com', 'youtube.com', 'healthgrades.com'] },
    ],
  }));
  const src = analyzeSources(cfg, { log: () => {} });
  check('A: sources reads the connected capture + ranks domains', src && src.topSources.length >= 5);
  check('A: top source is the most-cited (reddit, 2x)', src.topSources[0].host === 'reddit.com');
  check('A: off-site worklist contains claimable absent sources', src.offsiteWorklist.some((w) => w.host === 'reddit.com') && src.offsiteWorklist.some((w) => w.host === 'threebestrated.com'));

  // --- Stage B: CONTENT — fixture draft -> gate -> one-click approve ---
  mkdirSync(DRAFTS, { recursive: true });
  const brief = { targetQuery: 'morpheus8 in aventura', city: 'Aventura', author: { name: 'Dr. Jane Doe', role: 'MD' }, dataPoints: ['$700 to $1500 per session', 'series of 3 treatments', '4 to 6 weeks apart', '53.6% facial revenue share'], primarySources: ['https://www.fda.gov', 'https://pubmed.ncbi.nlm.nih.gov/31234567/'], schemaTypes: ['MedicalBusiness', 'Service'], hasOwnMedia: true, internalLinks: 3 };
  const draft = `## What does Morpheus8 in Aventura cost, and how many sessions?\nMorpheus8 in Aventura typically costs $700 to $1500 per session, and most plans run as a series of 3 treatments spaced 4 to 6 weeks apart. It is FDA-cleared RF microneedling ([FDA](https://www.fda.gov)); a peer-reviewed overview is on [PubMed](https://pubmed.ncbi.nlm.nih.gov/31234567/). Facial treatments hold a 53.6% revenue share. Aventura patients often pair Morpheus8 with a HydraFacial in Aventura.\n[Aventura pricing](/aventura) · [Book](/book)\nMedically reviewed by Dr. Jane Doe, MD. Last reviewed June 2026.`;
  writeFileSync(join(DRAFTS, 'm8.brief.json'), JSON.stringify(brief));
  writeFileSync(join(DRAFTS, 'm8.md'), draft);
  const sc = scoreContent(draft, brief, { priorTexts: [] });
  check('B: data-grounded draft clears all gates + is publish-eligible', sc.hardPass && sc.publishEligible);
  const appr = contentApprove(cfg, 'm8', { log: () => {} });
  check('B: one-click approve marks it (gate + human)', appr?.approved === true && existsSync(join(DRAFTS, 'm8.approved')));
  const pub = await contentPublish(cfg, { log: () => {}, confirm: false });
  check('B: publish builds the real PR payload (preview)', pub && Array.isArray(pub.previews) && pub.previews.some((p) => /m8\.md/.test(p.path)));

  // --- Stage C: STATS — fixture before/after GSC windows -> verdict ---
  const keep = decideChange({ before: { clicks: 100, impressions: 2000 }, after: { clicks: 160, impressions: 2000 }, days: 28 });
  check('C: connected before/after data -> significant keep', keep.decision === 'keep');
  const tryNext = decideChange({ before: { clicks: 100, impressions: 2000 }, after: { clicks: 103, impressions: 2000 }, days: 28 });
  check('C: flat movement -> try-next (the "change something" trigger)', tryNext.decision === 'try-next');

  // --- Stage D: VERIFY — the loop self-scores ---
  const v = verifyBot(cfg, { log: () => {} });
  check('D: verifier produces a 0-100 progress score + gap list', typeof v.score === 'number' && v.score >= 0 && v.score <= 100 && Array.isArray(v.gaps));

  console.log(`\nseo-bot integration test (full loop on fixture-connected data)\n${'-'.repeat(54)}`);
  console.log(out.join('\n'));
  console.log(`${'-'.repeat(54)}\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.error('integration test crashed:', e);
  fail++;
} finally {
  cleanup();
}
process.exit(fail ? 1 : 0);
