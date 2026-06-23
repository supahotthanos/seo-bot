// seo-bot · decide — turn audit findings into concrete, reviewable fix proposals.
//
// Philosophy (post-May-2026 core update + Google S-BERT/S-CTS AI-spam detection):
// we do NOT generate bulk content. We propose STRUCTURAL fixes (meta length,
// schema, alt, canonical, answer capsules derived from the page's OWN existing
// text, question headings). LLM is used only to *tighten/rephrase real content*,
// never to invent claims — and every proposal is human-reviewed before apply.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { runAudit } from './audit.mjs';
import { countWords, nowIso, sameSite } from './util.mjs';
import { rankProposals } from './priority.mjs';

/** Trim a string to <= max chars on a word boundary, keeping it sentence-ish. */
export function tightenText(s, max) {
  if (!s) return s;
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max);
  cut = cut.replace(/[\s.,;:–—|-]+\S*$/, '').trim();
  return cut;
}

async function llm(prompt, { maxTokens = 700 } = {}) {
  // Routes through the Claude Code subscription (claude -p) by default — no API key.
  const { complete } = await import('./llm.mjs');
  let ctx = {};
  try { ctx = (await import('./cost.mjs')).getCostContext() || {}; } catch { /* */ }
  return complete(prompt, {
    system: 'You are an on-page SEO/AEO editor. Rewrite ONLY using facts present in the provided content. Never invent statistics, claims, awards, or superlatives. Output exactly what is asked, nothing else.',
    maxTokens, client: ctx.client, tag: ctx.tag || 'decide',
  });
}

/** Build fix proposals from a fresh audit. */
export async function buildProposals(cfg, { log = () => {} } = {}) {
  try { const { setCostContext } = await import('./cost.mjs'); setCostContext({ client: cfg.name, tag: 'propose' }); } catch { /* telemetry only */ }
  const r = await runAudit(cfg, { log });
  const proposals = [];
  let pid = 0;
  const useLLM = !!process.env.ANTHROPIC_API_KEY;
  log(`Generating proposals${useLLM ? ' (LLM-assisted)' : ' (deterministic — no ANTHROPIC_API_KEY)'} …`);

  for (const page of r.pages) {
    if (!page.parsed) continue;
    const p = page.parsed;
    const rules = new Set(page.findings.map((f) => f.rule));

    // 1) Meta description too long → clamp (deterministic; LLM tightens if available)
    if (rules.has('meta-description') && p.metaLen > cfg.audit.metaMax) {
      let proposed = tightenText(p.metaDesc, cfg.audit.metaMax);
      if (useLLM) {
        const out = await llm(`Rewrite this meta description to <= ${cfg.audit.metaMax} characters, leading with a direct answer, no superlatives, no "best/#1". Keep it factual to the original. Return ONLY the rewritten description.\n\nORIGINAL (${p.metaLen} chars): ${p.metaDesc}`, { maxTokens: 200 });
        if (out && out.length <= cfg.audit.metaMax + 5) proposed = out.replace(/^["']|["']$/g, '');
      }
      proposals.push({ id: ++pid, type: 'meta', page: page.url, severity: 'low', autoApplicable: true,
        current: p.metaDesc, proposed, rationale: `Meta was ${p.metaLen} chars; clamp to <= ${cfg.audit.metaMax} to avoid SERP truncation.` });
    }

    // 2) Missing answer block → draft a 40-60 word capsule from the page's OWN text
    if (rules.has('answer-block')) {
      let proposed = null;
      if (useLLM) {
        const src = (p.answerText || '').slice(0, 1200);
        proposed = await llm(`Write a single ${cfg.audit.answerWordsMin}-${cfg.audit.answerWordsMax} word direct-answer capsule to place at the very top of this page. Use ONLY facts from the content below. Answer-first, plain, no superlatives. Return ONLY the capsule.\n\nPAGE TITLE: ${p.title}\nCONTENT: ${src}`, { maxTokens: 200 });
      }
      proposals.push({ id: ++pid, type: 'answer-block', page: page.url, severity: 'high', autoApplicable: false,
        current: p.answerText?.slice(0, 160) || '(none)', proposed: proposed || `(Add a ${cfg.audit.answerWordsMin}-${cfg.audit.answerWordsMax} word direct answer to the page's core question, derived from existing content.)`,
        rationale: 'Answer-first capsule = Layer-2 citation lever for AI engines.' });
    }

    // 3) Question headings missing → propose query-shaped H2s
    if (rules.has('question-headings')) {
      let proposed = null;
      if (useLLM) {
        proposed = await llm(`Suggest 3 H2 headings phrased as real user questions for this page, each answerable from its content. No superlatives. Return as 3 lines, no numbering.\n\nTITLE: ${p.title}\nFIRST TEXT: ${(p.answerText || '').slice(0, 600)}`, { maxTokens: 150 });
      }
      proposals.push({ id: ++pid, type: 'question-headings', page: page.url, severity: 'medium', autoApplicable: false,
        current: '(no question-form headings)', proposed: proposed || '("How much does {service} cost in {city}?", "{service} vs {alt}?", "What to expect")',
        rationale: 'Each question heading maps to a query-fan-out sub-query (RRF retrieval).' });
    }

    // 4) Images missing alt → flag for alt authoring (LLM cannot see images; human/CMS supplies)
    if (rules.has('img-alt')) {
      proposals.push({ id: ++pid, type: 'img-alt', page: page.url, severity: 'low', autoApplicable: false,
        current: `${p.imgsMissingAlt}/${p.imgCount} missing alt`, proposed: 'Add descriptive alt text per image (e.g., "{business} — {treatment} room, {city}").',
        rationale: 'Alt text = accessibility + image/answer signal; cheap on-page win.' });
    }

    // 5) Freshness → add dateModified + visible "Updated <Month> 2026"
    if (rules.has('freshness')) {
      proposals.push({ id: ++pid, type: 'freshness', page: page.url, severity: 'medium', autoApplicable: false,
        current: p.modified || '(no dateModified)', proposed: 'Emit dateModified in Article/WebPage JSON-LD and render "Updated {Month} 2026" near the H1.',
        rationale: 'Cited content skews fresher; freshness is a strong AI-citation correlate.' });
    }

    // 6) Title length
    if (rules.has('title') && p.titleLen > cfg.audit.titleMax) {
      proposals.push({ id: ++pid, type: 'title', page: page.url, severity: 'medium', autoApplicable: true,
        current: p.title, proposed: tightenText(p.title, cfg.audit.titleMax), rationale: `Title ${p.titleLen} chars; clamp to <= ${cfg.audit.titleMax}, keyword first.` });
    }
  }

  // Site-level proposals
  for (const fn of r.siteFindings) {
    if (fn.rule === 'schema-type' || fn.rule === 'ai-crawler-block' || fn.rule === 'sitemap') {
      proposals.push({ id: ++pid, type: fn.rule, page: r.baseUrl, severity: fn.severity, autoApplicable: false,
        current: fn.message, proposed: fn.recommendation, rationale: 'Site-level structural fix.' });
    }
  }

  return { client: cfg.name, brand: cfg.brand, baseUrl: r.baseUrl, ranAt: nowIso(), score: r.score, proposals, audit: r };
}

export function saveProposals(result) {
  rankProposals(result.proposals); // EV-rank (severity × demand × CTR-uplift ÷ effort) so the highest-leverage fixes lead
  const dir = join(ROOT, 'seo-bot', 'reports', result.client);
  mkdirSync(dir, { recursive: true });
  const stamp = result.ranAt.replace(/[:.]/g, '-');
  const json = join(dir, `proposals-${stamp}.json`);
  const md = join(dir, `proposals-latest.md`);
  writeFileSync(json, JSON.stringify({ ...result, audit: undefined, proposals: result.proposals }, null, 2));

  const L = [`# Fix proposals — ${result.brand}`, `${result.baseUrl} · score ${result.score}/100 · ${result.proposals.length} proposals · ${new Date(result.ranAt).toUTCString()}`, ''];
  const auto = result.proposals.filter((p) => p.autoApplicable);
  const manual = result.proposals.filter((p) => !p.autoApplicable);
  L.push(`**${auto.length} auto-applicable** · ${manual.length} need human authoring/review`, '');
  for (const grp of [['Auto-applicable', auto], ['Needs review', manual]]) {
    if (!grp[1].length) continue;
    L.push(`## ${grp[0]}`, '');
    for (const p of grp[1]) {
      L.push(`### #${p.id} · ${p.type} · ${p.severity} · EV ${p.priority ?? '—'}`);
      L.push(`- **Page:** ${p.page}`);
      L.push(`- **Now:** ${String(p.current).slice(0, 200)}`);
      L.push(`- **Proposed:** ${String(p.proposed).slice(0, 400)}`);
      L.push(`- **Why:** ${p.rationale}`);
      L.push('');
    }
  }
  writeFileSync(md, L.join('\n'));
  return { json, md };
}

/** CLI entry: build + save proposals. */
export async function propose(cfg, { log = () => {} } = {}) {
  const result = await buildProposals(cfg, { log });
  const { md } = saveProposals(result);
  log(`\n  ${result.proposals.length} proposals (${result.proposals.filter((p) => p.autoApplicable).length} auto-applicable).`);
  log(`  Proposals → ${md}\n`);
  return result;
}
