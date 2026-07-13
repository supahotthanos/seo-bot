// seo-bot · orchestrator — the full executor loop for one client:
//   pull (GSC, free) → audit (raw HTML) → decide (proposals) → apply (CMS adapter,
//   gated) → verify (server-render check) → indexnow → measure (AI visibility).
// Human approval gates every write. Nothing here auto-merges to production.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { pullGSC } from './gsc.mjs';
import { ga4Report } from './data/ga4.mjs';
import { buildProposals, saveProposals } from './decide.mjs';
import { applyClient } from './apply/index.mjs';
import { verifyUrls } from './verify.mjs';
import { pingIndexNow, bingSubmitIfKeyed } from './indexnow.mjs';
import { measure } from './measure.mjs';
import { analyzeSources } from './sources/index.mjs';
import { verifyBot } from './verifier.mjs';
import { nowIso } from './util.mjs';

export async function runLoop(cfg, { log = () => {}, apply = false, confirm = false, skipMeasure = false } = {}) {
  const started = nowIso();
  log(`\n▶ SEO-BOT loop · ${cfg.brand} (${cfg.baseUrl})\n`);

  // 1) PULL — free first-party data (GSC + GA4 conversions). Feeds prioritization + the
  //    stats guardrail KPI when connected.
  log('① pull (GSC + GA4)');
  const gsc = await pullGSC(cfg, { log });
  if (!gsc.enabled) log(`  GSC off: ${gsc.note}`);
  const ga4 = await ga4Report(cfg, { log });
  if (!ga4.enabled) log(`  GA4 off: ${ga4.note}`);

  // 2-3) AUDIT + DECIDE (buildProposals runs the audit internally).
  log('② audit + ③ decide');
  const result = await buildProposals(cfg, { log });
  // Tag proposals with GSC signal for the matching page: an OPPORTUNITY object when the page is one
  // (prioritization), else the page's raw impressions/clicks/ctr/position from byPage. Attaching to
  // EVERY page GSC knows about (not just opportunities) is what lets the experiment loop power-gate
  // clusters — proposals with no impressions can never be nominated (they'd read impressions:0).
  if (gsc.enabled) {
    const norm = (u) => String(u || '').replace(/\/$/, '');
    const oppByPage = new Map(gsc.opportunities.map((o) => [norm(o.page), o]));
    const imprByPage = new Map((gsc.pages || []).map((r) => [norm(r.keys?.[0]), r]));
    for (const p of result.proposals) {
      const key = norm(p.page);
      const o = oppByPage.get(key);
      if (o) { p.gsc = o; continue; }
      const r = imprByPage.get(key);
      if (r) p.gsc = { page: r.keys[0], impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: Math.round(r.position * 10) / 10 };
    }
  }
  // EV-ranking now happens in saveProposals (priority.mjs) using the gsc data attached above.
  saveProposals(result);
  log(`  ${result.proposals.length} proposals · score ${result.score}/100`);

  // 4) APPLY (gated)
  let applied = [];
  if (apply) {
    log('④ apply');
    const a = await applyClient(cfg, { log, confirm });
    applied = a.applied || [];
  } else {
    log('④ apply — skipped (pass apply:true / --apply)');
  }

  // 5) VERIFY server-render of the touched pages (always useful)
  log('⑤ verify (server-render)');
  const pages = [...new Set(result.proposals.map((p) => p.page))].slice(0, 15);
  const verify = pages.length ? await verifyUrls(cfg, pages, { log }) : [];

  // 6) INDEXNOW the changed/affected URLs
  let indexnow = { skipped: true };
  if (applied.length || apply) {
    log('⑥ indexnow');
    indexnow = await pingIndexNow(pages, cfg.domain, cfg.indexnowKey);
    log(`  indexnow: ${JSON.stringify(indexnow)}`);
    const bs = await bingSubmitIfKeyed(cfg, pages);
    if (!bs.skipped) log(`  bing submit: ${JSON.stringify(bs)}`);
  }

  // 7) MEASURE AI visibility (best-effort, no API)
  let measured = { skipped: true };
  if (!skipMeasure) { log('⑦ measure (AI visibility)'); measured = await measure(cfg, { log }); }

  // 8) SOURCES — what the engines cite most → off-site worklist (reads the measure capture)
  log('⑧ sources (off-site gap)');
  const sources = analyzeSources(cfg, { log });

  // 9) VERIFY — score 0-100 toward "perfect" + gaps (the loop's progress gauge)
  log('⑨ verify (progress score)');
  const progress = verifyBot(cfg, { log });

  // Run summary
  const summary = { client: cfg.name, started, finished: nowIso(), auditScore: result.score, progressScore: progress.score, proposals: result.proposals.length, applied: applied.length, gscEnabled: gsc.enabled, ga4Enabled: ga4.enabled, aiReferralSessions: ga4.aiSessions ?? null, aiStyleQueries: gsc.aiQueries?.length ?? null, indexnow, verifyPass: verify.filter((v) => v.ok).length, verifyTotal: verify.length, offsiteTargets: sources?.offsiteWorklist?.length ?? null, topGaps: progress.gaps.slice(0, 3) };
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run-latest.json'), JSON.stringify(summary, null, 2));
  log(`\n✓ loop complete — audit ${result.score}/100 · progress ${progress.score}/100 · ${result.proposals.length} proposals, ${applied.length} applied · verify ${summary.verifyPass}/${summary.verifyTotal}\n`);
  return summary;
}
