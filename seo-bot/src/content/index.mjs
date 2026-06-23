// seo-bot · content — the data-to-draft pipeline front door.
//   content plan  <client>            → a service×geo content plan (Sturm compact-keyword grid + blogs)
//   content score <client> <file>     → run the anti-slop gates on a draft (+ its .brief.json)
//   content draft <client> <topic>    → LLM-assisted draft from a brief (graceful; never auto-publishes)
//
// Nothing here publishes on its own. Drafts land status=draft and route to a
// one-click-approve queue (founders@cnai.digital) for any YMYL/medical/price claim.

import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso, slugify } from '../util.mjs';
import { CONTENT_TEMPLATES } from './templates.mjs';
import { scoreContent } from './gates.mjs';
import { optimizeDraft, saveOptimizeReport } from './optimize.mjs';

const DEFAULT_SERVICES = ['Botox', 'Dermal fillers', 'Morpheus8', 'HydraFacial', 'Laser hair removal', 'CoolSculpting', 'Microneedling', 'Chemical peel'];

/** Build a service×geo content plan. Compact-keyword BOFU pages + supporting blogs. */
export function contentPlan(cfg, { log = () => {} } = {}) {
  const services = cfg.services?.map((s) => (typeof s === 'string' ? s : s.name)) || DEFAULT_SERVICES;
  const geos = cfg.serviceAreaGeos?.length ? cfg.serviceAreaGeos : [cfg.brand.replace(/.*\bin\b/i, '').trim() || 'your city'];
  const plan = [];
  for (const svc of services) for (const geo of geos) {
    plan.push({ type: 'compact_keyword', targetQuery: `${svc.toLowerCase()} cost ${geo}`, url: `/${svc.toLowerCase().replace(/\s+/g, '-')}-${geo.toLowerCase().replace(/\s+/g, '-')}`, ymyl: true });
  }
  for (const svc of services) {
    plan.push({ type: 'cost_guide', targetQuery: `how much does ${svc.toLowerCase()} cost`, url: `/cost/${svc.toLowerCase().replace(/\s+/g, '-')}`, ymyl: true });
    plan.push({ type: 'treatment_explainer', targetQuery: `what is ${svc.toLowerCase()}`, url: `/treatments/${svc.toLowerCase().replace(/\s+/g, '-')}`, ymyl: true });
  }

  const L = [`# Content plan — ${cfg.brand}`, `${plan.length} pages · ${new Date().toUTCString()}`, '',
    `> Data-grounded, gated, human-approved (YMYL). Compact-keyword pages = Edward Sturm BOFU (service×city). Ship on a jittered human cadence (3-5/wk), never bursty.`, ''];
  const byType = plan.reduce((m, p) => { (m[p.type] ||= []).push(p); return m; }, {});
  for (const [type, items] of Object.entries(byType)) {
    L.push(`## ${CONTENT_TEMPLATES[type]?.name || type} (${items.length})`);
    for (const p of items.slice(0, 40)) L.push(`- [ ] \`${p.url}\` — target: "${p.targetQuery}"${p.ymyl ? ' · YMYL→approve' : ''}`);
    L.push('');
  }
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'content-plan.md'), L.join('\n'));
  writeFileSync(join(dir, 'content-plan.json'), JSON.stringify({ client: cfg.name, generatedAt: nowIso(), plan }, null, 2));
  log(`  Content plan: ${plan.length} pages (${Object.entries(byType).map(([t, i]) => `${i.length} ${t}`).join(', ')})`);
  log(`  → ${join(dir, 'content-plan.md')}`);
  return plan;
}

/** Score a draft file (+ optional <file>.brief.json) against the anti-slop gates. */
export function contentScore(cfg, file, { log = () => {} } = {}) {
  if (!existsSync(file)) { log(`  draft not found: ${file}`); return null; }
  const draft = readFileSync(file, 'utf-8');
  const briefPath = file.replace(/\.(md|html|txt)$/, '') + '.brief.json';
  const brief = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, 'utf-8')) : {};
  const r = scoreContent(draft, brief, { priorTexts: [], reviewers: cfg.reviewers });
  log(`\n  ${basename(file)} — score ${r.score}/100 ${r.publishEligible ? '✅ publish-eligible (pending human approve)' : '⛔ NOT eligible'}`);
  log(`  hard gates: ${r.hardPass ? 'all pass' : 'FAIL → ' + r.hardFails.join(', ')}`);
  log(`  soft: ${Object.entries(r.components).map(([k, v]) => `${k}:${Math.round(v * 100)}%`).join('  ')}`);
  log(`  stats: ${r.stats.words}w · ${r.stats.primaryCitations} primary cites · ${r.stats.unsourcedNumbers} unsourced numbers · sim ${r.stats.maxSimilarity}`);
  // Persist the outcome so the verifier reads real results (not just file existence) and
  // can detect a compliance breach (a published page that failed the compliance gate).
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name); mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'content-scores.ndjson'), JSON.stringify({ at: nowIso(), file: basename(file), score: r.score, hardPass: r.hardPass, hardFails: r.hardFails, complianceFail: !r.hard.compliance, publishEligible: r.publishEligible }) + '\n');
  return r;
}

/**
 * Content-IR optimize (Epic 7): score a draft against a query's competitor corpus
 * (Surfer/Frase-grade) and emit anti-slop term-gap fix proposals (edit real sentences
 * only). `content optimize <client> <file> --query "..."`. SERP widening is Mac-only
 * (--serp delegates to serp.mjs/stealth); off-Mac it uses free-first GSC/competitor seeds.
 */
export async function contentOptimize(cfg, file, { query, log = () => {}, serp = false } = {}) {
  if (!file) { log('  usage: content optimize <client> <file.md> --query "<target query>" [--serp (Mac-only)]'); return null; }
  if (!existsSync(file)) { log(`  draft not found: ${file}`); return null; }
  const q = query || cfg.tracking?.keywords?.[0] || cfg.promptPanel?.[0];
  if (!q) { log('  pass --query "<target query>" (or set cfg.tracking.keywords / promptPanel).'); return null; }
  const result = await optimizeDraft(cfg, { query: q, draftFile: file, allowSerp: serp, log });
  const { md } = saveOptimizeReport(cfg, result);
  log(`\n  Content optimize → ${md}`);
  log(`  ${result.proposals.length} term-gap proposal(s); all autoApplicable:false (human-reviewed). Hand-merge the constrained-rewrite patches.`);
  return result;
}

/** Human one-click approve: mark a gated draft OK to publish (YMYL gate). */
export function contentApprove(cfg, slug, { log = () => {} } = {}) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name, 'drafts');
  const draftPath = join(dir, `${slug}.md`);
  if (!existsSync(draftPath)) { log(`  draft not found: ${draftPath}`); return null; }
  const brief = existsSync(join(dir, `${slug}.brief.json`)) ? JSON.parse(readFileSync(join(dir, `${slug}.brief.json`), 'utf-8')) : {};
  const r = scoreContent(readFileSync(draftPath, 'utf-8'), brief, { priorTexts: [], reviewers: cfg.reviewers });
  if (!r.publishEligible) { log(`  ⛔ Cannot approve: draft is not publish-eligible (score ${r.score}, fails: ${r.hardFails.join(', ')}). Fix + re-score first.`); return null; }
  writeFileSync(join(dir, `${slug}.approved`), nowIso());
  log(`  ✅ Approved ${slug} (score ${r.score}/100). Run \`content publish ${cfg.name}\` to open a PR.`);
  return { approved: true };
}

/** One screen: every pending draft + its gate score + approval status (minimize human work). */
export function contentReview(cfg, { log = () => {} } = {}) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name, 'drafts');
  if (!existsSync(dir)) { log('  No drafts yet. Run `content batch ' + cfg.name + '`.'); return { pending: 0 }; }
  const slugs = [...new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')))];
  if (!slugs.length) { log('  No drafts yet.'); return { pending: 0 }; }
  let pending = 0;
  log(`\n  Content review — ${cfg.brand}`);
  for (const slug of slugs) {
    const brief = existsSync(join(dir, `${slug}.brief.json`)) ? JSON.parse(readFileSync(join(dir, `${slug}.brief.json`), 'utf-8')) : {};
    const r = scoreContent(readFileSync(join(dir, `${slug}.md`), 'utf-8'), brief, { priorTexts: [], reviewers: cfg.reviewers });
    const approved = existsSync(join(dir, `${slug}.approved`));
    const status = approved ? '✅ approved' : r.publishEligible ? '🟡 awaiting approval' : `⛔ not eligible (${r.hardFails.join(', ') || 'soft<80'})`;
    if (r.publishEligible && !approved) pending++;
    log(`    ${status.padEnd(24)} ${slug}  ${r.score}/100`);
  }
  log(`\n  ${pending} draft(s) awaiting your one-click approval → \`content approve-all ${cfg.name}\` (or \`content approve ${cfg.name} <slug>\`), then \`content publish ${cfg.name} --yes\`.`);
  return { pending };
}

/** Batch one-click approve: every publish-eligible, not-yet-approved draft at once. */
export function contentApproveAll(cfg, { log = () => {} } = {}) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name, 'drafts');
  if (!existsSync(dir)) { log('  No drafts.'); return { approved: 0 }; }
  const slugs = [...new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')))];
  let n = 0;
  for (const slug of slugs) {
    if (existsSync(join(dir, `${slug}.approved`))) continue;
    const r = contentApprove(cfg, slug, { log: () => {} });
    if (r?.approved) { n++; log(`    ✅ ${slug}`); }
  }
  log(`\n  Approved ${n} eligible draft(s). Run \`content publish ${cfg.name} --yes\` to open the PR(s).`);
  return { approved: n };
}

/** Publish approved + eligible drafts via the Next.js PR adapter (human merges). */
export async function contentPublish(cfg, { log = () => {}, confirm = false } = {}) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name, 'drafts');
  if (!existsSync(dir)) { log('  no drafts.'); return null; }
  const slugs = [...new Set(readdirSync(dir).filter((f) => f.endsWith('.approved')).map((f) => f.replace(/\.approved$/, '')))];
  if (!slugs.length) { log('  no approved drafts. Run `content approve <client> <slug>` after a one-click review.'); return null; }
  const proposals = [];
  for (const slug of slugs) {
    const draftPath = join(dir, `${slug}.md`);
    if (!existsSync(draftPath)) continue;
    proposals.push({ id: slug, type: 'content', autoApplicable: true, page: `/blog/${slug}`, fileWrite: { path: `content/blog/${slug}.md`, content: readFileSync(draftPath, 'utf-8') }, rationale: 'Approved, gate-passed med-spa content.' });
  }
  if (!proposals.length) { log('  no publishable drafts.'); return null; }
  const { applyNextjs } = await import('../apply/nextjs.mjs');
  log(`  Publishing ${proposals.length} approved draft(s) via Next.js PR${confirm ? '' : ' (preview — pass --yes to open the PR)'}…`);
  const res = await applyNextjs(cfg, { ranAt: nowIso(), score: 0, proposals }, { log, confirm });
  // Stamp the ledger with published:true so the verifier's compliance gate is LIVE
  // (a published page that failed compliance → violation → score capped at 50).
  if (confirm && (res?.applied?.length || res?.pr)) {
    for (const slug of slugs) {
      const dp = join(dir, `${slug}.md`); if (!existsSync(dp)) continue;
      const brief = existsSync(join(dir, `${slug}.brief.json`)) ? JSON.parse(readFileSync(join(dir, `${slug}.brief.json`), 'utf-8')) : {};
      const r = scoreContent(readFileSync(dp, 'utf-8'), brief, { priorTexts: [], reviewers: cfg.reviewers });
      appendFileSync(join(ROOT, 'seo-bot', 'reports', cfg.name, 'content-scores.ndjson'), JSON.stringify({ at: nowIso(), file: `${slug}.md`, published: true, complianceFail: !r.hard.compliance, score: r.score }) + '\n');
    }
  }
  return res;
}

/** Draft the whole content plan in one shot (gate each). "Continuously add blogs". */
export async function contentBatch(cfg, { log = () => {}, limit = 10 } = {}) {
  const planPath = join(ROOT, 'seo-bot', 'reports', cfg.name, 'content-plan.json');
  if (!existsSync(planPath)) { log('  No content plan. Run `content plan ' + cfg.name + '` first.'); return null; }
  const plan = (JSON.parse(readFileSync(planPath, 'utf-8')).plan || []).slice(0, limit);
  let drafted = 0, briefed = 0, eligible = 0;
  for (const item of plan) {
    const r = await contentDraft(cfg, item.targetQuery, { log: () => {} });
    if (r?.draftPath) { drafted++; if (r.score?.publishEligible) eligible++; }
    else if (r?.briefPath || r?.refused) briefed++;
  }
  log(`\n  content batch: ${plan.length} planned · ${drafted} drafted (${eligible} publish-eligible) · ${briefed} awaiting a data table.`);
  log(`  Fill the briefs in seo-bot/reports/${cfg.name}/drafts/ (real prices/quotes/sources + reviewer), then \`content score\` → \`approve\` → \`publish\`.`);
  try { const { llmAvailable, llmProvider } = await import('../llm.mjs'); log(`  ${llmAvailable() ? `(model: ${llmProvider()})` : '(no model — login to the claude CLI or set ANTHROPIC_API_KEY to auto-draft instead of brief skeletons.)'}`); } catch { /* */ }
  return { planned: plan.length, drafted, eligible, briefed };
}

function pickTemplate(topic = '') {
  const t = topic.toLowerCase();
  if (/\bvs\b|versus|compare/.test(t)) return 'comparison';
  if (/cost|price|how much/.test(t)) return 'cost_guide';
  if (/what is|how does|guide to|explain/.test(t)) return 'treatment_explainer';
  if (/\bfaq\b|questions/.test(t)) return 'faq_cluster';
  return 'compact_keyword';
}

async function llmDraft(tmpl, brief) {
  const prompt = `Write a ${tmpl.wordTarget[0]}-${tmpl.wordTarget[1]} word med-spa page in Markdown for the query "${brief.targetQuery}".
SECTIONS: ${tmpl.sections.join(' | ')}.
USE ONLY THESE FACTS (every number/claim must come from here — invent nothing):
${(brief.dataPoints || []).map((d) => '- ' + d).join('\n')}
CITE these primary sources inline as Markdown links, at least two: ${(brief.primarySources || []).join(', ')}.
Mention the city "${brief.city || ''}" at least twice. Put the exact query in the H2 and the first sentence.
End with exactly: "Medically reviewed by ${brief.author?.name}, ${brief.author?.role}. Last reviewed ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}."
RULES: no "guaranteed/permanent/cure/100% safe/miracle"; no GLP-1 brand drug names; no fabricated stats or reviews; plain, factual, varied sentences.`;
  const { complete } = await import('../llm.mjs');
  let ctx = {}; try { ctx = (await import('../cost.mjs')).getCostContext() || {}; } catch { /* */ }
  return (await complete(prompt, { system: 'You are a precise med-spa editor. Output ONLY the Markdown article, grounded strictly in the provided facts.', maxTokens: 2000, client: ctx.client, tag: 'content' })) || '';
}

/**
 * Brief-grounded draft. Builds/loads a brief, REFUSES to draft until the data table is
 * populated (anti-slop), drafts via the LLM strictly from the brief, then gates it.
 * NEVER auto-publishes. `content draft <client> "<topic>"`.
 */
export async function contentDraft(cfg, topic, { log = () => {} } = {}) {
  if (!topic) { log('  usage: content draft <client> "<topic / target query>"'); return null; }
  try { const { setCostContext } = await import('../cost.mjs'); setCostContext({ client: cfg.name, tag: 'content' }); } catch { /* telemetry only */ }
  const tmplId = pickTemplate(topic);
  const tmpl = CONTENT_TEMPLATES[tmplId];
  const slug = slugify(topic);
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name, 'drafts');
  mkdirSync(dir, { recursive: true });
  const briefPath = join(dir, `${slug}.brief.json`);
  let brief = existsSync(briefPath) ? JSON.parse(readFileSync(briefPath, 'utf-8')) : null;

  if (!brief) {
    // Never emit deprecated rich-result types (FAQPage/HowTo/QAPage lost rich results May 2026).
    const DEPRECATED_RICH = new Set(['FAQPage', 'HowTo', 'QAPage']);
    const schemaTypes = (tmpl.schemaTypes || []).filter((t) => !DEPRECATED_RICH.has(t));
    brief = { template: tmplId, title: topic, targetQuery: topic.toLowerCase(), city: cfg.serviceAreaGeos?.[0] || '', author: { name: '', role: '' }, dataPoints: [], primarySources: [], schemaTypes, hasOwnMedia: false };
    writeFileSync(briefPath, JSON.stringify(brief, null, 2));
    log(`  Wrote a brief skeleton → ${briefPath}`);
    log(`  ⛔ Refusing to draft (anti-slop): fill dataPoints (real prices/quotes/stats), author {name,role}, and ≥2 primarySources, then re-run.`);
    return { refused: true, briefPath };
  }
  if ((brief.dataPoints?.length || 0) < 3 || !brief.author?.name || (brief.primarySources?.length || 0) < 2) {
    log(`  ⛔ Brief incomplete (need ≥3 dataPoints, named author, ≥2 primarySources). Fill ${briefPath} and re-run.`);
    return { refused: true, briefPath };
  }
  const { llmAvailable } = await import('../llm.mjs');
  if (!llmAvailable()) { log(`  ✅ Brief ready (${briefPath}). No model available (install/login to the claude CLI, or set ANTHROPIC_API_KEY) to auto-draft, or hand the brief to a writer; either way it must pass \`content score\`.`); return { brief, briefPath }; }

  log(`  Drafting "${topic}" (${tmplId}) strictly from the brief…`);
  try {
    const draft = await llmDraft(tmpl, brief);
    const draftPath = join(dir, `${slug}.md`);
    writeFileSync(draftPath, draft);
    const r = scoreContent(draft, brief, { priorTexts: [], reviewers: cfg.reviewers });
    log(`  Drafted → ${draftPath} · score ${r.score}/100 ${r.publishEligible ? '✅ publish-eligible (human approve)' : '⛔ revise: ' + r.hardFails.join(', ')}`);
    appendFileSync(join(ROOT, 'seo-bot', 'reports', cfg.name, 'content-scores.ndjson'), JSON.stringify({ at: nowIso(), file: `${slug}.md`, score: r.score, hardPass: r.hardPass, hardFails: r.hardFails, complianceFail: !r.hard.compliance, publishEligible: r.publishEligible }) + '\n');
    return { brief, draftPath, score: r };
  } catch (e) { log(`  draft failed: ${String(e.message || e).slice(0, 160)}`); return null; }
}
