// seo-bot · scripts/seo-parity — the MASTER-SEO PARITY matrix (GOAL criterion 1).
//
// Enumerates EVERY job a master med-spa SEO does within scope (website, backlinks/off-site,
// measurement — GBP writes excluded by hard rule) and self-verifies each claimed row by
// importing its module and checking the exported function exists. A claimed-but-missing
// module renders BROKEN, never green (coverage honesty). Rows honestly below ready-fix are
// the BUILD QUEUE. Levels:
//   auto      — deterministic fix can auto-apply through policy/autopilot gates
//   ready-fix — generates a ready-to-merge diff/artifact/worksheet (human approves)
//   propose   — detects + proposes, fix not yet generated (BUILD QUEUE)
//   detect    — detection only (BUILD QUEUE unless terminal)
//   terminal  — detection/monitoring IS the complete job by design (gates, trackers) — satisfied
//   human     — human-by-design with the reason (satisfied)
//   gap       — no module yet (BUILD QUEUE)
// GOAL-DONE bar: every row auto/ready-fix/terminal/human; zero BROKEN; gaps emptied.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/config.mjs';

const R = []; // { area, job, level, module?, fn?, note? }
const row = (area, job, level, module = null, fn = null, note = '') => R.push({ area, job, level, module, fn, note });

// ── TECHNICAL ────────────────────────────────────────────────────────────────
row('technical', 'full technical crawl + audit (depth, redirect chains, indexability matrix)', 'ready-fix', 'src/techaudit.mjs', 'techAudit', 'findings feed decide → PR-able fixes');
row('technical', 'crawl-budget analysis → robots/redirect/canonical proposals', 'ready-fix', 'src/crawlbudget.mjs', 'wasteToProposals');
row('technical', 'index discipline (INDEX/NOINDEX/301/WAIT per page)', 'ready-fix', 'src/index-discipline.mjs', 'decideIndex', 'noindex/301 are irreversible-gated');
row('technical', 'redirects + canonical fixes as ready diffs', 'ready-fix', 'src/onpage-fixes.mjs', 'canonicalFix');
row('technical', 'robots.txt / sitemap artifacts + IndexNow ping', 'ready-fix', 'src/indexnow.mjs', 'pingIndexNow', 'lastmod only on real diffs (fake-refresh guard)');
row('technical', 'CWV code-level fixes (PageSpeed/CrUX → concrete diffs)', 'ready-fix', 'src/onpage-fixes.mjs', 'fileForUrl', 'CWV bundle generator (E9)');
row('technical', 'render-parity / cloaking gate (bot text == human text)', 'terminal', 'src/parity.mjs', 'verifyParity', 'verification gate — terminal by design');
row('technical', 'js-dependence → SSR migration work order', 'ready-fix', 'src/remediation.mjs', 'ssrMigrationPlan', 'plan artifact machine-generated (BLOG-KIT rules + parity verify); the rebuild decision stays human');
row('technical', 'site architecture: internal-link mesh candidates + sculpted budgets', 'ready-fix', 'src/sculpt.mjs', 'runSculpt', 'server-rendered <a> patches, PR path');
row('technical', 'weighted PageRank / link-flow analysis', 'terminal', 'src/links.mjs', 'analyzeLinks', 'analysis feeding sculpt');

// ── ON-PAGE ──────────────────────────────────────────────────────────────────
row('on-page', 'titles + meta (deterministic clamps)', 'auto', 'src/decide.mjs', 'tightenText', 'the only conservative auto-class, history-gated');
row('on-page', 'heading structure fixes (H1–Hn)', 'ready-fix', 'src/onpage-fixes.mjs', 'h1Fix');
row('on-page', 'answer capsules 40-60w + ≤17w sentences + read-window ≤5k chars', 'ready-fix', 'src/aeo.mjs', 'proposeAeoFixes', 'LLM rewrites gated behind llmAvailable, validators deterministic');
row('on-page', 'passage chunking / self-containment (512-token independence)', 'ready-fix', 'src/passage.mjs', 'scorePassages', 'split fixes via onpage-fixes');
row('on-page', 'full schema pack (MedicalBusiness/Service/Offer/Physician/ReserveAction/Article/Breadcrumb)', 'ready-fix', 'src/onpage-fixes.mjs', 'schemaPackArtifact', 'comprehension-only; FAQ/HowTo never emitted for rich results');
row('on-page', 'schema lint (deprecated types, wrong local type)', 'terminal', 'src/schema.mjs', 'lintSchema', 'gate feeding the pack generator');
row('on-page', 'image SEO (alt/format/dimensions/lazy)', 'ready-fix', 'src/image-seo.mjs', 'auditImages', 'alt fixes via onpage-fixes; alt-text-as-content doctrine');
row('on-page', 'anchor-text variety / entropy → rewrite diffs', 'ready-fix', 'src/remediation.mjs', 'anchorRewriteFixes', 'generic anchors → descriptive noun-phrase patches (no usable target title = no patch, never fabricated)');
row('on-page', 'entity extraction + @id graph markup', 'ready-fix', 'src/entity/schema-emit.mjs', 'emitAll', 'edge-safe jsonld proposals');
row('on-page', 'a11y overlaps (labels/landmarks/contrast)', 'ready-fix', 'src/a11y.mjs', 'auditA11y');
row('on-page', 'CRO booking-funnel leaks', 'ready-fix', 'src/cro.mjs', 'auditCRO', 'money-path changes always human-queued');

// ── CONTENT ──────────────────────────────────────────────────────────────────
row('content', 'keyword + fan-out demand research (captured > synthetic)', 'ready-fix', 'src/fanout-planner.mjs', 'planCoverage', 'coverage matrix → gated brief stubs');
row('content', 'fan-out drift linting (stale year/modifier tokens)', 'ready-fix', 'src/fanout-drift.mjs', 'lintDrift');
row('content', 'briefs with hard data requirements', 'ready-fix', 'src/brief.mjs', 'buildBrief');
row('content', 'gated drafting (no-fabrication, named reviewer, originality, sibling-dedup)', 'ready-fix', 'src/content/gates.mjs', 'scoreContent', 'hard gates block publish; PR-only');
row('content', 'data-moat pages (every number provenance-tracked to dataset)', 'ready-fix', 'src/generate/moat.mjs', 'buildMoatPlan', 'plan-cap + publish-throttle + local-value gated');
row('content', 'freshness with REAL diffs (fake re-date veto)', 'terminal', 'src/integrity.mjs', 'isFakeRefresh', 'gate — enforced everywhere content re-dates');
row('content', 'content-decay detection + recovery worksheets', 'ready-fix', 'src/remediation.mjs', 'decayRecoveryPlan', 'per-page refresh briefs; real-diff enforced by isFakeRefresh; detection via content/decay.detectDecay');
row('content', 'cannibalization detection (two pages, one query)', 'ready-fix', 'src/cannibalization.mjs', 'detectCannibalization', 'canonical/differentiate proposals; consolidation always human-queued');
row('content', 'HCU-recovery planner (prune/consolidate/improve, site-level)', 'ready-fix', 'src/remediation.mjs', 'hcuRecoveryPlan', 'deterministic tiers from bodyWords/score/demand; prune+consolidate irreversible-gated downstream');
row('content', 'term/TF-IDF coverage optimization through anti-slop gates', 'ready-fix', 'src/content/optimize.mjs', 'optimizeDraft');
row('content', 'humanizer / June-2026 spam-update slop lint + one rewrite pass', 'ready-fix', 'src/content/blog-publish.mjs', 'aiPatternScore', 'named-pattern lint (delve/in-todays-world/buzzwords/em-dash overuse/metronome); >0.15 → LLM rewrite; still-sloppy = fail closed');
row('content', 'auto-post pipeline (draft → gates → registry → PR auto-merge; YMYL held)', 'auto', 'src/content/blog-publish.mjs', 'publishBlogPost', 'PR-only, never direct push; capsule/near-dup/sourced-$/weekly-cap gates; YMYL routes to HELD PR');
row('content', 'competitor-blog knowledge corpus (winners from panel + harvest + gap-mine)', 'ready-fix', 'src/content/blog-corpus.mjs', 'winningSpasFromPanel', 'aggregators excluded; near-dup gate blocks copying at publish time');
row('content', 'ranked-clinic discovery + verified name→domain resolution (the actual city #1s)', 'ready-fix', 'src/content/blog-corpus.mjs', 'rankedClinicsFromPanel', 'rank-weighted names from panel+atlas; guess+LLM domains ALWAYS fetch-verified (brand tokens + med-spa signal) — a hallucinated domain cannot enter the corpus');
row('content', 'winner voice profile (quant register + exemplars, training data for drafting)', 'ready-fix', 'src/content/voice.mjs', 'corpusVoiceProfile', 'post-weighted medians+IQR: cadence sd, question rate, you/we, $-concreteness, FK grade, title patterns; voicePromptBlock calibrates drafts; near-dup gate still blocks copying');
row('content', 'per-client dated content journey (easy→hard, SEO+AEO twinned)', 'ready-fix', 'src/content/journey.mjs', 'buildContentJourney', 'signals: GSC striking-distance + fan-out sub-queries + corpus heads');
row('content', 'content-cohort statistical guardrail (auto-pauses posting on decay)', 'auto', 'src/content/cohort-guardrail.mjs', 'judgeCohort', 'weekly snapshot vs site total; z-tested ≥30% share collapse → content-pause.flag; blog-publish refuses; auto-clears on recovery');

// ── LOCAL (ON-SITE + READ-ONLY; GBP NEVER WRITTEN) ──────────────────────────
row('local', 'location/service landing pages with real local data', 'ready-fix', 'src/generate/moat.mjs', 'runMoat', 'local-value gate demands real local facts');
row('local', 'NAP consistency on the WEBSITE + schema', 'ready-fix', 'src/rules.mjs', 'auditLocalSite');
row('local', 'geo-grid map-pack tracking (ATRP/SoLV, scraped, read-only)', 'terminal', 'src/geogrid.mjs', 'geoGrid', 'tracked, never touched');
row('local', 'local ranking-factor audit + DEBUNKED suppressor', 'human', 'src/local/factors.mjs', 'assessLocal', 'audit + proposals machine-done; every APPLY is GBP-side = hard-exclusion human handoff (never written by the bot)');
row('local', 'review monitoring + velocity math (read-only)', 'terminal', 'src/local/reviews.mjs', 'velocityScore', 'no solicitation surface exists (suite-asserted)');
row('local', 'review reply DRAFTS (compliance-gated; human posts)', 'human', 'src/offsite/replies.mjs', 'checkReplyCompliance', 'HARD RULE: bot never posts; GBP suspension risk');
row('local', 'GBP profile changes (categories/hours/services)', 'human', null, null, 'HARD EXCLUSION: observe-only; all GBP writes are human handoffs');

// ── BACKLINKS / OFF-SITE ─────────────────────────────────────────────────────
row('off-site', 'mention-gap engine (hosts engines cite where client absent)', 'ready-fix', 'src/offsite/mention-gap.mjs', 'buildMentionGap', 'worksheet + drafted pitches; human sends');
row('off-site', 'backlink-target discovery ranked by citation-freq × attainability + toxicity vetting', 'ready-fix', 'src/offsite/backlink-targets.mjs', 'buildBacklinkTargets', 'NEW (criterion 7)');
row('off-site', 'thread-radar (UGC threads engines cite; DISCLOSED reply drafts)', 'ready-fix', 'src/offsite/thread-radar.mjs', 'threadRadar', 'NEW (criterion 7); never account networks/auto-posting');
row('off-site', 'listicle radar (never self-ranking)', 'ready-fix', 'src/offsite/listicle-radar.mjs', 'listicleRadar');
row('off-site', 'digital-PR / wire discipline (gates + mirror-first + refire)', 'ready-fix', 'src/offsite/newsroom.mjs', 'REFIRE_MIN_DAYS', 'drafts fully gated; human pays/submits');
row('off-site', 'consolidated human worksheet (one action per row)', 'ready-fix', 'src/offsite/worksheet.mjs', 'consolidateWorksheet');
row('off-site', 'outreach EMAIL agent (compliance-linted, round-robin sends, dedup, 90d re-contact)', 'auto', 'src/outreach/agent.mjs', 'runOutreach', 'CAN-SPAM frame (identify/address/opt-out); Gmail SEND scope per-mailbox; two-key send switch (cfg.outreach.autoSend + --live)');
row('off-site', 'per-mailbox Gmail OAuth grant (cross-account-verified)', 'terminal', 'src/connect/google.mjs', 'GOOGLE_SCOPES', 'connect-mailbox verb; refuses grants where signed-in email ≠ typed email');
row('off-site', 'sending replies / forum posting / wire submission', 'human', null, null, 'Reddit/forum bans posting bots; wire submissions carry legal accountability — forever human');

// ── COMPETITIVE ──────────────────────────────────────────────────────────────
row('competitive', 'competitor visibility / share-of-voice across engines', 'terminal', 'src/measure/sov.mjs', 'computeSov');
row('competitive', 'SERP feature + CTR-weighted SoV tracking', 'terminal', 'src/serp.mjs', 'trackSerp', 'stealth, Mac-Mini');
row('competitive', 'backlink/citation-source gap vs competitors', 'ready-fix', 'src/offsite/backlink-targets.mjs', 'competitorGap', 'NEW (criterion 7)');
row('competitive', 'OTTO/overlay-pixel probe (prospect teardowns)', 'terminal', 'src/competitor-probe.mjs', 'competitorProbe');

// ── MEASUREMENT ──────────────────────────────────────────────────────────────
row('measurement', 'GSC pull (queries/pages/CTR/position)', 'terminal', 'src/gsc.mjs', 'pullGSC', 'config-dependent: OAuth handoff');
row('measurement', 'AI visibility (block-aware stealth capture, real consumer apps)', 'terminal', 'src/measure/sov.mjs', 'promptMatrix');
row('measurement', 'fan-out capture (multi-field, relocation-proof) + citations', 'terminal', 'src/measure/fanout-capture.mjs', 'extractFromNetwork');
row('measurement', 'brand-in-fanout KPI (run-variance floor)', 'terminal', 'src/measure/fanout-capture.mjs', 'brandFanoutVisibility');
row('measurement', 'crawler log intelligence (verified vs spoofed, never-fetched, crawl→cite lag)', 'terminal', 'src/agent-analytics.mjs', 'agentAnalytics');
row('measurement', 'self-healing capture (claude -p + Playwright MCP, propose-only)', 'terminal', 'src/measure/heal.mjs', 'runHeal');
row('measurement', 'statistical verdicts (z/DiD + BH-FDR + counterfactual + guardrails/SRM at locked horizons)', 'terminal', 'src/experiments/loop.mjs', 'evaluate');
row('measurement', 'experiment nomination with power gate', 'terminal', 'src/experiments/loop.mjs', 'powerAtHorizon');
row('measurement', 'in-house Peec-AI query-bank panel + variance decomposition (day/spelling/engine)', 'terminal', 'src/measure/query-bank-analytics.mjs', 'varianceDecomposition', 'Wilson/bootstrap CIs on every rate/rank; evidence-audit clean; scores driver via Kendall-style order-agreement + Jaccard');
row('measurement', 'query-bank forced reasoning tier (chip driven; captures record actual tier)', 'terminal', 'src/measure/fanout-capture.mjs', 'selectEffortTier', 'Instant/low → Medium → High geometry-click on the composer chip; verified live');
row('measurement', 'query-bank persistent cooldown (throttle-halt = filesystem gate; every caller refused)', 'terminal', 'src/measure/query-bank-runner.mjs', 'runQueryBank', 'chatgpt.com HTTP-throttle-diagnosed; halt stamps .cooldown; CLI/schedule/operator all blocked until it expires');
row('measurement', 'Google SERP radar (top-10 per city × money queries, geo-pinned, block-aware)', 'terminal', 'src/measure/serp-radar.mjs', 'runSerpRadar', 'uule per city; blocked rows EXCLUDED; 2-block halt + persistent cooldown; recurrence winners + exact ranking-page inventory (home/service/blog)');
row('competitive', 'SERP tactic fingerprinting of the pages that actually rank', 'ready-fix', 'src/measure/serp-radar.mjs', 'tacticFingerprint', 'JSON-LD types/FAQ/aggregateRating/city-in-title/depth/blog-links/phone — deterministic; rolls into research/serp-playbook PLAYBOOK.md; winners feed blog-corpus via --harvest');
row('measurement', 'Camoufox stealth backend + warm-profile Google path (anti-/sorry/ on one IP)', 'terminal', 'src/measure/scrapling.mjs', 'sidecarFetch', 'Scrapling/Camoufox sidecar for Cloudflare+consent walls; warm persistent Chrome profile w/ consent-accept; both slow+low-volume+cooldown-gated — the honest one-IP cadence');
row('measurement', 'canonical 65-market grid shared by both lanes', 'ready-fix', 'src/measure/markets.mjs', 'US_MEDSPA_MARKETS', 'tiered competitiveness order; single source of truth for serp-radar + query-bank + atlas');
row('off-site', 'off-page surface map (directories + press winners appear on, gaps flagged)', 'ready-fix', 'src/measure/offsite-radar.mjs', 'offsiteSurfaceMap', 'derived from SERP + ChatGPT citations (no backlink crawler); prioritized action list, press-weighted; merges with thread-radar');

// ── YMYL COMPLIANCE ──────────────────────────────────────────────────────────
row('ymyl', 'reviewer-registry verification (fabricated authority = block)', 'terminal', 'src/integrity.mjs', 'verifyReviewer');
row('ymyl', 'medical claims / GLP-1 / before-after gates (flag-only)', 'terminal', 'src/rules.mjs', 'auditMedspaPage', 'YMYL never auto-edited — invariant');
row('ymyl', 'state-law compliance judgment', 'human', null, null, 'TX/CA/NY/FL vary — bot flags federal landmines only');

// ── REPORTING ────────────────────────────────────────────────────────────────
row('reporting', 'client-readable weekly rollup (white-label)', 'ready-fix', 'src/report-client.mjs', 'reportClient');
row('reporting', 'dashboard bundle (sections null + hints when artifacts missing)', 'ready-fix', 'src/dashboard.mjs', 'buildDashboardBundle');

// ── self-verification ────────────────────────────────────────────────────────
export async function verifyRegistry(rows = R) {
  const out = [];
  for (const r of rows) {
    if (!r.module) { out.push({ ...r, verified: r.level === 'gap' || r.level === 'human' ? 'n/a' : 'BROKEN' }); continue; }
    try {
      const mod = await import(pathToFileURL(join(ROOT, r.module)).href);
      const ok = r.fn ? (r.fn in mod) : Object.keys(mod).length > 0;
      out.push({ ...r, verified: ok ? 'ok' : 'BROKEN' });
    } catch { out.push({ ...r, verified: 'BROKEN' }); }
  }
  return out;
}

const SATISFIED = new Set(['auto', 'ready-fix', 'terminal', 'human']);
export function summarize(rows) {
  const broken = rows.filter((r) => r.verified === 'BROKEN');
  const buildQueue = rows.filter((r) => !SATISFIED.has(r.level));
  const byLevel = {};
  for (const r of rows) byLevel[r.level] = (byLevel[r.level] || 0) + 1;
  return { total: rows.length, byLevel, broken: broken.length, brokenRows: broken, buildQueue, satisfied: rows.length - buildQueue.length };
}

export async function seoParity({ log = console.log } = {}) {
  const rows = await verifyRegistry();
  const s = summarize(rows);
  const dir = join(ROOT, 'reports');
  mkdirSync(dir, { recursive: true });
  const md = [
    '# SEO-PARITY — every master-SEO job, machine-verified', '',
    `Rows: ${s.total} · satisfied (auto/ready-fix/terminal/human): ${s.satisfied} · BUILD QUEUE: ${s.buildQueue.length} · BROKEN: ${s.broken}`, '',
    ...Object.entries(rows.reduce((m, r) => ((m[r.area] ||= []).push(r), m), {})).flatMap(([area, rs]) => [
      `## ${area}`,
      '| job | level | module | verified | note |', '|---|---|---|---|---|',
      ...rs.map((r) => `| ${r.job} | ${r.level} | ${r.module ? `${r.module}${r.fn ? '#' + r.fn : ''}` : '—'} | ${r.verified} | ${r.note || ''} |`),
      '',
    ]),
    '## BUILD QUEUE (below ready-fix — the goal\'s remaining work)',
    ...(s.buildQueue.length ? s.buildQueue.map((r) => `- [${r.area}] ${r.job} (${r.level}) — ${r.note || 'promote to ready-fix'}`) : ['(empty — parity reached)']),
  ].join('\n');
  writeFileSync(join(dir, 'seo-parity.md'), md);
  writeFileSync(join(dir, 'seo-parity.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary: { total: s.total, byLevel: s.byLevel, broken: s.broken, satisfied: s.satisfied, buildQueue: s.buildQueue.length }, rows }, null, 2));
  log(`seo-parity: ${s.total} rows · ${s.satisfied} satisfied · ${s.buildQueue.length} in build queue · ${s.broken} BROKEN → reports/seo-parity.md`);
  return { rows, summary: s };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { summary } = await seoParity({});
  if (summary.broken > 0) { console.error('BROKEN rows:', summary.brokenRows.map((r) => r.job).join(' · ')); process.exit(1); }
}
