#!/usr/bin/env node
// seo-bot · onpage-coverage — the maintained on-page coverage MATRIX (E9).
//
// Every on-page surface × capability level {detect, propose, readyFix, autoApply}, each
// cell naming the implementing module + exported function. The script VERIFIES its own
// registry where cheap: it imports each claimed module and checks the exported function
// exists — a claimed cell whose function is missing renders BROKEN, never green
// (coverage honesty; a registry row can't lie its way to ✅).
//
// Cell shapes:
//   { module:'src/x.mjs', fn:'name', note?, gated? }  → verified by import (ok | BROKEN)
//   { human:'reason' }                                → 'human-by-design' — an HONEST
//        terminal state (needs human data/judgment/consent), not a gap.
//   (absent)                                          → GAP (renders ✗ none).
//
// autoApply cells are deliberately conservative: only lanes that exist TODAY behind the
// real gates (policy DETERMINISTIC_FIX_TYPES + E9 earned promotion; edge head-only
// EDGE_SAFE fields via cloaking-guard + verifier consensus, PR-only). Everything else is
// human-by-design — human gates every write.
//
// Usage:  node scripts/onpage-coverage.mjs        → renders reports/onpage-coverage.md
// Also exposed as `seo-bot onpage-coverage`.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LEVELS = ['detect', 'propose', 'readyFix', 'autoApply'];

const m = (module, fn, note) => ({ module, fn, ...(note ? { note } : {}) });
const gated = (module, fn, note) => ({ module, fn, gated: 'llm', ...(note ? { note } : {}) });
const human = (reason) => ({ human: reason });

/** The registry. Every claimed cell is verified by import — keep module/fn names REAL. */
export const ONPAGE_COVERAGE = [
  { id: 'titles-meta', surface: 'Titles / meta descriptions', cells: {
    detect: m('src/rules.mjs', 'auditPage'),
    propose: m('src/decide.mjs', 'buildProposals'),
    readyFix: m('src/onpage-fixes.mjs', 'titleFix', 'metaFix for descriptions; deterministic clamps of the page\'s own text'),
    autoApply: m('src/policy.mjs', 'decidePolicy', 'DETERMINISTIC_FIX_TYPES lane + verifier consensus, PR-only'),
  } },
  { id: 'heading-structure', surface: 'H1–Hn structure', cells: {
    detect: m('src/rules.mjs', 'auditPage'),
    propose: m('src/onpage-fixes.mjs', 'h1Fix'),
    readyFix: m('src/onpage-fixes.mjs', 'h1Fix', 'missing-H1 from the page\'s own title; demotions/outlines stay editorial'),
    autoApply: human('visible body text — cloaking guard forbids edge; PR merged by a human only'),
  } },
  { id: 'answer-capsules', surface: 'Answer capsules (40-60w, ≤17w sentences)', cells: {
    detect: m('src/aeo.mjs', 'auditAeo'),
    propose: m('src/aeo.mjs', 'proposeAeoFixes'),
    readyFix: gated('src/onpage-fixes.mjs', 'capsuleFix', 'LLM via src/llm.mjs; validator-checked; fails CLOSED to human queue'),
    autoApply: human('content edit on visible text — always human-reviewed before merge'),
  } },
  { id: 'passage-chunking', surface: 'Passage chunking / citability', cells: {
    detect: m('src/passage.mjs', 'scorePassages'),
    propose: m('src/passage.mjs', 'scoreChunk'),
    readyFix: gated('src/onpage-fixes.mjs', 'passageFix', 'sentence-split with identical facts; fails CLOSED to human queue'),
    autoApply: human('visible body text — human merges the PR'),
  } },
  { id: 'schema-pack', surface: 'Schema pack (Org/LocalBusiness/MedicalBusiness/Service+Offer/Person/Physician/ReserveAction/Article — comprehension-only)', cells: {
    detect: m('src/schema.mjs', 'typesFromHtml'),
    propose: m('src/rules.mjs', 'auditSite', '+ auditMedspaSite schema rules'),
    readyFix: m('src/onpage-fixes.mjs', 'schemaPackArtifact', 'articleSchemaFix per page; REAL config data only (refuses without NAP; no invented prices)'),
    autoApply: m('src/edge/cloaking-guard.mjs', 'classifyProposal', 'jsonld is head-only EDGE_SAFE; still behind --yes + verifier consensus'),
  } },
  { id: 'canonicals', surface: 'Canonicals', cells: {
    detect: m('src/rules.mjs', 'auditPage'),
    propose: m('src/onpage-fixes.mjs', 'canonicalFix'),
    readyFix: m('src/onpage-fixes.mjs', 'canonicalFix', 'self-referential insert; conflicting-canonical judgement stays human'),
    autoApply: m('src/edge/cloaking-guard.mjs', 'classifyProposal', 'canonical is EDGE_SAFE head-only; gated'),
  } },
  { id: 'redirect-maps', surface: '301 redirect maps', cells: {
    detect: m('src/migrate.mjs', 'matchUrl'),
    propose: m('src/migrate.mjs', 'buildRedirectMap'),
    readyFix: m('src/onpage-fixes.mjs', 'redirectMapArtifact', '_redirects + next.config snippet; invalid rows excluded'),
    autoApply: human('irreversible — guardIrreversible requires human confirm + snapshot; human merges'),
  } },
  { id: 'robots-sitemaps-indexnow', surface: 'robots.txt / sitemaps / IndexNow', cells: {
    detect: m('src/crawl.mjs', 'parseRobots'),
    propose: m('src/rules.mjs', 'auditSite'),
    readyFix: m('src/onpage-fixes.mjs', 'robotsSitemapArtifact', 'validated disallows only; image sitemap via image-seo.mjs'),
    autoApply: m('src/indexnow.mjs', 'pingIndexNow', 'ping-only, after human-merged changes; robots/sitemap WRITES stay human-gated'),
  } },
  { id: 'internal-linking', surface: 'Internal linking (equity/orphans/depth)', cells: {
    detect: m('src/links.mjs', 'analyzeLinks'),
    propose: m('src/sculpt.mjs', 'sculptLinks'),
    readyFix: m('src/sculpt.mjs', 'buildApplyItem', 'server-rendered <a> into a REAL existing sentence, patch {file,find,replace}'),
    autoApply: human('every anchor is needsHumanReview (anti-slop); human merges'),
  } },
  { id: 'anchor-variety', surface: 'Anchor-text variety', cells: {
    detect: m('src/rules.mjs', 'auditPage'),
    propose: m('src/anchors.mjs', 'pickAnchor'),
    readyFix: m('src/sculpt.mjs', 'buildApplyItem', 'entropy-bounded anchors ride the same patch lane'),
    autoApply: human('anchor changes touch visible text — human merges'),
  } },
  { id: 'image-seo', surface: 'Image SEO (alt, filenames, formats, image sitemap)', cells: {
    detect: m('src/image-seo.mjs', 'auditImages'),
    propose: m('src/image-seo.mjs', 'auditImages', 'autoFixable vs before/after split'),
    readyFix: m('src/onpage-fixes.mjs', 'imageAltFix', 'deterministic alt from filename+H1; REFUSES before/after (FTC/HIPAA)'),
    autoApply: human('before/after consent + alt accuracy need a human eye'),
  } },
  { id: 'cwv-code-fixes', surface: 'CWV code-level fixes', cells: {
    detect: m('src/data/pagespeed.mjs', 'cwvDiagnose'),
    propose: m('src/perf/cwv-template.mjs', 'cwvTemplatePatches'),
    readyFix: m('src/onpage-fixes.mjs', 'cwvArtifact', 'bundles template patches into one reviewable artifact'),
    autoApply: human('template/layout changes need a dev review — PR only'),
  } },
  { id: 'hreflang', surface: 'hreflang', cells: {
    detect: m('src/onpage-fixes.mjs', 'detectHreflang'),
    propose: m('src/onpage-fixes.mjs', 'hreflangFix'),
    readyFix: m('src/onpage-fixes.mjs', 'hreflangFix', 'stub from configured locales; refuses without >=2 real alternates'),
    autoApply: m('src/edge/cloaking-guard.mjs', 'classifyProposal', 'hreflang is EDGE_SAFE head-only; gated'),
  } },
  { id: 'pagination', surface: 'Pagination (rel hints + self-canonical)', cells: {
    detect: m('src/onpage-fixes.mjs', 'detectPagination'),
    propose: m('src/onpage-fixes.mjs', 'paginationFix'),
    readyFix: m('src/onpage-fixes.mjs', 'paginationFix', 'requires REAL prev/next neighbors; never guesses series order'),
    autoApply: human('wrong series hints corrupt crawl — human merges'),
  } },
  { id: 'faceted-crawl-budget', surface: 'Faceted nav / crawl budget', cells: {
    detect: m('src/crawlbudget.mjs', 'wasteBucket'),
    propose: m('src/crawlbudget.mjs', 'wasteToProposals'),
    readyFix: m('src/onpage-fixes.mjs', 'facetedDisallowRules', 'param-level disallows → robotsSitemapArtifact'),
    autoApply: human('a robots disallow can deindex — human merges'),
  } },
  { id: 'index-discipline', surface: 'Index discipline (thin/noindex/301/wait)', cells: {
    detect: m('src/index-discipline.mjs', 'decideIndex'),
    propose: m('src/index-discipline.mjs', 'indexDiscipline'),
    readyFix: m('src/onpage-fixes.mjs', 'noindexFix', 'materializes ONLY the noindex action; 301s ride the redirect map'),
    autoApply: human('de-indexing is near-irreversible — human merges; core-update freeze holds'),
  } },
  { id: 'og-twitter', surface: 'Open Graph / Twitter cards', cells: {
    detect: m('src/rules.mjs', 'auditPage'),
    propose: m('src/onpage-fixes.mjs', 'ogTwitterFix'),
    readyFix: m('src/onpage-fixes.mjs', 'ogTwitterFix', 'mirrors existing title/meta 1:1 — no new copy'),
    autoApply: m('src/edge/cloaking-guard.mjs', 'classifyProposal', 'og/twitter are EDGE_SAFE head-only; gated'),
  } },
  { id: 'breadcrumbs', surface: 'Breadcrumbs (BreadcrumbList)', cells: {
    detect: m('src/schema.mjs', 'typesFromHtml'),
    propose: m('src/onpage-fixes.mjs', 'breadcrumbSchemaFix'),
    readyFix: m('src/onpage-fixes.mjs', 'breadcrumbSchemaFix', 'derived from the real URL hierarchy'),
    autoApply: m('src/edge/cloaking-guard.mjs', 'classifyProposal', 'jsonld is EDGE_SAFE head-only; gated'),
  } },
  { id: 'freshness-real-diff', surface: 'Freshness (real-diff-guarded re-dating)', cells: {
    detect: m('src/rules.mjs', 'auditPage'),
    propose: m('src/decide.mjs', 'buildProposals'),
    readyFix: m('src/onpage-fixes.mjs', 'freshnessFix', 'REFUSES without real-content-diff evidence (June-2026 fake-refresh veto)'),
    autoApply: human('a human certifies the content update is real before re-dating ships'),
  } },
  { id: 'tfidf-content-optimization', surface: 'TF-IDF content optimization (term gaps)', cells: {
    detect: m('src/content/optimize.mjs', 'optimizeDraft'),
    propose: m('src/content/optimize.mjs', 'optimizeDraft'),
    readyFix: gated('src/onpage-fixes.mjs', 'contentOptimizeFix', 'constrained rewrites of REAL sentences; fails CLOSED to human worksheet'),
    autoApply: human('content edits are always human-reviewed (anti-slop)'),
  } },
  { id: 'a11y-overlaps', surface: 'Accessibility overlaps (lang, alt, landmarks)', cells: {
    detect: m('src/a11y.mjs', 'auditA11y'),
    propose: m('src/a11y.mjs', 'auditA11y'),
    readyFix: m('src/onpage-fixes.mjs', 'langFix', '+ imageAltFix; deterministic attribute patches'),
    autoApply: human('a11y semantics need a human check (screen-reader reality)'),
  } },
  { id: 'cro-booking-funnel', surface: 'CRO booking funnel (tel/CTA/ReserveAction)', cells: {
    detect: m('src/cro.mjs', 'auditCRO'),
    propose: m('src/cro.mjs', 'auditCRO'),
    readyFix: m('src/onpage-fixes.mjs', 'bookingActionFix', 'ReserveAction/tel from REAL config data; refuses without it'),
    autoApply: human('money paths (book/consult/pricing) are hard-gated in policy — always queue'),
  } },
  { id: 'entity-id-graph', surface: 'Entity @id graph (sameAs, shared @id)', cells: {
    detect: m('src/entity/extract.mjs', 'extractEntities'),
    propose: m('src/entity/schema-emit.mjs', 'emitAll'),
    readyFix: m('src/entity/schema-emit.mjs', 'emitEntityGraph', 'jsonld proposals with a shared @id graph'),
    autoApply: m('src/edge/cloaking-guard.mjs', 'classifyProposal', 'jsonld is EDGE_SAFE head-only; gated'),
  } },
];

/**
 * Verify the registry against reality: import every claimed module once and check the
 * exported function exists. Claimed-but-missing → status 'broken' (renders BROKEN, not ✅).
 * @returns {Promise<{rows:Array, summary:object, broken:Array}>}
 */
export async function verifyRegistry(registry = ONPAGE_COVERAGE) {
  const cache = new Map();
  const rows = [];
  for (const row of Array.isArray(registry) ? registry : []) {
    const out = { id: row.id, surface: row.surface, cells: {} };
    for (const level of LEVELS) {
      const cell = row.cells?.[level];
      if (!cell) { out.cells[level] = { status: 'none' }; continue; }
      if (cell.human) { out.cells[level] = { status: 'human-by-design', reason: cell.human }; continue; }
      if (!cell.module || !cell.fn) { out.cells[level] = { status: 'broken', reason: 'cell missing module/fn' }; continue; }
      if (!cache.has(cell.module)) {
        let mod = null;
        try { mod = await import(new URL(`../${cell.module}`, import.meta.url)); } catch { mod = null; }
        cache.set(cell.module, mod);
      }
      const mod = cache.get(cell.module);
      const ok = !!mod && typeof mod[cell.fn] === 'function';
      out.cells[level] = ok
        ? { status: 'ok', module: cell.module, fn: cell.fn, ...(cell.gated ? { gated: cell.gated } : {}), ...(cell.note ? { note: cell.note } : {}) }
        : { status: 'broken', module: cell.module, fn: cell.fn, reason: !mod ? `module ${cell.module} failed to import` : `export "${cell.fn}" missing or not a function` };
    }
    rows.push(out);
  }
  const summary = { surfaces: rows.length, ok: 0, human: 0, broken: 0, none: 0, readyFixCovered: 0 };
  const broken = [];
  for (const r of rows) {
    for (const level of LEVELS) {
      const c = r.cells[level];
      if (c.status === 'ok') summary.ok++;
      else if (c.status === 'human-by-design') summary.human++;
      else if (c.status === 'none') summary.none++;
      else { summary.broken++; broken.push({ id: r.id, level, ...c }); }
    }
    const rf = r.cells.readyFix;
    if (rf.status === 'ok' || rf.status === 'human-by-design') summary.readyFixCovered++;
  }
  return { rows, summary, broken };
}

const CELL_ICON = { ok: '✅', 'human-by-design': '🧑', broken: '❌ BROKEN', none: '✗ none' };

/** Render the verified matrix as markdown. */
export function renderCoverage({ rows, summary, broken }) {
  const L = ['# On-page coverage matrix', '',
    `${summary.surfaces} surfaces × 4 capability levels · self-verified ${new Date().toISOString().slice(0, 10)}`,
    `readyFix coverage: **${summary.readyFixCovered}/${summary.surfaces}** (ok or human-by-design) · ${summary.broken} BROKEN cell(s) · ${summary.none} gap(s)`, '',
    'Legend: ✅ implemented+verified (module import checked) · 🧑 human-by-design (honest terminal state) · ❌ BROKEN (claimed but the function is missing — fix the code or the registry) · ✗ none (gap)', '',
    '| surface | detect | propose | readyFix | autoApply |', '|---|---|---|---|---|'];
  const cellStr = (c) => {
    if (c.status === 'ok') return `${CELL_ICON.ok} \`${c.module.replace(/^src\//, '')}#${c.fn}\`${c.gated ? ' (LLM-gated, fail-closed)' : ''}`;
    if (c.status === 'human-by-design') return `${CELL_ICON['human-by-design']} ${c.reason}`;
    if (c.status === 'broken') return `${CELL_ICON.broken} \`${c.module || '?'}#${c.fn || '?'}\` — ${c.reason}`;
    return CELL_ICON.none;
  };
  for (const r of rows) L.push(`| **${r.surface}** | ${LEVELS.map((l) => cellStr(r.cells[l])).join(' | ')} |`);
  if (broken.length) {
    L.push('', `## ❌ Broken claims (${broken.length}) — coverage honesty`, '');
    for (const b of broken) L.push(`- ${b.id} / ${b.level}: \`${b.module || '?'}#${b.fn || '?'}\` — ${b.reason}`);
  }
  L.push('', '## Notes', '- autoApply lanes exist ONLY behind the real gates: policy DETERMINISTIC_FIX_TYPES + earned promotion (policy-promotion.mjs, 0 reverts + ≥5 keeps), edge head-only EDGE_SAFE fields via cloaking-guard + verifier consensus. Everything else: a human merges the PR.',
    '- LLM-gated cells run only via src/llm.mjs and fail CLOSED to the human queue when no model or the validator rejects the output.',
    '- human-by-design cells (YMYL consent, irreversible redirects, money paths, content review) are deliberate — see NON-NEGOTIABLE invariants.', '');
  return L.join('\n');
}

/** Run the matrix: verify + render + write reports/onpage-coverage.md. */
export async function runCoverage({ log = () => {} } = {}) {
  const verified = await verifyRegistry();
  const md = renderCoverage(verified);
  const { ROOT } = await import('../src/config.mjs');
  const dir = join(ROOT, 'reports');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'onpage-coverage.md');
  writeFileSync(out, md);
  const s = verified.summary;
  log(`  On-page coverage: ${s.surfaces} surfaces · readyFix ${s.readyFixCovered}/${s.surfaces} · ${s.broken} broken · ${s.none} gaps`);
  if (verified.broken.length) for (const b of verified.broken) log(`    ❌ ${b.id}/${b.level}: ${b.reason}`);
  log(`  → ${out}`);
  return { ...verified, path: out };
}

// Direct invocation: node scripts/onpage-coverage.mjs
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCoverage({ log: console.log }).then((r) => process.exit(r.broken.length ? 1 : 0))
    .catch((e) => { console.error('onpage-coverage failed:', e); process.exit(1); });
}
