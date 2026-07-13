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

import { loadDotEnv } from '../src/env.mjs';
loadDotEnv(); // non-overriding: shell/launchd/Task Scheduler env always beats the file

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
    log(`  moat    <client> [--service X --city Y]  /cost/[service]/[city] data-moat page plans + gated sample drafts (report-only; publishing rides the gated content path)`);
    log(`  autopilot <client> [--push] [--n 3]  propose→policy→VERIFIER CONSENSUS→push (PR only); plan unless --push`);
    log(`  brief   [client] [--hours 24]  daily oversight brief — what changed, flags, rollback (portfolio if no client)`);
    log(`  weekly  <client> [--push]  the autonomous weekly cycle: read-loop → consensus autopilot → dashboard sync → brief (cron target)`);
    log(`  dashboard <client> [--push|--pull|--sync|--bundle] [--apply --yes] [--local]  publish 3-tier approvals + pull decisions (default: sync); --bundle builds+publishes the artifact bundle only`);
    log(`  apply-approved <client> [--yes]  apply ONLY dashboard-approved changes as PRs (journaled)`);
    log(`  migrate <client> --old <sitemap|urls|old-base> [--new <sitemap|base>]  old-site→new-site redirect map + configs + handoff (preserve link equity)`);
    log(`  cro     <client>           booking-funnel leak audit (tel:/CTA/form/trust + GA4 conv + Clarity)`);
    log(`  geogrid <client> [--kw "botox"] [--grid 5] [--radius 3] [--dry]  local map-pack rank grid (ATRP/SoLV/heatmap)`);
    log(`  local   <client>           local map-pack factor assessment (2026 model) + review-velocity math → reports/<client>/local.md`);
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
    log(`  priors  [--rebuild]           cross-client Beta priors by {changeClass, vertical} (anonymized) → reports/_portfolio/priors.json+md`);
    log(`  probe   <prospectUrl>         detect OTTO/Search Atlas pixel → "what OTTO hides from ChatGPT" sales report`);
    log(`  crawlbudget <client>          server-log crawl-budget + crawl-to-cite (needs cfg.logs.drainUrl)`);
    log(`  agents  <client> [--log <file>] [--format combined|json]  AI-crawler log intelligence: verified-vs-spoofed matrix, never-fetched pages, crawl→cite lag`);
    log(`  content optimize <client> <file> --query "<q>" [--serp]   SERP-grounded content score + term-gap fixes`);
    log(`  offsite <client> [--no-llm]   off-domain mention engine: mention-gap + listicle radar + wire discipline → human worksheet (nothing auto-sends)`);
    log(`  fanout-plan <client> [--max N] [--no-stubs]   fan-out coverage matrix (captured>synthetic sub-queries × pages, RRF k=60) → gaps → gated brief stubs`);
    log(`  blog-radar  <client> [--topic "<t>"] [--urls a,b] [--max N]   reverse-engineer the blogs that RANK for a topic → LOCALIZED content brief (original draft rides content gates + PR; no scrape-and-spin). No --topic = list blog-intent topic opportunities from GSC demand.`);
    log(`  blog-post   <client> [--topic "<t>"] [--dry-run] [--max-week N]   AUTO-POST one gated blog post: draft (claude CLI) → HUMANIZER (slop-lint + rewrite pass) → gates (capsule, near-dup, sourced $, weekly cap) → append app/blog/posts.ts → PR auto-merged. YMYL held for human.`);
    log(`  content-journey <client> [--weeks 13] [--per-week 3] [--start YYYY-MM-DD]   build the dated posting calendar from GSC striking-distance + fan-out sub-queries + harvested corpus (easy→hard).`);
    log(`  blog-corpus <client> [--sites N] [--posts N] [--no-llm]   harvest the WINNING competitor blogs: ranked clinics from the panel+atlas resolved to VERIFIED sites, ALL posts sitemap-first, then distill their VOICE (quant profile + exemplars) as training data → research/blog-corpus/<client>/ (voice-profile.json feeds blog-post drafting automatically).`);
    log(`  content-cohort <client>   the statistical guardrail: snapshot cohort impressions vs site total; a collapsed cohort share flips content-pause.flag → blog-post refuses to post until it recovers.`);
    log(`  outreach   <client> [--dry-run] [--live] [--max N]   the SENDING outreach agent — reads offsite-worksheet targets, drafts pitches, compliance-lint, ROUND-ROBIN send via the configured Gmail mailboxes (Mini). Nothing sends without --live AND cfg.outreach.autoSend=true.`);
    log(`  connect-mailbox <email>   grant the Gmail SEND scope for ONE mailbox (per-account OAuth). Verifies you signed in as the exact email typed; refuses cross-account grants. Run on the machine whose browser owns that Google session (i.e. the Mini for the two your-mini-account@/your-agency-account@ accounts).`);
    log(`  serp-radar <client> [--cities N|"a,b"] [--queries "q1|q2"] [--max N] [--harvest] [--no-fingerprint]   GOOGLE lane: stealth top-10 organic per city × money queries (uule geo-pinned, block-aware, cooldown-gated) → who ranks, with WHICH pages (home/service/blog), shared tactic fingerprint (schema/FAQ/stars/city-titles/depth) → research/serp-playbook/<client>/PLAYBOOK.md. --harvest pulls the winners' FULL blogs into blog-corpus + rebuilds the voice.`);
    log(`  offsite-map <client>   OFF-PAGE lane: from the SERP + ChatGPT data already captured, map the directories + press every winner appears on (where to get listed / earn mentions), gaps flagged → research/serp-playbook/<client>/OFFSITE-MAP.md. No new network.`);
    log(`  fanout-atlas <client> [--cities N] [--prompt "best med spas in {city}"] [--tiers low,medium,high]   ChatGPT fan-out ATLAS across US med-spa markets: WHO it ranks #1..N per city + the sub-queries it fires + the sites it pulls from most → reports/fanout-atlas/atlas.md. Governor-paced (safe), resumable across runs.`);
    log(`  query-bank <client> [--cities N|list] [--queries best,botox] [--variants v1,v2] [--engines chatgpt] [--tiers low] [--concurrency 3] [--max N] [--report-only]   In-house "Peec AI": run the prompt bank (queries × SPELLING variants × engines × tiers × cities) into a panel, then decompose how the ranking varies by DAY / SPELLING / ENGINE → reports/query-bank/<client>/report.md. Multi-tab concurrent on ChatGPT, resumable.`);
    log(`  heal    <client> [--engine chatgpt|perplexity] [--prompt "<q>"]  self-healing capture: claude -p + Playwright MCP finds relocated fan-out fields, PROPOSES the new recipe (reports/ only, never edits src/; run from your own shell — nested claude sessions 401)`);
    log(`  seo-parity                 GOAL: master-SEO job matrix, self-verified (zero BROKEN required) → reports/seo-parity.md`);
    log(`  evidence-audit [client]    GOAL: scan artifacts for naked point estimates (rate without CI/denominator/suppression) — exit 1 on violations`);
    log(`  thread-radar <client>      GOAL: AI-cited UGC threads where client is absent + earnable backlink targets (toxic-vetoed) + competitor gap → human worksheet`);
    log(`  co-citation <client>       GOAL: who appears NEXT TO us in AI answers (explicit denominators; insufficient below 5 answers) + competitor-cluster gaps`);
    log(`  bing-grounding <client> --file <csv>   GOAL: ingest Bing WMT grounding-queries export (first-party fan-out visibility; refuses without the file)`);
    log(`  experiments {status|graduate} <client> [--yes]  self-driving experiment registry; graduate opens the winner's SOURCE PR with the full evidence bundle (PR-only, never merges, wordpress refused)`);
    log(`  (apply adapters: cms.type = edge | cloudflare-worker — server-rendered write-back, no JS pixel)`);
    log(`  onpage-coverage            E9: self-verifying on-page coverage matrix → reports/onpage-coverage.md`);
    log(`  promotion <client>         E9: auto-lane promotion worksheet (which change-classes EARNED it) — never edits config`);
    log(`  ── E10: offsite-execute ──`);
    log(`  offsite-exec <client> [--execute] [--yes]  off-page mechanical bucket: listings payloads/sync + NAP drift + newsroom mirror + IndexNow (real-diff only) + monitoring + ONE human worksheet. --execute alone = dry-run; --yes writes (journaled)`);
    log(`  research tweet <id>        scrape an X post + score its credibility (claim, not fact)`);
    log(`  research fetch <url|id>    acquisition only (tweet/RSS/HTML; stealth-escalates)`);
    log(`  research score "<text>" --source x:@handle [--traced] [--corroborators a,b]`);
    log(`  compile-knowledge [--dir research/] [--out <file>]  research CLAIM:/EVIDENCE:/TIER: tags → diff vs engine → HUMAN worksheet (never writes rules.mjs/registry)`);
    log(`  ── 100x round 2 (autonomy + E1091) ──`);
    log(`  schedule {install|run|status|remove} [--daily HH:MM] [--weekly "DAY HH:MM"] [--clients a,b] [--kind daily|weekly]  laptop autonomy: Task Scheduler (missed runs fire on wake); weekly pushes ONLY for clients with autopilot.push=true`);
    log(`  ── autonomous ops (Mini) ──`);
    log(`  intake {connect|watch|status|github|mail|gmail|pair}  ZERO-CLICK CLIENT INTAKE, 3 lanes: GSC grant → auto-onboard · GitHub invite → accept+clone+pair (PR lane) · Gmail catch-all → C-suite surface (never clicks links). One-time: connect (your-agency-account consent) · gmail --app-password · GH_TOKEN in env. pair <client> --repo <o/n|path> wires cms.repoPath manually`);
    log(`  escalate --title "<t>" [--severity critical|warning|info] [--area x] [--detail d] [--link url]  post a BIG issue to the C-suite Slack channel (24h dedupe; wrapper/scripts door)`);
    log(`  slack-test [--channel C…]   verify Slack wiring end-to-end (bot token → webhook fallback); exit 1 if undeliverable`);
    log(`  lane-health [--stale-hours N]  judge both capture lanes from artifacts; a lane quiet >24h escalates once`);
    log(`  drift   <client>           fan-out drift linter: stale/missing year + modifier tokens vs CAPTURED fan-outs → advisory report + low-sev proposals`);
    log(`  reddit-resources <client> [--topics a,b]  /<topic>-reddit-resources draft pages (curated real threads only, cap 10, human-gated — never auto-publishes)`);
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

  // ===== autonomy verbs: client intake · C-suite escalation · slack wiring =====
  if (command === 'intake') {
    // THE HANDOFF PROTOCOL (three lanes, each independent — a missing credential in one
    // never blocks the others):
    //   gsc    — dev grants Search Console to your-agency@example.com → site auto-onboards
    //   github — dev invites the your-agency-account GitHub account → invite ACCEPTED via API → repo
    //            cloned → paired to the client config → PR lane live
    //   mail   — everything else that lands in the inbox (hosting invites, credentials) →
    //            surfaced to the C-suite channel; the bot NEVER clicks email links
    const sub = _[1] || 'watch';
    const { intakeConnect, intakeWatch, intakeStatus } = await import('../src/intake/watch.mjs');
    if (sub === 'connect') { await intakeConnect({ log, hint: flags.hint ? String(flags.hint) : (process.env.SEO_BOT_INTAKE_EMAIL || null) }); return; }
    if (sub === 'status') {
      await intakeStatus({ log });
      const { ghToken } = await import('../src/intake/github.mjs');
      const { loadGmailCreds } = await import('../src/intake/mail.mjs');
      log(`  github: ${ghToken() ? 'PAT set (GH_TOKEN)' : 'NOT configured — set GH_TOKEN (classic PAT, repo scope, your-agency-account account)'}`);
      const gm = loadGmailCreds();
      log(`  gmail:  ${gm?.user ? `configured (${gm.user})` : 'NOT configured — `intake gmail --app-password "…"`'}`);
      return;
    }
    if (sub === 'gmail') {
      // store the app password (encrypted) — Google account → 2-Step Verification → App passwords
      const { saveGmailCreds, intakeMail } = await import('../src/intake/mail.mjs');
      const pw = flags['app-password'] ? String(flags['app-password']).replace(/\s+/g, '') : null;
      if (!pw) { log('usage: intake gmail --app-password "xxxx xxxx xxxx xxxx" [--user your-agency@example.com] [--test]'); process.exitCode = 1; return; }
      const user = flags.user ? String(flags.user) : (process.env.SEO_BOT_INTAKE_EMAIL || null);
      if (!user) { log('  need --user <agency-gmail> (or set SEO_BOT_INTAKE_EMAIL in .env)'); process.exitCode = 1; return; }
      const r = saveGmailCreds({ user, appPassword: pw });
      log(`  ✅ gmail credential stored → ${r.file} ${r.encrypted ? '(encrypted at rest)' : '⚠ set SEO_BOT_SECRET_KEY and re-run'}`);
      if (flags.test) { const t = await intakeMail({ log }); log(t.ok ? `  ✅ imap OK — ${t.checked} new message(s)` : `  ❌ ${t.note}`); process.exitCode = t.ok ? 0 : 1; }
      return;
    }
    if (sub === 'pair') {
      // manual pairing door for repos the heuristic could not match unambiguously
      const clientName = _[2];
      const repoArg = flags.repo ? String(flags.repo) : null;
      if (!clientName || !repoArg) { log('usage: intake pair <client> --repo <owner/name | /abs/path>'); process.exitCode = 1; return; }
      const { pairRepoToClient, cloneRepo, ghToken, clientsDir } = await import('../src/intake/github.mjs');
      let repoPath = repoArg;
      if (!repoArg.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(repoArg) && repoArg.includes('/')) {
        const token = ghToken();
        if (!token) { log('  need GH_TOKEN to clone owner/name — or pass a local --repo path'); process.exitCode = 1; return; }
        const c = cloneRepo(repoArg, { token, log });
        if (!c.ok) { log(`  clone failed: ${c.error}`); process.exitCode = 1; return; }
        repoPath = c.dest;
        log(`  cloned → ${repoPath} (clients dir: ${clientsDir()})`);
      }
      const p = pairRepoToClient(clientName, repoPath);
      if (!p.ok) { log(`  ${p.error}`); process.exitCode = 1; return; }
      log(`  ✅ paired: ${clientName} → ${repoPath} (cms: ${p.cms.type}, PR branch prefix ${p.cms.branchPrefix})`);
      return;
    }
    if (sub === 'github') {
      const { intakeGithub } = await import('../src/intake/github.mjs');
      const r = await intakeGithub({ log, dryRun: !!flags['dry-run'] });
      if (!r.ok) { log(`  intake/github: ${r.note}`); process.exitCode = 1; }
      return;
    }
    if (sub === 'mail') {
      const { intakeMail } = await import('../src/intake/mail.mjs');
      const r = await intakeMail({ log });
      if (!r.ok) { log(`  intake/mail: ${r.note}`); process.exitCode = 1; }
      return;
    }
    if (sub === 'watch') {
      // all three lanes, each honest about its own missing credential
      const results = {};
      try { results.gsc = await intakeWatch({ log, dryRun: !!flags['dry-run'] }); if (!results.gsc.ok) log(`  intake/gsc: ${results.gsc.note}`); }
      catch (e) { log(`  intake/gsc failed: ${String(e.message || e).slice(0, 140)}`); }
      try { const { intakeGithub } = await import('../src/intake/github.mjs'); results.github = await intakeGithub({ log, dryRun: !!flags['dry-run'] }); if (!results.github.ok) log(`  intake/github: ${results.github.note}`); }
      catch (e) { log(`  intake/github failed: ${String(e.message || e).slice(0, 140)}`); }
      try { const { intakeMail } = await import('../src/intake/mail.mjs'); results.mail = await intakeMail({ log }); if (!results.mail.ok) log(`  intake/mail: ${results.mail.note}`); }
      catch (e) { log(`  intake/mail failed: ${String(e.message || e).slice(0, 140)}`); }
      // exit 1 only when EVERY lane is unusable (a fresh install before any credentials)
      if (!Object.values(results).some((r) => r && r.ok)) process.exitCode = 1;
      return;
    }
    log('usage: intake {connect|watch|status|github|mail|gmail|pair} [--dry-run]');
    return;
  }

  if (command === 'escalate') {
    // Shell/wrapper door into the C-suite Slack lane. Best-effort by design (exit 0 unless --strict):
    // an unreachable Slack must never fail the run that was trying to REPORT a failure.
    const { escalate } = await import('../src/escalate.mjs');
    const r = await escalate(null, {
      severity: String(flags.severity || 'warning'), area: String(flags.area || 'engine'),
      title: String(flags.title || _.slice(1).join(' ') || ''), detail: String(flags.detail || ''),
      link: flags.link ? String(flags.link) : null, client: flags.client ? String(flags.client) : null,
    }, { log });
    if (!r.delivered) log(`  escalate: ${r.note}`);
    if (flags.strict && !r.delivered && r.note !== 'deduped (24h)') process.exitCode = 1;
    return;
  }

  if (command === 'slack-test') {
    const { notifyTargets, postSlack } = await import('../src/notify.mjs');
    const { hostname } = await import('node:os');
    const t = notifyTargets({}, process.env);
    log(`  transports: bot-token ${t.botToken ? 'SET' : '—'} · webhook ${t.webhook ? 'SET' : '—'} · #csuite ${t.channels.csuite || '—'} · #approvals ${t.channels.approvals || '—'}`);
    const target = { botToken: t.botToken, channel: flags.channel ? String(flags.channel) : (t.channels.csuite || t.channels.approvals), webhook: t.webhook };
    const r = await postSlack(target, {
      text: 'seo-bot slack-test — wiring OK',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ *seo-bot Slack wiring OK* — from \`${hostname()}\` at ${new Date().toISOString()}` } }],
    });
    log(r.delivered ? '  ✅ delivered' : `  ❌ not delivered: ${r.note}`);
    process.exitCode = r.delivered ? 0 : 1;
    return;
  }

  if (command === 'lane-health') {
    // Daily lane check: a capture lane that's been QUIET >24h (and not merely mid-cooldown for a
    // moment) escalates ONCE (dedupe) — dead Chrome, expired login, or a hard cap gets seen same-day.
    const { judgeLane, escalate } = await import('../src/escalate.mjs');
    const fsL = await import('node:fs'); const { join: joinL } = await import('node:path'); const { ROOT: rL } = await import('../src/config.mjs');
    const stale = Number(flags['stale-hours']) || 24;
    const clients = listConfigs().filter((n) => !['_e2e', 'example.client'].includes(n));
    let bad = 0, seen = 0;
    for (const c of clients) {
      for (const lane of [
        { name: `chatgpt/query-bank (${c})`, dir: joinL(rL, 'reports', 'query-bank', c), newest: 'observations.ndjson' },
        { name: `google/serp-radar (${c})`, dir: joinL(rL, 'research', 'serp-playbook', c), newest: 'serp-observations.ndjson' },
      ]) {
        let lastCaptureMs = null, cooldownMs = null;
        try { lastCaptureMs = fsL.statSync(joinL(lane.dir, lane.newest)).mtimeMs; } catch { /* lane never wrote here */ }
        try { cooldownMs = Number(fsL.readFileSync(joinL(lane.dir, '.cooldown'), 'utf8').trim()) || null; } catch { /* no stamp */ }
        if (lastCaptureMs == null && cooldownMs == null) continue; // lane never ran for this client — not an issue
        seen++;
        const j = judgeLane({ name: lane.name, lastCaptureMs, cooldownMs, nowMs: Date.now(), staleHours: stale });
        log(`  ${j.ok ? '✓' : '✗'} ${lane.name}: ${j.note}`);
        if (!j.ok) { bad++; await escalate(null, { severity: 'warning', area: 'capture-lane', title: `Capture lane quiet — ${lane.name}`, detail: j.note }, { log }); }
      }
    }
    log(bad ? `  ${bad}/${seen} lane(s) unhealthy — escalated.` : `  lanes healthy (${seen} checked).`);
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
    for (const f of ['run.mjs', 'integration.mjs', 'no-cloud.mjs']) { try { execFileSync('node', [pjoin(testDir, f)], { stdio: 'inherit' }); } catch { ok = false; } }
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

  // ===== E7: experiment throughput + auto-graduation =====
  if (command === 'experiments') {
    const sub = _[1]; const clientName = _[2];
    if (!sub || !clientName) { log('usage: experiments {status|graduate} <client> [--yes]'); return; }
    const c = loadConfig(clientName);
    if (sub === 'status') {
      const { summarize, currentExperiments } = await import('../src/experiments/registry.mjs');
      const s = summarize(c.name);
      log(`  ${s.total} experiment(s)${s.total ? `: ${Object.entries(s.by).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}`);
      for (const e of currentExperiments(c.name)) log(`    [${e.status}] ${e.id} · ${e.template} (${e.variantField}) — horizon ${e.lockedHorizonDate}${e.graduatedAt ? ` · graduated ${e.graduatedAt.slice(0, 10)}` : ''}`);
    } else if (sub === 'graduate') {
      const { graduatePromoted } = await import('../src/experiments/graduate.mjs');
      const r = await graduatePromoted(c, { log, confirm: !!flags.yes });
      if (r.refused.length) for (const x of r.refused) log(`    ⛔ ${x.experimentId}: ${x.reason}`);
    } else log('usage: experiments {status|graduate} <client> [--yes]');
    return;
  }
  // ===== end E7 =====

  if (command === 'portfolio') {
    const { portfolio } = await import('../src/portfolio.mjs');
    await portfolio({ log });
    return;
  }
  // ===== E6: portfolio-priors =====
  if (command === 'priors') {
    const { runPriors } = await import('../src/portfolio-priors.mjs');
    await runPriors({ log, rebuild: !!flags.rebuild });
    return;
  }
  // ===== end E6 =====
  if (command === 'probe') {
    if (!_[1]) { log('usage: probe <prospectUrl>  — detect OTTO/Search Atlas pixel → "what OTTO hides from ChatGPT" report'); process.exit(1); }
    const { competitorProbe } = await import('../src/competitor-probe.mjs');
    await competitorProbe(_[1], { log });
    return;
  }

  // ===== E8: knowledge-compiler =====
  if (command === 'compile-knowledge') {
    const { compileKnowledge } = await import('../scripts/compile-knowledge.mjs');
    await compileKnowledge({
      dir: typeof flags.dir === 'string' ? flags.dir : undefined,
      out: typeof flags.out === 'string' ? flags.out : undefined,
      log,
    });
    return;
  }
  // ===== end E8 =====

  // ===== E9: onpage-100-coverage =====
  if (command === 'onpage-coverage') {
    const { runCoverage } = await import('../scripts/onpage-coverage.mjs');
    const r = await runCoverage({ log });
    if (r.broken.length) process.exit(1); // a claimed-but-missing cell is a failure, not a warning
    return;
  }
  // ===== end E9 =====

  // ===== GOAL-100X: seo-parity + evidence-audit (client-less) =====
  if (command === 'seo-parity') {
    const { seoParity } = await import('../scripts/seo-parity.mjs');
    const { summary } = await seoParity({ log });
    if (summary.broken > 0) { log(`BROKEN rows: ${summary.brokenRows.map((r) => r.job).join(' · ')}`); process.exit(1); }
    return;
  }
  if (command === 'evidence-audit') {
    const { evidenceAudit } = await import('../scripts/evidence-audit.mjs');
    const r = evidenceAudit({ client: _[1] || null, log });
    if (!r.ok) process.exit(1);
    return;
  }
  // ===== end GOAL-100X client-less =====

  // ===== 100x round 2: laptop autonomy (client-less — operates across all configured clients) =====
  if (command === 'schedule') {
    const sub = _[1] || 'status'; // install | run | status | remove
    const S = await import('../src/scheduler.mjs');
    if (sub === 'install') {
      const r = await S.installSchedule({
        clients: typeof flags.clients === 'string' ? flags.clients.split(',').map((s) => s.trim()).filter(Boolean) : null,
        daily: typeof flags.daily === 'string' ? flags.daily : '09:15',
        weekly: typeof flags.weekly === 'string' ? flags.weekly : 'SUN 10:00',
        log,
      });
      if (!r.ok) { log(`  install failed: ${r.reason || r.tasks?.filter((t) => !t.ok).map((t) => t.error).join(' · ')}`); process.exit(1); }
    } else if (sub === 'run') {
      const r = await S.runScheduled({ kind: flags.kind, log }); // --kind daily|weekly (what the scheduled tasks invoke)
      process.exit(r.ok ? 0 : 1); // Task Scheduler "Last Run Result" stays honest
    } else if (sub === 'remove') {
      const r = await S.removeSchedule({ log });
      if (!r.ok) { log(`  ${r.reason || 'remove failed'}`); process.exit(1); }
    } else if (sub === 'status') {
      await S.scheduleStatus({ log });
    } else { log(`  unknown schedule subcommand "${sub}" (install|run|status|remove)`); process.exit(2); }
    return;
  }
  // ===== end laptop autonomy =====

  // connect-mailbox <email>: separate OAuth grant per outreach sender mailbox. Stored under the
  // client-key `mailbox-<localpart>` (matches the outreach agent's getToken key). Gmail SEND-only
  // scope. Verifies the granted account matches the email typed — refuses cross-account grants
  // (i.e. if you sign in as X but typed Y, we throw and delete the token).
  if (command === 'connect-mailbox') {
    const email = String(clientArg || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { log('usage: connect-mailbox <email> — e.g. connect-mailbox outreach@nobsmedspareviews.com'); process.exit(2); }
    const { connectGoogle, connectionStatus, getAccessToken } = await import('../src/connect/google.mjs');
    const key = `mailbox-${email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '')}`;
    const st = connectionStatus(key);
    if (st.connected && !flags.force) { log(`  ${email} already connected (scopes: ${st.scopes}). Re-run with --force to reconnect.`); return; }
    log(`  Connecting Gmail SEND scope for ${email} — a browser will open. IMPORTANT: sign in as EXACTLY ${email}.`);
    try {
      await connectGoogle(key, { scopes: ['gmail'], log });
      // Verify: hit gmail.users.getProfile and confirm the granted account equals what was typed.
      const tok = await getAccessToken(key);
      const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tok}` } });
      if (!r.ok) throw new Error(`profile verify failed (${r.status}) — the token has no gmail.send scope for this account`);
      const j = await r.json();
      const granted = String(j.emailAddress || '').toLowerCase();
      if (granted !== email) {
        // Delete the mismatched token — otherwise a "wrong-account" grant sits around silently.
        const { unlinkSync } = await import('node:fs');
        const { join: joinM } = await import('node:path');
        const { ROOT: rootM } = await import('../src/config.mjs');
        try { unlinkSync(joinM(rootM, 'secrets', `${key}.google.json`)); } catch { /* */ }
        log(`  ❌ You signed in as ${granted} but typed ${email}. Grant deleted. Re-run and pick the RIGHT account in the Google chooser.`);
        process.exitCode = 1; return;
      }
      log(`  ✅ Verified: mailbox ${email} connected (gmail.send). Ready for the outreach agent.`);
    } catch (e) { log(`  ❌ ${e.message}`); process.exitCode = 1; }
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
      const dir = join(ROOT, 'reports', cfg.name); mkdirSync(dir, { recursive: true });
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
    // ===== E4: data-moat pages =====
    case 'moat': {
      const { runMoat } = await import('../src/generate/moat.mjs');
      const r = await runMoat(cfg, { log, service: flags.service, city: flags.city });
      if (r.error) log('  ' + r.error);
      break;
    }
    // ===== end E4 =====
    case 'reddit-resources': {
      // Drafts only — publish rides the existing content score → approve → publish gate.
      const { runRedditResources } = await import('../src/generate/reddit-resources.mjs');
      const r = await runRedditResources(cfg, { log, topics: flags.topics ? String(flags.topics).split(',').map((s) => s.trim()).filter(Boolean) : null });
      if (r?.error) log('  ' + r.error);
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
    case 'dashboard': {
      const d = await import('../src/dashboard.mjs');
      const opts = { local: !!flags.local, apply: !!flags.apply, confirm: !!flags.yes, log };
      if (flags.bundle) await d.publishBundle(cfg, opts); // standalone artifact-bundle build (+ publish unless --local)
      else if (flags.push) await d.pushDashboard(cfg, opts);
      else if (flags.pull) await d.pullDashboard(cfg, opts);
      else await d.syncDashboard(cfg, opts);
      break;
    }
    case 'apply-approved': {
      const { applyApproved } = await import('../src/dashboard.mjs');
      await applyApproved(cfg, { confirm: !!flags.yes, log });
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
    // ===== E1: local-map-pack =====
    case 'local': {
      const { runLocal } = await import('../src/local/index.mjs');
      await runLocal(cfg, { log });
      break;
    }
    // ===== end E1 =====
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
    // ===== E10: offsite-execute =====
    // Renamed from `offsite` at merge time: E2's mention-engine already owns that
    // command name; the mechanical execute bucket lives at `offsite-exec`.
    case 'offsite-exec': {
      const { runOffsite } = await import('../src/offsite/execute.mjs');
      await runOffsite(cfg, { log, execute: !!flags.execute, confirm: !!flags.yes });
      break;
    }
    // ===== end E10 =====
    case 'crawlbudget': {
      const { analyzeCrawlBudget } = await import('../src/crawlbudget.mjs');
      await analyzeCrawlBudget(cfg, { log });
      break;
    }
    // ===== E2: offsite-mention-engine =====
    case 'offsite': {
      // Analysis + worksheet ONLY — a human sends every pitch/wire (no --execute by design).
      const { runOffsite } = await import('../src/offsite/index.mjs');
      const { llmAvailable } = await import('../src/llm.mjs');
      const r = await runOffsite(cfg, { log, useLlm: flags['no-llm'] ? false : llmAvailable() });
      if (!r.ok) process.exitCode = 1;
      break;
    }
    // ===== end E2 =====
    // ===== E3: fanout-coverage-planner =====
    case 'fanout-plan': {
      const { runFanoutPlan } = await import('../src/fanout-planner.mjs');
      await runFanoutPlan(cfg, { log, maxPages: Number(flags.max) || 0, writeStubs: !flags['no-stubs'] });
      break;
    }
    // ===== end E3 =====
    case 'drift': {
      const { runDrift } = await import('../src/fanout-drift.mjs');
      await runDrift(cfg, { log, maxPages: Number(flags.max) || 0 });
      break;
    }
    // ===== GOAL-100X: thread-radar (client-scoped; seo-parity/evidence-audit are pre-cfg) =====
    case 'thread-radar': {
      const { threadRadar } = await import('../src/offsite/thread-radar.mjs');
      const { buildBacklinkTargets, competitorGap } = await import('../src/offsite/backlink-targets.mjs');
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { ROOT } = await import('../src/config.mjs');
      const capPath = join(ROOT, 'reports', cfg.name, 'fanout-capture.json');
      const captures = existsSync(capPath) ? (JSON.parse(readFileSync(capPath, 'utf8')).rows || []) : [];
      const srcPath = join(ROOT, 'reports', cfg.name, 'sources.json');
      const sourcesReport = existsSync(srcPath) ? JSON.parse(readFileSync(srcPath, 'utf8')) : null;
      if (!captures.length && !sourcesReport) { log('thread-radar: no fanout-capture.json or sources.json yet — run a capture/sources pass first (fail-closed, nothing fabricated)'); process.exitCode = 1; break; }
      const tr = threadRadar(captures, cfg, { log });
      const bt = buildBacklinkTargets(captures, sourcesReport, cfg);
      const gap = competitorGap(captures, sourcesReport, cfg);
      const dir = join(ROOT, 'reports', cfg.name); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'thread-radar.json'), JSON.stringify({ generatedAt: new Date().toISOString(), threads: tr, backlinkTargets: { earnable: bt.earnable.slice(0, 50), vetoed: bt.vetoed }, competitorGap: gap.slice(0, 30) }, null, 2));
      const md = ['# Thread radar + backlink targets', '', `Threads (client absent, AI-cited): ${tr.rows.length}`,
        ...tr.rows.map((r) => `- [${r.citedIn}×] ${r.url}${r.manualOnly ? ' (draft failed compliance — manual only)' : ''}`), '',
        `## Earnable backlink targets (score = cites × attainability; toxic vetoed with reason)`,
        '| domain | class | cites | score | veto |', '|---|---|---|---|---|',
        ...bt.rows.slice(0, 40).map((r) => `| ${r.domain} | ${r.class} | ${r.cites} | ${r.score} | ${r.toxic ? r.toxicWhy : ''} |`), '',
        `## Competitor gap (cites competitors, not us)`, ...gap.slice(0, 20).map((r) => `- ${r.domain} (${r.competitorCites} competitor cite(s))`),
        '', '_Human executes everything: replies posted from a real, disclosed account; links EARNED, never bought._'].join('\n');
      writeFileSync(join(dir, 'thread-radar.md'), md);
      log(`thread-radar: ${tr.rows.length} threads · ${bt.earnable.length} earnable targets · ${gap.length} competitor-gap domains → reports/${cfg.name}/thread-radar.md`);
      break;
    }
    case 'content-journey': {
      // Build (or refresh) the dated per-client content journey from real signals.
      const { topicsFromSignals, buildContentJourney, renderJourneyMd } = await import('../src/content/journey.mjs');
      const { pullGSC } = await import('../src/gsc.mjs');
      const fsJ = await import('node:fs'); const { join: joinJ } = await import('node:path'); const { ROOT: rJ } = await import('../src/config.mjs');
      const gsc = await pullGSC(cfg, { log });
      const stri = gsc.enabled ? (gsc.strikingDistance || []).slice(0, 30) : [];
      // fan-out sub-queries: from the query-bank panel report if present (thin ok).
      const panel = joinJ(rJ, 'reports', 'query-bank', cfg.name, 'observations.ndjson');
      const fan = fsJ.existsSync(panel) ? fsJ.readFileSync(panel, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { const r = JSON.parse(l); return (r.subqueries || []).map((q) => ({ q, n: 1 })); } catch { return []; } }) : [];
      // corpus topics from the harvested competitor blogs if we have them.
      const cdir = joinJ(rJ, 'research', 'blog-corpus', cfg.name);
      let corpusT = [];
      if (fsJ.existsSync(cdir)) {
        const { corpusTopics } = await import('../src/content/blog-corpus.mjs');
        const sites = fsJ.readdirSync(cdir).filter((f) => f.endsWith('.json') && f !== 'INDEX.md').map((f) => JSON.parse(fsJ.readFileSync(joinJ(cdir, f), 'utf8')));
        corpusT = corpusTopics(sites, { ourTitles: [] });
      }
      const topics = topicsFromSignals({ strikingDistance: stri, fanoutSubqueries: fan, corpusTopics: corpusT, city: cfg.city || '' });
      const perWeek = Number(flags['per-week']) || cfg.content?.postsPerWeek || 3;
      const weeks = Number(flags.weeks) || 13;
      const start = String(flags.start || new Date().toISOString().slice(0, 10));
      const j = buildContentJourney(topics, { startDate: start, weeks, perWeek });
      const out = joinJ(rJ, 'reports', cfg.name, 'content-journey.json');
      fsJ.mkdirSync(joinJ(rJ, 'reports', cfg.name), { recursive: true });
      fsJ.writeFileSync(out, JSON.stringify(j, null, 2));
      fsJ.writeFileSync(joinJ(rJ, 'reports', cfg.name, 'content-journey.md'), renderJourneyMd(j, { brand: cfg.brand || cfg.name }));
      log(`  content-journey: ${j.status} · ${j.rows?.length || 0} posts planned · ${perWeek}/week · ${weeks}wk → ${out}`);
      break;
    }
    case 'blog-corpus': {
      // Harvest the winning competitor blogs: ranked clinics from the panel + fanout-atlas,
      // resolved to VERIFIED sites (guess + LLM fallback), ALL posts sitemap-first, then the
      // voice profile is distilled as training data (voice-profile.json + voice.md).
      const { runBlogCorpus } = await import('../src/content/blog-corpus.mjs');
      const { complete } = await import('../src/llm.mjs');
      const fsC = await import('node:fs'); const { join: joinC } = await import('node:path'); const { ROOT: rC } = await import('../src/config.mjs');
      const readNdjson = (p) => fsC.existsSync(p) ? fsC.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
      const observations = readNdjson(joinC(rC, 'reports', 'query-bank', cfg.name, 'observations.ndjson'));
      const atlas = readNdjson(joinC(rC, 'reports', 'fanout-atlas', 'atlas.ndjson'));
      if (!observations.length && !atlas.length) { log('blog-corpus: no query-bank panel or fanout-atlas yet — run `query-bank <client>` first'); process.exitCode = 1; break; }
      const dir = joinC(rC, 'research', 'blog-corpus', cfg.name);
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const fetchOne = async (u) => { await sleep(400); try { const r = await fetch(u, { headers: { 'User-Agent': 'seo-bot/1.0 (+contact via nobsmedspareviews.com)' }, signal: AbortSignal.timeout(15000) }); return r.ok ? await r.text() : null; } catch { return null; } };
      const r = await runBlogCorpus(cfg, { observations, atlas, fs: fsC, dir, fetchOne, llm: flags['no-llm'] ? null : complete, log, maxSites: Number(flags.sites) || 20, maxPosts: Number(flags.posts) || 40 });
      log(`  blog-corpus: ${r.status} · ${r.harvested} sites harvested (${r.clinics ?? 0} clinics, ${r.unresolved ?? 0} unresolved)${r.voice ? ` · voice: ${r.voice}` : ''} → ${dir}`);
      break;
    }
    case 'content-cohort': {
      // The statistical guardrail — pause posting if the cohort is decaying.
      const { runCohortGuardrail } = await import('../src/content/cohort-guardrail.mjs');
      const { pullGSC } = await import('../src/gsc.mjs');
      const fsCg = await import('node:fs'); const { join: joinCg } = await import('node:path'); const { ROOT: rCg } = await import('../src/config.mjs');
      const gsc = await pullGSC(cfg, { log });
      if (!gsc.enabled) { log('content-cohort: GSC not connected — cannot judge cohort without impressions'); process.exitCode = 1; break; }
      const reg = cfg.cms?.repoPath ? fsCg.readFileSync(joinCg(cfg.cms.repoPath, 'app/blog/posts.ts'), 'utf8') : '';
      const dir = joinCg(rCg, 'reports', cfg.name);
      const r = runCohortGuardrail(cfg, { gscPages: gsc.pages, registrySource: reg, fs: fsCg, dir, log });
      log(`  content-cohort: verdict ${r.judgement.verdict} — ${r.judgement.reason}`);
      break;
    }
    case 'outreach': {
      // The SENDING outreach agent (email lane). autoSend gated by cfg.outreach.autoSend + --live.
      const { runOutreach, sendViaGmail } = await import('../src/outreach/agent.mjs');
      const { getAccessToken } = await import('../src/connect/google.mjs');
      const { complete } = await import('../src/llm.mjs');
      const fsO = await import('node:fs'); const { join: joinO } = await import('node:path'); const { ROOT: rO } = await import('../src/config.mjs');
      const wsPath = joinO(rO, 'reports', cfg.name, 'offsite-worksheet.json');
      if (!fsO.existsSync(wsPath)) { log('outreach: no offsite-worksheet.json — run the offsite pipeline to produce targets first'); process.exitCode = 1; break; }
      const ws = JSON.parse(fsO.readFileSync(wsPath, 'utf8'));
      const targets = Array.isArray(ws.rows) ? ws.rows : [];
      const dir = joinO(rO, 'reports', cfg.name);
      const cfgSend = flags.live ? cfg : { ...cfg, outreach: { ...(cfg.outreach || {}), autoSend: false } }; // --live is the ONLY way to actually send
      const r = await runOutreach(cfgSend, { targets, deps: { fs: fsO, dir, llm: complete, send: (from, msg) => sendViaGmail(from, msg, { getToken: getAccessToken }), log }, dryRun: !!flags['dry-run'], maxSends: flags.max != null ? Number(flags.max) : null });
      log(`  outreach: ${r.sent} sent · ${r.outbox} in outbox · ${r.skipped.length} skipped · autoSend=${r.autoSend}`);
      break;
    }
    case 'blog-post': {
      // AUTO-POSTING: brief → draft (claude CLI) → anti-slop gates → append posts.ts → PR →
      // auto-merge. YMYL posts open a HELD PR instead (flag-only). --dry-run = full pipeline, no writes.
      const { publishBlogPost } = await import('../src/content/blog-publish.mjs');
      const { complete } = await import('../src/llm.mjs');
      const fsB = await import('node:fs');
      const { execSync } = await import('node:child_process');
      const { join } = await import('node:path');
      const { ROOT } = await import('../src/config.mjs');
      let brief = null;
      if (flags.topic) brief = { topic: String(flags.topic) };
      else { // newest saved blog-radar brief
        const bdir = join(ROOT, 'reports', cfg.name, 'blog-briefs');
        const files = fsB.existsSync(bdir) ? fsB.readdirSync(bdir).filter((f) => f.endsWith('.json')).sort() : [];
        if (files.length) brief = JSON.parse(fsB.readFileSync(join(bdir, files[files.length - 1]), 'utf8'));
      }
      if (!brief) { log('blog-post: no --topic and no saved brief (run blog-radar first)'); process.exitCode = 1; break; }
      // Voice calibration: the register learned from the #1-ranked clinics' corpus (blog-corpus).
      let voiceBlock = '';
      try { voiceBlock = JSON.parse(fsB.readFileSync(join(ROOT, 'research', 'blog-corpus', cfg.name, 'voice-profile.json'), 'utf8')).promptBlock || ''; } catch { /* no corpus yet — brand voice only */ }
      const r = await publishBlogPost(cfg, {
        brief, dryRun: !!flags['dry-run'], maxPerWeek: flags['max-week'] != null ? Number(flags['max-week']) : null,
        deps: { fs: fsB, llm: complete, log, exec: async (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe' }).toString(), pauseFlagPath: join(ROOT, 'reports', cfg.name, 'content-pause.flag'), voiceBlock },
      });
      log(`  blog-post: ${r.status}${r.post ? ` · ${r.post.slug}` : ''}${r.violations ? `\n    gates: ${r.violations.join('\n    gates: ')}` : ''}`);
      if (r.status === 'gated' || r.status === 'error' || r.status === 'no-repo' || r.status === 'no-registry') process.exitCode = 1;
      // Log every publish attempt (the C6 audit trail).
      try { fsB.appendFileSync(join(ROOT, 'reports', cfg.name, 'blog-log.ndjson'), JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n'); } catch { /* */ }
      break;
    }
    case 'blog-radar': {
      const { topicOpportunities, runBlogRadar } = await import('../src/content/blog-radar.mjs');
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { ROOT } = await import('../src/config.mjs');
      const dir = join(ROOT, 'reports', cfg.name); mkdirSync(join(dir, 'blog-briefs'), { recursive: true });
      const topic = flags.topic || flags.t || '';
      const urlsArg = String(flags.urls || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!topic) {
        const { pullGSC } = await import('../src/gsc.mjs');
        const g = await pullGSC(cfg, { log });
        if (!g.enabled) { log('  ' + g.note + ' — or run: blog-radar <client> --topic "..." --urls a,b'); process.exitCode = 1; break; }
        const opps = topicOpportunities(g.queries || [], cfg).slice(0, 25);
        const md = ['# Blog topic opportunities — blog-intent demand we are NOT capturing', '',
          '| topic | impressions | pos | opportunity |', '|---|---|---|---|',
          ...opps.map((o) => `| ${o.topic} | ${o.impressions} | ${o.position} | ${o.opportunity} |`),
          '', '_Pick one → `blog-radar <client> --topic "<topic>"` to mine the ranking pages into a localized brief._'].join('\n');
        writeFileSync(join(dir, 'blog-topics.md'), md);
        log(`  blog-radar: ${opps.length} blog-intent topic opportunities → reports/${cfg.name}/blog-topics.md`);
        opps.slice(0, 10).forEach((o) => log(`    [${o.opportunity}] ${o.topic} (${o.impressions} impr, pos ${o.position})`));
        break;
      }
      let urls = urlsArg;
      if (!urls.length) {
        const capPath = join(dir, 'fanout-capture.json');
        if (existsSync(capPath)) {
          const rows = JSON.parse(readFileSync(capPath, 'utf8')).rows || [];
          const toks = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          urls = [...new Set(rows.filter((r) => r.status === 'ok').flatMap((r) => r.citations?.urls || []))]
            .filter((u) => toks.some((t) => u.toLowerCase().includes(t)));
        }
      }
      if (!urls.length) { log(`  blog-radar: no competitor URLs for "${topic}" — pass --urls a,b,c (or run a capture first). Fail-closed.`); process.exitCode = 1; break; }
      const brief = await runBlogRadar(topic, urls, cfg, { log, max: Number(flags.max) || 6 });
      const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'topic';
      const md = [`# Content brief — ${topic}`, '', `> ${brief.note}`, '',
        `- **Local angle:** ${brief.localAngle}`, `- **Target length:** ${brief.targetWordCount || '?'} words (competitors' median +15%)`,
        `- **Competitors analyzed:** ${brief.competitorsAnalyzed}`, `- **Schema to include:** ${(brief.schemaToInclude || []).join(', ')}`, '',
        '## Consensus outline — sections ≥half the ranking pages cover (table stakes)',
        ...brief.consensusOutline.map((h) => `${'  '.repeat(Math.max(0, h.level - 2))}- ${h.text} _(${h.competitorsCovering}×)_`), '',
        '## Differentiators — only one competitor covers (your edge to own)',
        ...brief.differentiators.map((h) => `- ${h.text}`), '',
        '## Questions to answer (FAQPage schema)', ...brief.questionsToAnswer.map((q) => `- ${q}`), '',
        '## Sources mined', ...brief.sources.map((u) => `- ${u}`),
        '', '_Next: draft ORIGINAL copy to this brief → it rides content/gates (no fabrication / no GLP-1 brand claims) + human review + PR._'].join('\n');
      writeFileSync(join(dir, 'blog-briefs', `${slug}.md`), md);
      log(`  blog-radar: localized brief for "${topic}" (${brief.competitorsAnalyzed} sources) → reports/${cfg.name}/blog-briefs/${slug}.md`);
      break;
    }
    case 'serp-radar': {
      // GOOGLE lane (operator directive 2026-07-12): who ranks organic top-10 per city × money
      // queries, with what pages, using what tactics — then (--harvest) their blogs → corpus.
      // Backend: Camoufox stealth sidecar when set up (best anti-/sorry/ + Cloudflare); else a WARM
      // persistent Chrome profile (real cookies + accepted consent). Both paced + block-aware +
      // cooldown-gated. Google rate-limits ONE residential IP hard — this accrues over days, safely.
      const { runSerpRadar, renderSerpPlaybookMd, tacticFingerprint, tacticRollup, captureSerpBatch, captureSerpViaScrapling, SERP_QUERY_TEMPLATES } = await import('../src/measure/serp-radar.mjs');
      const { scraplingPaths, makeResilientFetchOne } = await import('../src/measure/scrapling.mjs');
      const { TOP_US_MEDSPA_CITIES } = await import('../src/measure/fanout-atlas.mjs');
      const fsS = await import('node:fs'); const { join: joinS } = await import('node:path'); const { ROOT: rS } = await import('../src/config.mjs');
      const dir = joinS(rS, 'research', 'serp-playbook', cfg.name);
      const cities = flags.cities && isNaN(Number(flags.cities))
        ? String(flags.cities).split(',').map((s) => s.trim()).filter(Boolean)
        : TOP_US_MEDSPA_CITIES.slice(0, Number(flags.cities) || 6);
      const templates = flags.queries ? String(flags.queries).split('|').map((s) => s.trim()).filter(Boolean) : SERP_QUERY_TEMPLATES;
      const scr = scraplingPaths();
      const googleProfile = process.env.SEO_BOT_GOOGLE_PROFILE || joinS(rS, 'google-profile');
      // Backend selection: the WARM PERSISTENT CHROME PROFILE is the default and the one that
      // actually works — proven live it gets HTTP 200 + real organic results where Camoufox (fresh
      // anti-detect context) gets Google's /sorry/ wall. A warm real browser with cookies + accepted
      // consent is the trust signal Google's anti-automation looks for. Camoufox is opt-in (--camoufox)
      // only; its real strength is Cloudflare-walled CLINIC pages (the harvest fallback below), not Google.
      const useCamoufox = flags.camoufox && scr;
      const capture = useCamoufox
        ? (sl, o) => captureSerpViaScrapling(sl, { ...o, python: scr.python, script: scr.script })
        : (sl, o) => captureSerpBatch(sl, { ...o, userDataDir: googleProfile });
      log(`  serp-radar backend: ${useCamoufox ? 'Camoufox stealth sidecar' : 'warm Chrome profile'} · ${cities.length} cities × ${templates.length} queries`);
      // Google is fragile: default to a SMALL per-run slice (safe on one IP); accrual loop repeats it.
      const r = await runSerpRadar(cfg, { cities, templates, fs: fsS, dir, capture, log, maxPerRun: Number(flags.max) || 6 });
      if (r.cooling) break;
      // Harvesting: plain fetch first, Camoufox fallback for Cloudflare-walled clinic sites.
      const fetchOneS = makeResilientFetchOne({ ...(scr || {}), log });
      const clinicWinners = (r.winners || []).filter((w) => w.kind === 'clinic-candidate');
      const fps = [];
      if (!flags['no-fingerprint'] && clinicWinners.length) {
        const pages = clinicWinners.flatMap((w) => w.pages.slice(0, 2).map((p) => ({ ...p, city: w.cities[0] }))).slice(0, 30);
        log(`  fingerprinting ${pages.length} ranking pages (polite fetch)…`);
        for (const p of pages) { const html = await fetchOneS(p.url); const f = tacticFingerprint(html, p.url, { city: p.city }); if (f) fps.push(f); }
      }
      const rollup = tacticRollup(fps);
      fsS.writeFileSync(joinS(dir, 'PLAYBOOK.md'), renderSerpPlaybookMd({ winners: r.winners, rollup, fps, cities, observations: r.observations }, { nowIso: new Date().toISOString() }));
      log(`  serp-radar: +${r.captured} SERPs (accrued ${r.accrued}/${r.totalCells})${r.halted ? ' · HALTED → cooldown' : ''} · ${clinicWinners.length} clinic winners · ${fps.length} pages fingerprinted → ${dir}/PLAYBOOK.md`);
      // --harvest: the SERP winners' FULL blogs join the same corpus + voice as the ChatGPT lane.
      if (flags.harvest && clinicWinners.length) {
        const { harvestBlog } = await import('../src/content/blog-corpus.mjs');
        const { buildVoiceArtifacts } = await import('../src/content/voice.mjs');
        const cdir = joinS(rS, 'research', 'blog-corpus', cfg.name);
        fsS.mkdirSync(cdir, { recursive: true });
        for (const w of clinicWinners.slice(0, Number(flags.sites) || 15)) {
          const hb = await harvestBlog(w.domain, { fetchOne: fetchOneS, maxPosts: Number(flags.posts) || 40, log });
          if (hb.posts.length) fsS.writeFileSync(joinS(cdir, `${w.domain.replace(/[^a-z0-9.-]/g, '_')}.json`), JSON.stringify({ harvestedAt: new Date().toISOString(), kind: 'serp-winner', name: w.domain, serpScore: w.score, ...hb }, null, 2));
          log(`  [serp-harvest] ${w.domain}: ${hb.status} · ${hb.posts.length} posts`);
        }
        const sites = fsS.readdirSync(cdir).filter((f) => f.endsWith('.json') && !/^voice/.test(f)).map((f) => { try { return JSON.parse(fsS.readFileSync(joinS(cdir, f), 'utf8')); } catch { return null; } }).filter((s) => s && s.kind !== 'cited-source');
        const va = buildVoiceArtifacts(sites, { fs: fsS, dir: cdir, cities });
        if (va) log(`  voice rebuilt over ${va.profile.sites} clinic sites: ${va.summary}`);
      }
      break;
    }
    case 'offsite-map': {
      // OFF-PAGE lane: derive the off-page surface map (directories + press the winners appear on)
      // from the SERP + ChatGPT data we already captured. No backlink crawler, no new network.
      const { offsiteSurfaceMap, renderOffsiteMapMd } = await import('../src/measure/offsite-radar.mjs');
      const fsO = await import('node:fs'); const { join: joinO } = await import('node:path'); const { ROOT: rO } = await import('../src/config.mjs');
      const readNd = (p) => fsO.existsSync(p) ? fsO.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
      const serpObs = readNd(joinO(rO, 'research', 'serp-playbook', cfg.name, 'serp-observations.ndjson'));
      const cgObs = [...readNd(joinO(rO, 'reports', 'query-bank', cfg.name, 'observations.ndjson')), ...readNd(joinO(rO, 'reports', 'fanout-atlas', 'atlas.ndjson'))];
      if (!serpObs.length && !cgObs.length) { log('offsite-map: no SERP or ChatGPT observations yet — run serp-radar / query-bank first'); process.exitCode = 1; break; }
      const ourDomain = (cfg.baseUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const map = offsiteSurfaceMap({ serpObservations: serpObs, chatgptObservations: cgObs, ourDomain });
      const dir = joinO(rO, 'research', 'serp-playbook', cfg.name);
      fsO.mkdirSync(dir, { recursive: true });
      fsO.writeFileSync(joinO(dir, 'OFFSITE-MAP.md'), renderOffsiteMapMd(map, { brand: cfg.brand || cfg.name, ourDomain }));
      fsO.writeFileSync(joinO(dir, 'offsite-map.json'), JSON.stringify({ builtAt: new Date().toISOString(), map }, null, 2));
      const gaps = map.filter((s) => s.gap).length;
      log(`  offsite-map: ${map.length} off-page surfaces · ${gaps} gaps (we're absent) → ${dir}/OFFSITE-MAP.md`);
      break;
    }
    case 'fanout-atlas': {
      const { runFanoutAtlas, TOP_US_MEDSPA_CITIES } = await import('../src/measure/fanout-atlas.mjs');
      const fsMod = await import('node:fs');
      const { join } = await import('node:path');
      const { ROOT } = await import('../src/config.mjs');
      const dir = join(ROOT, 'reports', 'fanout-atlas');
      const nCities = Number(flags.cities) || 5;
      const cities = TOP_US_MEDSPA_CITIES.slice(0, Math.max(1, nCities));
      const tiers = (flags.tiers ? String(flags.tiers).split(',') : ['default']).map((s) => s.trim()).filter(Boolean);
      // --prompt "best med spas in {city}" runs one flagship prompt across the cities; --prompts a|b for
      // several. Omit → the full MEDSPA_PROMPT_TEMPLATES set. {city} is filled per market.
      const templates = flags.prompt ? [String(flags.prompt)]
        : (flags.prompts ? String(flags.prompts).split('|').map((s) => s.trim()).filter(Boolean) : undefined);
      log(`  fan-out atlas: ${cities.length} cities × ${templates ? templates.length : 'all'} prompt(s) × ${tiers.length} tier(s) — logged-in ChatGPT, governor-paced.`);
      const r = await runFanoutAtlas(cfg, { cities, templates, tiers, fs: fsMod, dir, log });
      log(`\n  fan-out atlas: +${r.captured} captured this run · ${r.accrued} total accrued · ${r.halted ? 'PAUSED (hit ChatGPT limit — resume next run)' : 'run complete'}`);
      log(`  → ${r.docPath}`);
      break;
    }
    case 'query-bank': {
      // Our in-house "Peec AI": run the query bank (queries × spelling variants × engines × tiers ×
      // cities) into the panel, then rebuild the variance report. Multi-tab concurrent on ChatGPT.
      const { runQueryBank } = await import('../src/measure/query-bank-runner.mjs');
      const { MEDSPA_QUERY_BANK, MEDSPA_CITIES } = await import('../src/measure/query-bank.mjs');
      const { buildQueryBankReport } = await import('../src/measure/query-bank-analytics.mjs');
      const fsMod = await import('node:fs');
      const { join } = await import('node:path');
      const { ROOT } = await import('../src/config.mjs');
      const dir = join(ROOT, 'reports', 'query-bank', cfg.name);
      const listFlag = (v) => (v == null ? undefined : String(v).split(',').map((s) => s.trim()).filter(Boolean));
      const overrides = {};
      if (flags.cities != null) overrides.cities = /^\d+$/.test(String(flags.cities)) ? MEDSPA_CITIES.slice(0, Math.max(1, Number(flags.cities))) : listFlag(flags.cities);
      if (flags.queries) overrides.queries = listFlag(flags.queries);
      if (flags.variants) overrides.variants = listFlag(flags.variants);
      if (flags.engines) overrides.engines = listFlag(flags.engines);
      if (flags.tiers) overrides.tiers = listFlag(flags.tiers);
      // --report-only rebuilds the report from the existing panel (no capture, no browser, no IP use).
      if (flags['report-only'] || flags.report) {
        fsMod.mkdirSync(dir, { recursive: true });
        const ndjson = join(dir, 'observations.ndjson');
        const rows = fsMod.existsSync(ndjson) ? fsMod.readFileSync(ndjson, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
        const md = buildQueryBankReport(rows, { generatedAt: new Date().toISOString(), clientBrand: cfg.brand || '' });
        fsMod.writeFileSync(join(dir, 'report.md'), md);
        log(`  query-bank report rebuilt from ${rows.length} observations → ${join(dir, 'report.md')}`);
        break;
      }
      const concurrency = Math.max(1, Number(flags.concurrency) || 3);
      const maxPerRun = flags.max != null ? Number(flags.max) : null;
      log(`  query-bank: client ${cfg.name} · overrides ${JSON.stringify(overrides)} · concurrency ${concurrency}`);
      const r = await runQueryBank(cfg, { bank: MEDSPA_QUERY_BANK, overrides, concurrency, maxPerRun, fs: fsMod, dir, log });
      log(`\n  query-bank: +${r.captured} captured this run · ${r.accrued} total observations · ${r.halted ? 'PAUSED (hit ChatGPT limit — resume next run)' : 'run complete'}`);
      log(`  → ${r.docPath}`);
      break;
    }
    case 'co-citation': {
      const { coCitations, competitorClusterGaps } = await import('../src/measure/co-citation.mjs');
      const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { ROOT } = await import('../src/config.mjs');
      const capPath = join(ROOT, 'reports', cfg.name, 'fanout-capture.json');
      if (!existsSync(capPath)) { log('co-citation: no fanout-capture.json yet — run a capture pass first (fail-closed)'); process.exitCode = 1; break; }
      const captures = JSON.parse(readFileSync(capPath, 'utf8')).rows || [];
      const cc = coCitations(captures, cfg);
      const gaps = competitorClusterGaps(captures, cfg);
      const dir = join(ROOT, 'reports', cfg.name); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'co-citation.json'), JSON.stringify({ generatedAt: new Date().toISOString(), coCitations: cc, competitorClusterGaps: gaps.rows || [] }, null, 2));
      if (cc.status !== 'ok') { log(`co-citation: ${cc.status} — ${cc.note || ''} (answers: ${cc.answersAnalyzed})`); break; }
      const md = ['# Co-citation — who appears next to us in AI answers', '', `Answers analyzed: ${cc.answersAnalyzed} · answers where we appear: ${cc.ourAnswers}`, '',
        '| domain | total | with us | with competitors | share |', '|---|---|---|---|---|',
        ...cc.rows.slice(0, 30).map((r) => `| ${r.domain}${r.isCompetitor ? ' (competitor)' : ''} | ${r.total} | ${r.withUs} | ${r.withCompetitors} | ${r.share} |`), '',
        '## Competitor-cluster gaps (paired with competitors, never with us)',
        ...((gaps.rows || []).slice(0, 15).map((r) => `- ${r.domain} (${r.withCompetitors} co-citations with competitors)`))].join('\n');
      writeFileSync(join(dir, 'co-citation.md'), md);
      log(`co-citation: ${cc.rows.length} domains over ${cc.answersAnalyzed} answers → reports/${cfg.name}/co-citation.md`);
      break;
    }
    case 'bing-grounding': {
      const { ingestGrounding } = await import('../src/data/bing-grounding.mjs');
      const r = ingestGrounding(cfg, { file: typeof flags.file === 'string' ? flags.file : null, log });
      if (!r.ok) process.exitCode = 1;
      break;
    }
    // ===== end GOAL-100X =====
    // ===== HEAL: self-healing capture escalation (claude -p + Playwright MCP, propose-only) =====
    case 'heal': {
      const { runHeal } = await import('../src/measure/heal.mjs');
      const engine = typeof flags.engine === 'string' ? flags.engine : 'chatgpt';
      const samplePrompt = typeof flags.prompt === 'string' ? flags.prompt : `best ${cfg.vertical || 'med spa'} near me 2026`;
      const r = runHeal(cfg, { engine, samplePrompt }, { log });
      log(`heal: ${r.status}${r.report ? ` → ${r.report}` : ''}`);
      if (['failed', 'timeout', 'skipped-no-llm'].includes(r.status)) process.exitCode = 1;
      break;
    }
    // ===== end HEAL =====
    // ===== E5: agent-analytics =====
    case 'agents': {
      const { agentAnalytics } = await import('../src/agent-analytics.mjs');
      const r = await agentAnalytics(cfg, { log, source: typeof flags.log === 'string' ? flags.log : undefined, format: typeof flags.format === 'string' ? flags.format : 'auto', fetchRanges: !flags['no-verify'] });
      if (!r.ok) process.exitCode = 1;
      break;
    }
    // ===== end E5 =====
    // ===== E9: onpage-100-coverage =====
    case 'promotion': {
      const { writePromotionWorksheet } = await import('../src/policy-promotion.mjs');
      const cands = flags.classes ? String(flags.classes).split(',').map((s) => s.trim()).filter(Boolean) : [];
      await writePromotionWorksheet(cfg, { log, candidateClasses: cands });
      break;
    }
    // ===== end E9 =====
    default:
      log(`Unknown command: ${command}. Try: seo-bot help`);
      process.exit(1);
  }
}

main().catch((err) => { console.error('seo-bot failed:', err); process.exit(1); });
