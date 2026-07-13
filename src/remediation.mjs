// seo-bot · remediation — the four fix-generators that close the last C1 parity gaps.
//
// Each turns an existing DETECTION into a ready artifact (diff/worksheet/plan) the human
// approves through the normal queue → PR path. All deterministic (no LLM required), all
// no-fabrication: where a fix needs real data (stats, prices), the artifact DEMANDS it from
// a human instead of inventing it.

import { isCleanAnchor } from './anchors.mjs';

// ── 1) ANCHOR REWRITES: generic anchor text → descriptive noun-phrase diffs ─────────────
const GENERIC_ANCHORS = /^(click here|here|read more|learn more|more|this|link|website|page|see more|check it out|view)$/i;

/** PURE: derive a clean descriptive anchor from the TARGET page's title (≤6 words). */
export function anchorFromTitle(title = '') {
  const t = String(title).split(/[|·–—-]/)[0].trim().replace(/\s+/g, ' ');
  const words = t.split(' ').filter(Boolean).slice(0, 6);
  const anchor = words.join(' ');
  return anchor.length >= 3 && isCleanAnchor(anchor) ? anchor : null;
}

/**
 * PURE: generate anchor rewrite patches.
 * links: [{page, href, text}] (from the crawl) · titles: {href → target page title}.
 * Patch = the standard {find, replace} shape apply/nextjs ships as a PR. Fail-quiet:
 * a target without a usable title yields NO patch (never a fabricated anchor).
 */
export function anchorRewriteFixes(links = [], titles = {}) {
  const fixes = [];
  for (const l of links) {
    if (!l || typeof l.text !== 'string' || !GENERIC_ANCHORS.test(l.text.trim())) continue;
    const better = anchorFromTitle(titles[l.href] || '');
    if (!better || better.toLowerCase() === l.text.trim().toLowerCase()) continue;
    fixes.push({
      type: 'anchor-rewrite', page: l.page, autoApplicable: false,
      severity: 'low',
      patch: { find: `>${l.text}</a>`, replace: `>${better}</a>`, href: l.href },
      message: `Generic anchor "${l.text}" → descriptive "${better}" (target: ${l.href}).`,
      recommendation: 'Descriptive anchors carry relevance to the target; generic anchors carry none.',
    });
  }
  return fixes;
}

// ── 2) DECAY RECOVERY: decayed page → concrete refresh worksheet (real-diff enforced) ───
/**
 * PURE: decayFindings from content/decay detectDecay: [{page, dropPct, topLostQueries?}].
 * Emits per-page recovery briefs. NO content is generated here — the brief demands the
 * human-supplied real data the gates require, and re-dating without a substantive diff is
 * vetoed downstream by isFakeRefresh.
 */
export function decayRecoveryPlan(decayFindings = []) {
  return (decayFindings || []).filter((d) => d && d.page).map((d) => ({
    type: 'decay-recovery', page: d.page, autoApplicable: false,
    severity: (d.dropPct ?? 0) >= 50 ? 'high' : 'medium',
    actions: [
      'Re-verify every statistic/price on the page against a current primary source; update the stale ones (REAL numbers only — the no-fabrication gate blocks invented refreshes).',
      'Tighten the lead into a 40-60 word answer capsule within the first ~5k chars of source (read-window).',
      ...(Array.isArray(d.topLostQueries) && d.topLostQueries.length
        ? [`Add question-H2 sections for the decayed queries: ${d.topLostQueries.slice(0, 3).map((q) => `"${q}"`).join(', ')}.`]
        : ['Pull the page\'s lost queries from GSC and add question-H2 sections for the top 3.']),
      'Add/refresh one comparison table or data table with sourced current figures.',
      'Boost internal links: 2-3 contextual links from the site\'s strongest related pages.',
      'Only then update dateModified — the fake-refresh guard requires the content diff to be real.',
    ],
    evidence: { dropPct: d.dropPct ?? null, window: d.window || '90d vs prior' },
  }));
}

// ── 3) HCU RECOVERY: site-level quality plan (prune / consolidate / improve / keep) ─────
/**
 * PURE: classify pages for a Helpful-Content-style recovery.
 * pages: [{page, bodyWords, contentScore?, impressions?, clicks?}]. Deterministic tiers:
 *   prune       — thin AND invisible (no impressions): dead weight dragging site quality
 *   consolidate — thin but with demand: fold into the strongest sibling (human picks target)
 *   improve     — real page underperforming its demand (score low or CTR ~0 with impressions)
 *   keep        — pulling its weight
 */
export function hcuRecoveryPlan(pages = [], { thinWords = 250, minImpressions = 10 } = {}) {
  const tiers = { prune: [], consolidate: [], improve: [], keep: [] };
  for (const p of pages) {
    if (!p || !p.page) continue;
    const impr = Number(p.impressions) || 0;
    const thin = (Number(p.bodyWords) || 0) < thinWords;
    const score = Number(p.contentScore);
    if (thin && impr < minImpressions) tiers.prune.push({ page: p.page, why: `thin (${p.bodyWords || 0}w) + no demand (${impr} impr)` });
    else if (thin) tiers.consolidate.push({ page: p.page, why: `thin (${p.bodyWords || 0}w) but has demand (${impr} impr) — fold into strongest sibling` });
    else if (Number.isFinite(score) && score < 60) tiers.improve.push({ page: p.page, why: `content score ${score} < 60 with ${impr} impr` });
    else tiers.keep.push({ page: p.page });
  }
  const ordered = [
    ...tiers.prune.map((x) => ({ ...x, action: 'prune', note: 'noindex→remove; irreversible-gated downstream' })),
    ...tiers.consolidate.map((x) => ({ ...x, action: 'consolidate', note: 'human picks the merge target; canonical/301 irreversible-gated' })),
    ...tiers.improve.map((x) => ({ ...x, action: 'improve', note: 'route through decay-recovery/content gates' })),
  ];
  return { tiers, plan: ordered, summary: { prune: tiers.prune.length, consolidate: tiers.consolidate.length, improve: tiers.improve.length, keep: tiers.keep.length } };
}

// ── 4) SSR MIGRATION PLAN: js-dependence findings → concrete BLOG-KIT rebuild plan ──────
/**
 * PURE: for pages the audit flagged js-dependent (SPA shell — invisible to AI crawlers),
 * emit the migration plan artifact the web dev executes. The REBUILD decision is human;
 * the plan is machine-generated and names exactly what is invisible today.
 */
export function ssrMigrationPlan(findings = []) {
  const rows = (findings || []).filter((f) => f && f.page && /js-depend|spa/i.test(f.rule || f.type || ''));
  return {
    pages: rows.map((f) => ({
      page: f.page,
      invisibleToday: f.evidence?.bodyWords !== undefined ? `${f.evidence.bodyWords} body words server-rendered — AI crawlers see a shell` : 'client-rendered body — AI crawlers see a shell',
      plan: [
        'Serve the full body server-rendered (SSR/SSG) — AI crawlers execute no JS (binary requirement).',
        'Follow BLOG-KIT.md source-order rules: H1 → answer capsule → body; nav late in source, CSS-positioned visually.',
        'Recreate any JS-only content (tabs, accordions, charts) as real HTML — tables for data, details/summary for accordions.',
        'Verify with render-parity (bot text must equal human text) before shipping.',
      ],
    })),
    note: 'Platform/rebuild choice is a human decision; this artifact is the exact work order for it.',
  };
}
