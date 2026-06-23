#!/usr/bin/env node
// seo-bot · CLI. Plug-and-play SEO/AEO executor for sites you own.
//
//   node seo-bot/bin/seo-bot.mjs list
//   node seo-bot/bin/seo-bot.mjs audit   <client> [--max N]
//   node seo-bot/bin/seo-bot.mjs propose <client>            # audit -> fix proposals
//   node seo-bot/bin/seo-bot.mjs apply   <client> [--yes]    # apply proposals via CMS adapter
//   node seo-bot/bin/seo-bot.mjs measure <client>            # AI-visibility tracking
//   node seo-bot/bin/seo-bot.mjs run     <client> [--apply]  # full loop
//
// <client> is a config name in seo-bot/config/<name>.json, or a path to a .json.

import { loadConfig, listConfigs } from '../src/config.mjs';

const log = (...a) => console.log(...a);

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args.flags[key] = next; i++; }
      else args.flags[key] = true;
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const { _, flags } = parseArgs(argv);
  const command = _[0] || 'help';
  const clientArg = _[1];

  if (command === 'help' || command === '--help' || command === '-h') {
    log(`seo-bot — SEO/AEO executor for sites you own\n`);
    log(`Commands:`);
    log(`  connect <client> [--force]  one-click Google OAuth (GA4 + GSC + Business Profile)`);
    log(`  ga4     <client>           pull GA4 sessions/conversions (after connect)`);
    log(`  dns     <client> [--add-dmarc|--verify-google T|--verify-bing T] [--yes]  Cloudflare DNS read/write`);
    log(`  bing    <client> {keyword "<q>"|queries|traffic|submit}  Bing Webmaster (FREE keyword volume + query stats)`);
    log(`  setup   <domain>           ONE-COMMAND new client: onboard→config→worksheet→citations→content plan→verify`);
    log(`  onboard <domain> [--write-config]  DNS + stack + baseline audit for a new site`);
    log(`  doctor  [client]           preflight: what's configured vs missing to go live, with fixes`);
    log(`  test                       run the bot's correctness test suite (24 invariants)`);
    log(`  list                       list configured clients`);
    log(`  audit   <client> [--max N] crawl + audit, write a report`);
    log(`  propose <client>           audit -> concrete fix proposals (LLM-assisted)`);
    log(`  apply   <client> [--yes]   apply proposals via the client's CMS adapter`);
    log(`  measure <client>           run AI-visibility tracking (track.mjs, no API)`);
    log(`  discover <client> [--write]  build THIS client's own prompt panel (services×city×brand + GSC demand + model phrasing)`);
    log(`  sources <client>           rank what AI engines cite most → off-site target worklist (no API)`);
    log(`  links   <client>           internal-link PageRank → equity-starved money pages + orphans (no API)`);
    log(`  inspect <client> [--url U] GSC URL Inspection — real index status per page (after connect)`);
    log(`  schema  <client>           structured-data lint + 2026 rich-result eligibility (no API)`);
    log(`  techaudit <client> [--max N]  BFS crawl: depth, redirect chains, X-Robots, orphans, indexability (no API)`);
    log(`  a11y    <client>           static WCAG-AA accessibility scan (no API)`);
    log(`  images  <client>           image-SEO audit (alt/filenames/WebP) + 2026 image sitemap (no API)`);
    log(`  entity  <client>           entity-consistency: Wikidata + Google KG + recommended sameAs`);
    log(`  cwv     <client> [--url U] Core Web Vitals: PageSpeed (lab) + CrUX (field)`);
    log(`  clarity <client>           Microsoft Clarity UX-frustration signals (rage/dead clicks, JS errors)`);
    log(`  gbp     <client> {status|reviews}  Google Business Profile performance + reviews (after connect)`);
    log(`  crawlbots [logfile]        verify AI-crawler hits (GPTBot/ClaudeBot/...) vs published IP ranges (no API)`);
    log(`  updates                    Google core/spam-update monitor (freezes stats judging during rollouts)`);
    log(`  citations <client>         generate the local-citations worklist (GBP/Apple/Bing/Boulevard/...)`);
    log(`  worksheet <client>         the full "bring on a client" onboarding sheet (everything combined)`);
    log(`  content {plan|score|draft} <client> [file|topic]  data-grounded content engine + anti-slop gates`);
    log(`  verify  <client>           score 0-100 toward "perfect" (definition-of-done rubric) + gaps`);
    log(`  opps    <client>           GSC striking-distance (page 1-2) + cannibalization (free, after connect)`);
    log(`  stats   <client>           statistical-significance scan over GSC (only act when real)`);
    log(`  cost    <client>           LLM token + spend ledger for the client (telemetry)`);
    log(`  decay   <client>           content-decay → refresh queue (GSC 90d vs prior; needs connect)`);
    log(`  gate    <client>           CI SEO-regression gate — exit 10 on score/critical regression (predeploy)`);
    log(`  generate <client> [--min 5] [--max 50]  GENERATE "Best med spas in [city]" data-moat pages from data/all-spas.json (index-gated)`);
    log(`  autopilot <client> [--push] [--n 3]  propose→policy→VERIFIER CONSENSUS→push (PR only); plan unless --push`);
    log(`  brief   [client] [--hours 24]  daily oversight brief — what changed, flags, rollback (portfolio if no client)`);
    log(`  weekly  <client> [--push]  the autonomous weekly cycle: read-loop → consensus autopilot → brief (cron target)`);
    log(`  migrate <client> --old <sitemap|urls|old-base> [--new <sitemap|base>]  old-site→new-site redirect map + configs + handoff (preserve link equity)`);
    log(`  cro     <client>           booking-funnel leak audit (tel:/CTA/form/trust + GA4 conv + Clarity)`);
    log(`  geogrid <client> [--kw "botox"] [--grid 5] [--radius 3] [--dry]  local map-pack rank grid (ATRP/SoLV/heatmap)`);
    log(`  serp    <client> [--dry]   live SERP-feature inventory + organic rank + Share-of-Voice (stealth)`);
    log(`  locations <client> [--briefs] [--gbp]  multi-location audit + doorway guard + per-location page briefs + GBP fan-out`);
    log(`  changes <client>           list journaled CMS changes (rollback-able)`);
    log(`  rollback <client> [--last N] [--yes]  reverse the last N applied changes`);
    log(`  tactics [client]           white/grey/black ranking levers, risk-labeled + opt-in routing`);
    log(`  run     <client> [--apply] full loop: audit -> propose -> (apply) -> indexnow -> measure`);
    log(`  ── 100x layer (Search Atlas teardown build) ──`);
    log(`  review  <client> [--approve-all-low-risk|--approve-category <type>|--reject <id|type>]  batched task review (policy-gated)`);
    log(`  report  <client> [--no-llm]   white-label client report (HTML + MD)`);
    log(`  portfolio                     0-100 health rollup across all clients + cross-domain signals`);
    log(`  probe   <prospectUrl>         detect OTTO/Search Atlas pixel → "what OTTO hides from ChatGPT" sales report`);
    log(`  crawlbudget <client>          server-log crawl-budget + crawl-to-cite (needs cfg.logs.drainUrl)`);
    log(`  content optimize <client> <file> --query "<q>" [--serp]   SERP-grounded content score + term-gap fixes`);
    log(`  (apply adapters: cms.type = edge | cloudflare-worker — server-rendered write-back, no JS pixel)`);
    log(`  research tweet <id>        scrape an X post + score its credibility (claim, not fact)`);
    log(`  research fetch <url|id>    acquisition only (tweet/RSS/HTML; stealth-escalates)`);
    log(`  research score "<text>" --source x:@handle [--traced] [--corroborators a,b]`);
    log(`\nClients: ${listConfigs().join(', ') || '(none yet — add seo-bot/config/<name>.json)'}`);
    return;
  }

  if (command === 'list') {
    const names = listConfigs();
    if (!names.length) { log('No client configs. Copy seo-bot/config/example.client.json to <name>.json.'); return; }
    for (const n of names) {
      try { const c = loadConfig(n); log(`  ${n.padEnd(22)} ${c.baseUrl}  (cms: ${c.cms.type})`); }
      catch (e) { log(`  ${n.padEnd(22)} ⚠ ${e.message}`); }
    }
    return;
  }

  if (command === 'updates') {
    const { googleUpdates } = await import('../src/updates.mjs');
    const u = await googleUpdates({ log });
    for (const i of u.ongoing || []) log(`  🔴 ONGOING: ${i.name} (since ${i.begin})`);
    for (const i of u.recent || []) log(`  🟠 recent: ${i.name} (ended ${i.end})`);
    log(u.coreUpdateActive ? '\n  → Stats judgement is FROZEN until the rollout + 7 days pass.' : '\n  → No active Ranking update — stats judging normally.');
    log(`  latest Ranking updates: ${(u.latest || []).map((i) => i.name).join(' · ') || 'none'}`);
    return;
  }

  if (command === 'brief') {
    if (clientArg) { const { dailyBrief } = await import('../src/brief.mjs'); await dailyBrief(loadConfig(clientArg), { log, hours: Number(flags.hours) || 24 }); }
    else { const { portfolioBrief } = await import('../src/brief.mjs'); await portfolioBrief({ log, hours: Number(flags.hours) || 24 }); }
    return;
  }

  if (command === 'crawlbots') {
    const { fetchBotRanges, analyzeCrawlLog } = await import('../src/connect/aibot-ips.mjs');
    const logfile = _[1];
    if (logfile) {
      const { readFileSync } = await import('node:fs');
      log(`Analyzing ${logfile} for verified AI-crawler hits …`);
      await analyzeCrawlLog(readFileSync(logfile, 'utf-8'), { log });
    } else {
      log('Fetching published AI-crawler IP ranges …');
      const ranges = await fetchBotRanges({ log });
      const total = Object.values(ranges).reduce((s, r) => s + (r.cidrs?.length || 0), 0);
      log(`\n  ${total} CIDRs across ${Object.keys(ranges).length} bots. Pass a server access-log path to verify real hits.`);
    }
    return;
  }

  if (command === 'test') {
    const { execFileSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join: pjoin } = await import('node:path');
    const testDir = pjoin(dirname(fileURLToPath(import.meta.url)), '..', 'test');
    let ok = true;
    for (const f of ['run.mjs', 'integration.mjs']) { try { execFileSync('node', [pjoin(testDir, f)], { stdio: 'inherit' }); } catch { ok = false; } }
    process.exit(ok ? 0 : 1);
  }

  if (command === 'doctor') {
    const { doctor } = await import('../src/doctor.mjs');
    doctor(_[1], { log });
    return;
  }

  if (command === 'tactics') {
    const { tacticsView, actionable } = await import('../src/tactics/registry.mjs');
    const hats = tacticsView();
    const ICON = { auto: '🟢', 'flag-opt-in': '🟡', manual: '✋', 'do-not-automate': '⛔' };
    for (const hat of ['white', 'grey', 'black']) {
      log(`\n  ${hat.toUpperCase()} HAT`);
      for (const t of (hats[hat] || [])) log(`    ${ICON[t.automatable] || ''} ${t.name}  [${t.penaltyRisk} risk · ${t.tier} evidence · ${t.automatable}]`);
    }
    log(`\n  Legend: 🟢 auto (bot applies) · 🟡 flag-opt-in (you flip on per-tactic) · ✋ manual (off-site) · ⛔ do-not-automate (penalty/illegal — knowledge only)`);
    if (clientArg) { try { const c = loadConfig(clientArg); log(`\n  Actionable now for ${clientArg}: ${actionable(c).map((t) => t.id).join(', ') || '(auto only — set tacticsOptIn[] to enable grey levers)'}`); } catch {} }
    return;
  }

  if (command === 'content') {
    const sub = _[1]; const clientName = _[2];
    if (!clientName) { log('usage: content {plan|score|draft} <client> [file|topic]'); return; }
    const c = loadConfig(clientName);
    const { contentPlan, contentScore, contentDraft, contentBatch, contentReview, contentApprove, contentApproveAll, contentPublish, contentOptimize } = await import('../src/content/index.mjs');
    if (sub === 'plan') contentPlan(c, { log });
    else if (sub === 'score') contentScore(c, _[3], { log });
    else if (sub === 'draft') await contentDraft(c, _.slice(3).join(' '), { log });
    else if (sub === 'batch') await contentBatch(c, { log, limit: Number(flags.limit) || 10 });
    else if (sub === 'review') contentReview(c, { log });
    else if (sub === 'approve') contentApprove(c, _[3], { log });
    else if (sub === 'approve-all') contentApproveAll(c, { log });
    else if (sub === 'publish') await contentPublish(c, { log, confirm: !!flags.yes });
    else if (sub === 'optimize') await contentOptimize(c, _[3], { log, query: flags.query, serp: !!flags.serp });
    else log('usage: content {plan|batch|review|score|draft|optimize|approve|approve-all|publish} <client> [file|topic|slug]');
    return;
  }

  if (command === 'bing') {
    const clientName = _[1];
    if (!clientName) { log('usage: bing <client> {keyword "<q>"|queries|traffic|submit}'); return; }
    const c = loadConfig(clientName);
    const action = _[2] || 'queries';
    const b = await import('../src/data/bing.mjs');
    if (action === 'keyword') { const r = await b.bingKeywordStats(c, _.slice(3).join(' '), { log }); log(r.enabled ? JSON.stringify(r.points.slice(0, 12), null, 2) : '  ' + r.note); }
    else if (action === 'queries') { const r = await b.bingQueryStats(c, { log }); if (!r.enabled) log('  ' + r.note); }
    else if (action === 'traffic') { const r = await b.bingRankAndTraffic(c, { log }); if (!r.enabled) log('  ' + r.note); }
    else if (action === 'submit') { const { discoverUrls } = await import('../src/crawl.mjs'); const { urls } = await discoverUrls(c); const r = await b.bingSubmitUrls(c, urls, { log }); if (!r.enabled) log('  ' + r.note); }
    else log('usage: bing <client> {keyword "<q>"|queries|traffic|submit}');
    return;
  }

  if (command === 'onboard') {
    const target = _[1];
    if (!target) { log('usage: onboard <domain> [--write-config]'); process.exit(1); }
    const { onboard } = await import('../src/onboard/index.mjs');
    await onboard(target, { log, writeConfig: !!flags['write-config'] });
    return;
  }

  if (command === 'setup') {
    // One command to bring on a client: onboard -> write config -> worksheet -> citations
    // -> content plan -> verify. Then a human runs `connect` + fills NAP/services.
    const target = _[1];
    if (!target) { log('usage: setup <domain>  — full new-client package in one command'); process.exit(1); }
    const { onboard } = await import('../src/onboard/index.mjs');
    log('▶ [1/6] onboard (DNS + stack + baseline + write config)');
    const onb = await onboard(target, { log, writeConfig: true });
    let c; try { c = loadConfig(onb.slug); } catch (e) { log(`  ⚠ could not load the new config: ${e.message}`); return; }
    if (flags.vertical) { c.vertical = String(flags.vertical); }
    const { worksheet } = await import('../src/worksheet.mjs');
    const { citations } = await import('../src/listings/index.mjs');
    const { contentPlan } = await import('../src/content/index.mjs');
    const { verifyBot } = await import('../src/verifier.mjs');
    log('\n▶ [2/6] worksheet');     await worksheet(c, { log: () => {} });
    log('▶ [3/6] citations');        citations(c, { log: () => {} });
    log('▶ [4/6] content plan');     contentPlan(c, { log });
    log('▶ [5/6] verify (progress)'); const v = verifyBot(c, { log });
    log('▶ [6/6] done.');
    log(`\n  ✅ Client "${onb.slug}" set up. Package in seo-bot/reports/${onb.slug}/ (worksheet.md, citations.md, content-plan.md).`);
    log(`  Progress: ${v.score}/100. Next (one-time, you): \`connect ${onb.slug}\`, set ga4.propertyId + vertical:medspa, fill listings.canonicalNap + services[] + the YMYL reviewer.`);
    return;
  }

  if (command === 'research') {
    const sub = _[1];
    const { researchFetch, researchScoreTweet, researchScore } = await import('../src/research/index.mjs');
    if (sub === 'fetch') { await researchFetch(_[2], { log }); return; }
    if (sub === 'tweet') { await researchScoreTweet(_[2], { log }); return; }
    if (sub === 'score') {
      await researchScore(_[2] || '', { source: flags.source, traced: !!flags.traced, corroborators: flags.corroborators ? String(flags.corroborators).split(',') : [] }, { log });
      return;
    }
    log('usage: research { fetch <url|tweetId> | tweet <tweetId> | score "<text>" --source x:@handle [--traced] [--corroborators a,b] }');
    return;
  }

  if (command === 'portfolio') {
    const { portfolio } = await import('../src/portfolio.mjs');
    await portfolio({ log });
    return;
  }
  if (command === 'probe') {
    if (!_[1]) { log('usage: probe <prospectUrl>  — detect OTTO/Search Atlas pixel → "what OTTO hides from ChatGPT" report'); process.exit(1); }
    const { competitorProbe } = await import('../src/competitor-probe.mjs');
    await competitorProbe(_[1], { log });
    return;
  }

  if (!clientArg) { log(`Command "${command}" needs a <client>. Try: seo-bot list`); process.exit(1); }
  const cfg = loadConfig(clientArg);
  if (flags.max) cfg.audit.maxPages = Number(flags.max);

  switch (command) {
    case 'audit': {
      const { runAudit } = await import('../src/audit.mjs');
      const { saveReport } = await import('../src/report.mjs');
      const r = await runAudit(cfg, { log });
      const { mdPath, latest } = saveReport(r);
      log(`\n  ── ${r.brand} ─────────────────────────`);
      log(`  Health score: ${r.score}/100`);
      log(`  🔴 ${r.bySeverity.critical}  🟠 ${r.bySeverity.high}  🟡 ${r.bySeverity.medium}  ⚪ ${r.bySeverity.low}`);
      log(`  Top issues:`);
      for (const ru of r.byRule.slice(0, 8)) log(`    ${ru.severity.padEnd(8)} ${ru.rule.padEnd(20)} ${ru.count}×`);
      log(`\n  Report → ${latest}\n`);
      break;
    }
    case 'propose': {
      const { propose } = await import('../src/decide.mjs');
      await propose(cfg, { log });
      break;
    }
    case 'apply': {
      const { applyClient } = await import('../src/apply/index.mjs');
      await applyClient(cfg, { log, confirm: !!flags.yes });
      break;
    }
    case 'measure': {
      const { measure } = await import('../src/measure.mjs');
      await measure(cfg, { log });
      break;
    }
    case 'discover': {
      const { discoverPrompts, writePromptPanel } = await import('../src/measure/discover.mjs');
      const { panel } = await discoverPrompts(cfg, { log, useGSC: !flags['no-gsc'], useLLM: !flags['no-llm'] });
      panel.forEach((p, i) => log(`    ${String(i + 1).padStart(2)}. ${p}`));
      if (flags.write) await writePromptPanel(cfg, panel, { log });
      else log(`\n  (re-run with --write to save these as ${cfg.name}'s promptPanel — measure/serp then track them)`);
      break;
    }
    case 'citations': {
      const { citations } = await import('../src/listings/index.mjs');
      citations(cfg, { log });
      break;
    }
    case 'worksheet': {
      const { worksheet } = await import('../src/worksheet.mjs');
      await worksheet(cfg, { log });
      break;
    }
    case 'verify': {
      const { verifyBot } = await import('../src/verifier.mjs');
      verifyBot(cfg, { log });
      break;
    }
    case 'sources': {
      const { analyzeSources } = await import('../src/sources/index.mjs');
      analyzeSources(cfg, { log });
      break;
    }
    case 'links': {
      const { analyzeLinks } = await import('../src/links.mjs');
      await analyzeLinks(cfg, { log });
      break;
    }
    case 'inspect': {
      const { inspectSite, inspectUrl } = await import('../src/inspect.mjs');
      if (flags.url) { const r = await inspectUrl(cfg, String(flags.url), { log }); log(JSON.stringify(r, null, 2)); }
      else await inspectSite(cfg, { log, max: Number(flags.max) || 20 });
      break;
    }
    case 'schema': {
      const { lintSchema } = await import('../src/schema.mjs');
      await lintSchema(cfg, { log });
      break;
    }
    case 'techaudit': {
      const { techAudit } = await import('../src/techaudit.mjs');
      await techAudit(cfg, { log, maxPages: Number(flags.max) || 150 });
      break;
    }
    case 'opps':
    case 'opportunities': {
      const { pullGSC } = await import('../src/gsc.mjs');
      const g = await pullGSC(cfg, { log });
      if (!g.enabled) { log('  ' + g.note); break; }
      log(`\n  Striking distance — page 1-2, one nudge from page 1 (${g.strikingDistance.length}):`);
      g.strikingDistance.slice(0, 15).forEach((s) => log(`    "${s.query}" — pos ${s.position}, ${s.impressions} impr, CTR ${s.ctr}%`));
      log(`\n  Cannibalization — 2+ of our pages competing (${g.cannibalization.length}):`);
      g.cannibalization.slice(0, 15).forEach((c) => log(`    "${c.query}" — ${c.count} pages @ pos ${c.pages.map((p) => p.position).join('/')}`));
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { ROOT } = await import('../src/config.mjs');
      const dir = join(ROOT, 'seo-bot', 'reports', cfg.name); mkdirSync(dir, { recursive: true });
      const lines = [`# GSC opportunities — ${cfg.brand}`, '', `## Striking distance (${g.strikingDistance.length})`, ...g.strikingDistance.map((s) => `- [ ] "${s.query}" — pos ${s.position}, ${s.impressions} impr, CTR ${s.ctr}%`), '', `## Cannibalization (${g.cannibalization.length})`, ...g.cannibalization.map((c) => `- [ ] "${c.query}" (${c.count} pages): ${c.pages.map((p) => p.page + ' @' + p.position).join(' vs ')}`)];
      writeFileSync(join(dir, 'gsc-opportunities.md'), lines.join('\n'));
      log(`\n  → ${join(dir, 'gsc-opportunities.md')}`);
      break;
    }
    case 'a11y': {
      const { auditA11y } = await import('../src/a11y.mjs');
      await auditA11y(cfg, { log });
      break;
    }
    case 'images': {
      const { auditImages } = await import('../src/image-seo.mjs');
      await auditImages(cfg, { log });
      break;
    }
    case 'entity': {
      const { entityConsistency } = await import('../src/sources/entity.mjs');
      await entityConsistency(cfg, { log });
      break;
    }
    case 'cwv': {
      const { pageSpeed, cwvDiagnose } = await import('../src/data/pagespeed.mjs');
      const { cruxRecord } = await import('../src/data/crux.mjs');
      const url = flags.url ? String(flags.url) : cfg.baseUrl;
      const strategy = flags.desktop ? 'desktop' : 'mobile';
      const ps = await pageSpeed(cfg, url, { strategy, log });
      if (!ps.enabled) log(`  PSI: ${ps.note}`);
      const cx = await cruxRecord(cfg, { url, log });
      if (!cx.enabled) log(`  CrUX: ${cx.note}`);
      const dg = await cwvDiagnose(cfg, url, { strategy, log }); // actionable fixes, not just scores
      if (!dg.enabled) log(`  diagnose: ${dg.note}`);
      const { cwvTemplatePlan } = await import('../src/perf/cwv-template.mjs');
      const tp = await cwvTemplatePlan(cfg, url, { strategy, log }); // concrete template patches
      if (!tp.enabled) log(`  template: ${tp.note}`);
      break;
    }
    case 'clarity': {
      const { clarityInsights } = await import('../src/data/clarity.mjs');
      const r = await clarityInsights(cfg, { log });
      if (!r.enabled) log(`  ${r.note}`); else log(JSON.stringify(r.frustration, null, 2));
      break;
    }
    case 'gbp': {
      const { gbpStatus, gbpReviews } = await import('../src/data/gbp.mjs');
      const action = _[2] || 'status';
      const r = action === 'reviews' ? await gbpReviews(cfg, { log }) : await gbpStatus(cfg, { log });
      if (!r.enabled) log(`  ${r.note}`); else log(JSON.stringify(r, null, 2));
      break;
    }
    case 'stats': {
      const { scanClient } = await import('../src/stats/feedback.mjs');
      await scanClient(cfg, { log });
      break;
    }
    case 'cost': {
      const { costSummary } = await import('../src/cost.mjs');
      const s = costSummary(cfg.name, { log });
      if (!s.calls) log('  ' + (s.note || 'no spend recorded'));
      break;
    }
    case 'decay': {
      const { detectDecay } = await import('../src/content/decay.mjs');
      const r = await detectDecay(cfg, { log });
      if (!r.enabled) log('  ' + r.note);
      break;
    }
    case 'gate': {
      const { ciGate } = await import('../src/gate.mjs');
      const r = await ciGate(cfg, { log });
      process.exit(r.exitCode); // 0 pass, 10 fail — for CI/predeploy
    }
    case 'generate': {
      const { generatePages } = await import('../src/generate/pages.mjs');
      const r = await generatePages(cfg, { log, minSpas: Number(flags.min) || 5, max: Number(flags.max) || 50 });
      if (r.error) log('  ' + r.error);
      break;
    }
    case 'autopilot': {
      const { runAutopilot } = await import('../src/autopilot.mjs');
      await runAutopilot(cfg, { log, push: !!flags.push, n: Number(flags.n) || 3 });
      break;
    }
    case 'weekly': {
      const { weeklyRoutine } = await import('../src/routine.mjs');
      await weeklyRoutine(cfg, { log, push: !!flags.push, n: Number(flags.n) || 3 });
      break;
    }
    case 'migrate': {
      const { migrate } = await import('../src/migrate.mjs');
      const r = await migrate(cfg, { log, old: flags.old, neu: flags.new });
      if (r.error) log('  ' + r.error);
      break;
    }
    case 'cro': {
      const { auditCRO } = await import('../src/cro.mjs');
      await auditCRO(cfg, { log });
      break;
    }
    case 'geogrid': {
      const { geoGrid } = await import('../src/geogrid.mjs');
      const r = await geoGrid(cfg, { log, keyword: flags.kw || flags.keyword, gridSize: Number(flags.grid) || 5, radiusMiles: Number(flags.radius) || 3, live: !flags.dry });
      if (r.error) log('  ' + r.error);
      break;
    }
    case 'serp':
    case 'rank': {
      const { trackSerp } = await import('../src/serp.mjs');
      const r = await trackSerp(cfg, { log, live: !flags.dry });
      if (r.error) log('  ' + r.error);
      break;
    }
    case 'locations': {
      const { auditLocations, gbpFanout, locationPageBriefs } = await import('../src/locations.mjs');
      auditLocations(cfg, { log });
      if (flags.briefs) { const b = locationPageBriefs(cfg); log(`  ${b.length} per-location×service page briefs (e.g. ${b.slice(0, 3).map((x) => x.targetQuery).join(', ')})`); }
      if (flags.gbp) gbpFanout(cfg).forEach((g) => { log(`\n  ${g.location}:`); g.checklist.forEach((c) => log('   - ' + c)); });
      break;
    }
    case 'changes': {
      const { listChanges } = await import('../src/change-ledger.mjs');
      const rows = listChanges(cfg.name, { limit: Number(flags.max) || 30 });
      if (!rows.length) { log('  no changes journaled yet (apply --yes records them).'); break; }
      rows.forEach((r) => log(`  ${r.ts.slice(0, 16)} · ${r.adapter} · ${r.url || '?'} · ${r.field || '?'} ${r.reversible ? '↩︎' : '⚠️ no-snapshot'}`));
      break;
    }
    case 'rollback': {
      const { rollback } = await import('../src/change-ledger.mjs');
      await rollback(cfg, { log, last: Number(flags.last) || 1, confirm: !!flags.yes });
      break;
    }
    case 'connect': {
      const { connectGoogle, connectionStatus } = await import('../src/connect/google.mjs');
      const st = connectionStatus(cfg.name);
      if (st.connected && !flags.force) { log(`  ${cfg.name} already connected (scopes: ${st.scopes}). Re-run with --force to reconnect.`); break; }
      log(`  Connecting Google (GA4 + Search Console + Business Profile) for ${cfg.name}…`);
      try {
        const r = await connectGoogle(cfg.name, { log });
        log(`  ✅ Connected (PKCE S256). Token saved → ${r.path} ${r.encrypted ? '(encrypted at rest)' : ''}`);
        if (!r.encrypted) log(`  ⚠ Set SEO_BOT_SECRET_KEY to encrypt the refresh token at rest (it's gitignored but currently plaintext).`);
        log(`  ⚠ If the Google OAuth consent screen is in "Testing" mode the token EXPIRES IN 7 DAYS — set it to "In production" before onboarding a paying client.`);
      } catch (e) { log(`  ❌ ${e.message}`); process.exitCode = 1; }
      break;
    }
    case 'ga4': {
      const { ga4Report } = await import('../src/data/ga4.mjs');
      const r = await ga4Report(cfg, { log });
      if (!r.enabled) log(`  GA4 off: ${r.note}`);
      break;
    }
    case 'dns': {
      const { dnsConnector } = await import('../src/connect/cloudflare.mjs');
      await dnsConnector(cfg, { log, opts: { confirm: !!flags.yes, addDmarc: !!flags['add-dmarc'], verifyGoogle: flags['verify-google'], verifyBing: flags['verify-bing'] } });
      break;
    }
    case 'run': {
      const { runLoop } = await import('../src/orchestrator.mjs');
      await runLoop(cfg, { log, apply: !!flags.apply, confirm: !!flags.yes, skipMeasure: !!flags['no-measure'] });
      break;
    }
    case 'review': {
      const { review } = await import('../src/review.mjs');
      const action = flags['approve-all-low-risk'] ? 'approve-all-low-risk' : flags['approve-category'] ? 'approve-category' : flags.reject ? 'reject' : null;
      const value = flags['approve-category'] || flags.reject;
      await review(cfg, { log, action, value: typeof value === 'string' ? value : null });
      break;
    }
    case 'report': {
      const { reportClient } = await import('../src/report-client.mjs');
      await reportClient(cfg, { log, llm: !flags['no-llm'] });
      break;
    }
    case 'crawlbudget': {
      const { analyzeCrawlBudget } = await import('../src/crawlbudget.mjs');
      await analyzeCrawlBudget(cfg, { log });
      break;
    }
    default:
      log(`Unknown command: ${command}. Try: seo-bot help`);
      process.exit(1);
  }
}

main().catch((err) => { console.error('seo-bot failed:', err); process.exit(1); });
