// seo-bot · verifier — scores a client 0-100 against the definition-of-done rubric
// ("progress toward perfect"). The daily loop runs this and blocks regressions; the
// owner reads the gaps to know what's left. A compliance violation caps the score at
// 50 — a "perfect" bot cannot be one with a breach.
//
// Rubric (see research/seo-bot-definition-of-done.md):
//   connectors 20 · worksheet 15 · technical/audit 10 · citations 5 ·
//   content 20 · ai-visibility 20 · stat-sig wins 10 · zero-violations 5 (gate)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { connectionStatus } from './connect/google.mjs';
import { actionable } from './tactics/registry.mjs';

const readJson = (p) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null; } catch { return null; } };

export function verifyBot(cfg, { log = () => {} } = {}) {
  const dir = join(ROOT, 'reports', cfg.name);
  const conn = connectionStatus(cfg.name);
  const worksheet = readJson(join(dir, 'worksheet.json'));
  const contentPlan = readJson(join(dir, 'content-plan.json'));
  const citations = readJson(join(dir, 'citations.json'));
  const decisionsExist = existsSync(join(dir, 'decisions.ndjson'));
  const aiTrend = existsSync(join(ROOT, 'reports', cfg.name, 'ai-visibility')) || existsSync(join(ROOT, 'data', 'ai-visibility', 'trend.csv'));

  const comp = {};
  const gaps = [];

  // 1. Connectors (20). Capped at 10 until hardened (encrypted tokens at rest + the OAuth
  //    consent screen moved to In-Production) — a Testing-mode connection silently loses
  //    its refresh token after 7 days, so full credit there would be a lie.
  let c = 0;
  if (conn.connected) {
    if (/analytics/.test(conn.scopes || '')) c += 7;
    if (/webmasters/.test(conn.scopes || '')) c += 7;
    if (/business/.test(conn.scopes || '')) c += 6;
  } else gaps.push('Connect Google (GA4+GSC+GBP): `connect ' + cfg.name + '`');
  if (!cfg.ga4?.propertyId) gaps.push('Set ga4.propertyId in config');
  const hardened = conn.encrypted && cfg.connectorsProductionReady === true;
  if (!hardened) { c = Math.min(c, 10); if (conn.connected) gaps.push('Harden connectors for full credit: set SEO_BOT_SECRET_KEY (encrypt tokens) + move the OAuth consent screen to In-Production + set connectorsProductionReady:true (Testing-mode tokens expire in 7 days).'); }
  comp.connectors = c;

  // 2. Worksheet / config completeness (15)
  let w = 0;
  if (cfg.listings?.canonicalNap) w += 4; else gaps.push('Capture + confirm canonical NAP (listings.canonicalNap)');
  if (cfg.vertical === 'medspa') w += 2; else gaps.push('Set vertical:medspa + service/location path regexes');
  if ((cfg.services?.length || 0) > 0) w += 3; else gaps.push('Add services[] with real prices');
  if ((cfg.promptPanel?.length || 0) >= 20) w += 3; else gaps.push('Expand promptPanel to 30-50 non-branded prompts');
  if (cfg.contentReviewer || cfg.listings?.canonicalNap?.reviewer) w += 3; else gaps.push('Name the YMYL medical reviewer (one-click-approve owner)');
  comp.worksheet = w;

  // 3. Technical / audit (10) — from the worksheet baseline or a saved report
  const baseline = worksheet?.baseline ?? null;
  comp.audit = baseline == null ? 0 : baseline >= 90 ? 10 : Math.round((baseline / 100) * 10);
  if (baseline == null) gaps.push('Run `audit` + `run --apply` to capture a baseline');
  else if (baseline < 90) gaps.push(`Lift audit score ${baseline}→90 (apply auto fixes)`);

  // 4. Citations (5)
  const citeDone = (citations?.rows || []).filter((r) => r.status === 'done').length;
  comp.citations = citations ? Math.min(5, citeDone) : 0;
  if (citeDone < 3) gaps.push('Claim tier-1 entity graph (GBP + Apple Business Connect + Bing Places)');

  // 5. Content shipped (20) — plan + scored, gated drafts
  comp.content = contentPlan ? 4 : 0; // plan exists = partial; full credit needs gated published pages
  if (!contentPlan) gaps.push('Generate content plan: `content plan ' + cfg.name + '`');
  else gaps.push('Draft + gate + one-click-approve content (full credit once gated pages ship)');

  // 6. AI visibility (20): baseline captured (6) + REAL AI traffic arriving (up to +14),
  //    consuming the Sturm AI-referral signal so it's load-bearing, not decorative.
  const runLatest = readJson(join(dir, 'run-latest.json'));
  const aiSess = runLatest?.aiReferralSessions || 0;
  let av = aiTrend ? 6 : 0;
  if (aiTrend && aiSess > 0) av += Math.min(14, 6 + Math.floor(aiSess / 20)); // no baseline captured → award NO traffic credit (can't attribute it)
  comp.aiVisibility = Math.min(20, av);
  if (!aiTrend) gaps.push('Capture AI-visibility baseline: `measure ' + cfg.name + '`');
  else if (!aiSess) gaps.push('Grow AI-referral sessions (GA4) + linked-citation rate vs baseline (Sturm signal)');

  // 7. Statistically-significant wins (10)
  comp.statSig = decisionsExist ? 4 : 0;
  if (!decisionsExist) gaps.push('Run the stats controller once GSC/GA4 data accrues (weekly, at locked horizons)');

  // 8. Zero violations (5) — gate, wired to the real content-scores ledger:
  //    a violation = a PUBLISHED page that failed the compliance gate.
  let violation = false;
  const scoresPath = join(dir, 'content-scores.ndjson');
  if (existsSync(scoresPath)) {
    for (const l of readFileSync(scoresPath, 'utf-8').trim().split('\n').filter(Boolean)) {
      try { const j = JSON.parse(l); if (j.published && j.complianceFail) violation = true; } catch { /* */ }
    }
  }
  comp.zeroViolations = violation ? 0 : 5;
  if (violation) gaps.unshift('VIOLATION: a published page failed the compliance gate — score capped at 50');

  let score = Object.values(comp).reduce((a, b) => a + b, 0);
  if (violation) score = Math.min(50, score);
  const perfect = score >= 90 && !violation;

  log(`\n  ── ${cfg.brand}: ${score}/100 toward "perfect" ${perfect ? '✅' : ''} ──`);
  for (const [k, v] of Object.entries(comp)) log(`    ${k.padEnd(14)} ${v}`);
  if (gaps.length) { log(`\n  Next to move the score:`); gaps.slice(0, 10).forEach((g) => log(`    ☐ ${g}`)); }
  log('');
  return { score, perfect, components: comp, gaps, autoTactics: actionable(cfg).length };
}
