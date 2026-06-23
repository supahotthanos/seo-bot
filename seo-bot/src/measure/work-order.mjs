// seo-bot · measure/work-order — convert the AI-visibility citation GAP into action.
//
// For every priority prompt where a COMPETITOR is cited/recommended and the CLIENT is NOT,
// we ask one question: *where is the engine pulling that competitor's answer from?* Then we
// route the gap to the layer that can actually close it:
//   • the cited source is the competitor's OWN domain / a listicle / news → ON-SITE brief
//     (we can out-answer them on our own pages — feeds content/ via decide.mjs proposal shape).
//   • the cited source is Reddit / Wikipedia / YouTube / a review-directory (G2/Capterra/
//     Trustpilot/Yelp/RealSelf…) → OFF-DOMAIN task (we must earn a presence there — feeds
//     listings/ + sources/; a human closes it, the engine only tees it up).
//
// Output objects use the same task/proposal shape the rest of seo-bot speaks:
//   on-site  → { type:'content', page, severity, autoApplicable:false, brief:{...}, rationale }
//   off-site → { type:'offsite', host, sourceType, severity, autoApplicable:false, action, rationale }
// so they drop straight into tasks.mjs (upsertFromProposals) and the content/listings feeds.
//
// Pure + offline. Consumes a capture (from measure.mjs) + cfg. No scraping, no API.

import { hostOf } from '../util.mjs';

// Source-type classifier — mirrors sources/index.mjs so routing is consistent across the
// engine. ON-SITE-beatable types vs OFF-DOMAIN-only types are split below.
const TYPE_RES = [
  ['review-directory', [/yelp\./, /realself/, /healthgrades/, /zocdoc/, /vitals\./, /ratemds/, /threebestrated/, /trustpilot/, /g2\.com/, /capterra/, /angi\./, /thumbtack/, /yellowpages/, /expertise\.com/, /birdeye/, /nicelocal/, /booksy/, /vagaro/, /spafinder/]],
  ['ugc-community', [/reddit\./, /quora\./, /youtube\./, /youtu\.be/, /tiktok\./, /facebook\./, /instagram\./, /nextdoor\./, /x\.com/, /twitter\./, /linkedin\./]],
  ['encyclopedic', [/wikipedia\.org/, /wikidata/, /\.fandom\./]],
  ['gov-edu-medical', [/\.gov\b/, /\.edu\b/, /nih\.gov/, /fda\.gov/, /plasticsurgery\.org/, /aad\.org/, /asds\.net/, /americanmedspa/]],
  ['news-editorial', [/nytimes|forbes|cnn|allure|byrdie|cosmopolitan|self\.com|today\.com|wellandgood|harpersbazaar|vogue|newbeauty/]],
];

// listicle heuristic: ranked-roundup pages we can out-answer on our own site.
const LISTICLE_RE = /(best|top|\d+-best|top-\d+|review|vs|alternatives|near-me|guide)/i;

// Off-domain types we must EARN a presence on (cannot fix on our own site).
const OFF_DOMAIN = new Set(['review-directory', 'ugc-community', 'encyclopedic']);

/** Classify a cited host relative to the client + competitors. */
function classify(host, cfg) {
  const h = (host || '').replace(/^www\./, '');
  if (!h) return 'other';
  if (cfg.domain && h.includes(cfg.domain.replace(/^www\./, ''))) return 'own';
  for (const [type, res] of TYPE_RES) if (res.some((re) => re.test(h))) return type;
  const comps = (cfg.competitors || []).map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((c) => c.length >= 5);
  if (comps.some((c) => h.replace(/[^a-z0-9]/g, '').includes(c))) return 'competitor';
  return 'other';
}

/** Off-site action copy per source type (what a human actually does to close the gap). */
function offsiteAction(type) {
  switch (type) {
    case 'review-directory': return 'Claim + fully optimize the profile, then drive genuine reviews (no gating — FTC 16 CFR 465).';
    case 'ugc-community': return 'Earn an authentic mention/thread (Reddit/YouTube) — flag-track, human-authored only.';
    case 'encyclopedic': return 'Pursue a Wikipedia/Wikidata entity if genuinely notable; otherwise build sameAs entity records.';
    default: return 'Earn a presence on this source.';
  }
}

const isAnswer = (r) => r && !r.error && !r.note;

/**
 * Build a work order from a capture.
 *
 * @param {object} captureOrSov a raw capture { results, ... } from measure.mjs. (Accepts a
 *        computeSov() result too, but the gap analysis needs the per-prompt rows, so prefer
 *        the raw capture; if given an sov result it falls back to its `.capture` if present.)
 * @param {object} cfg loaded client config
 * @param {object} [o]
 * @param {Map<string,object>} [o.priorityByPrompt] optional prompt→{funnelStage,geo,priority}
 *        tags (e.g. from prompts.buildPromptPanel) so comparison/category gaps rank first.
 * @returns {{ client, brand, ranAt, gaps, onSite, offSite, tasks }}
 */
export function buildWorkOrder(captureOrSov, cfg, { priorityByPrompt = null, log = () => {} } = {}) {
  const capture = captureOrSov?.results ? captureOrSov : (captureOrSov?.capture || { results: [] });
  const rows = (capture.results || []).filter(isAnswer);
  const ranAt = capture.ranAt || new Date().toISOString();

  // Stage weight so comparison/category (commercial) gaps outrank informational/branded.
  const STAGE_W = { comparison: 4, category: 3, informational: 2, branded: 1 };
  const tagFor = (prompt) => (priorityByPrompt && priorityByPrompt.get(prompt)) || {};

  // A "gap" = an answer where a competitor is present (cited or recommended) and we are NOT.
  const gaps = [];
  for (const r of rows) {
    const compPresent = (r.competitorsMentioned?.length || 0) > 0 || (r.citedDomains || []).some((d) => classify(hostOf(d.startsWith('http') ? d : `https://${d}`) || d, cfg) === 'competitor');
    const weCited = r.cited;
    const weMentioned = r.mentioned;
    if ((weCited || weMentioned) || !compPresent) continue; // not a gap: we're in, or no competitor to lose to

    const tag = tagFor(r.prompt);
    const citedTypes = (r.citedDomains || []).map((d) => {
      const host = hostOf(d.startsWith('http') ? d : `https://${d}`) || d.replace(/^www\./, '');
      return { host, type: classify(host, cfg) };
    });
    gaps.push({
      prompt: r.prompt,
      engine: r.engine,
      funnelStage: tag.funnelStage || null,
      geo: tag.geo || null,
      competitorsMentioned: r.competitorsMentioned || [],
      citedSources: citedTypes,
      stageWeight: STAGE_W[tag.funnelStage] ?? 2,
    });
  }
  gaps.sort((a, b) => b.stageWeight - a.stageWeight);

  // ---- route each gap's cited sources to on-site vs off-domain ----
  const onSiteByQuery = new Map();   // prompt → content brief (we out-answer on our own page)
  const offSiteByHost = new Map();   // host → off-domain task (we earn a presence)

  for (const g of gaps) {
    const sev = g.stageWeight >= 4 ? 'high' : g.stageWeight >= 3 ? 'medium' : 'low';

    // Decide if THIS gap is on-site-winnable: competitor-own / listicle / news / gov-edu
    // are pages we can out-answer; off-domain types need an earned presence.
    let routedOnSite = false;
    for (const src of g.citedSources) {
      if (OFF_DOMAIN.has(src.type)) {
        const cur = offSiteByHost.get(src.host) || { type: 'offsite', host: src.host, sourceType: src.type, severity: 'low', autoApplicable: false, prompts: new Set(), engines: new Set(), action: offsiteAction(src.type) };
        cur.prompts.add(g.prompt); cur.engines.add(g.engine);
        if (sevRank(sev) < sevRank(cur.severity)) cur.severity = sev; // escalate to highest-intent gap that hit it
        offSiteByHost.set(src.host, cur);
      } else {
        routedOnSite = true; // competitor/listicle/news/gov-edu/other → beatable on our own page
      }
    }
    // No cited sources at all but a competitor was *recommended* → still an on-site answer gap.
    if (!g.citedSources.length) routedOnSite = true;

    if (routedOnSite && !onSiteByQuery.has(g.prompt)) {
      onSiteByQuery.set(g.prompt, makeOnSiteBrief(g, cfg, sev));
    }
  }

  const onSite = [...onSiteByQuery.values()];
  const offSite = [...offSiteByHost.values()]
    .map((o) => ({ ...o, prompts: [...o.prompts], engines: [...o.engines], citations: o.prompts.size }))
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.citations - a.citations);

  // unified task list (decide.mjs / tasks.mjs proposal shape) for upsertFromProposals
  const tasks = [
    ...onSite.map((b) => ({ type: 'content', page: b.brief.url, severity: b.severity, autoApplicable: false, current: '(not cited/recommended for this query)', proposed: b.brief.targetQuery, rationale: b.rationale, brief: b.brief })),
    ...offSite.map((o) => ({ type: 'offsite', page: o.host, severity: o.severity, autoApplicable: false, current: `competitor cited via ${o.host} (${o.sourceType})`, proposed: o.action, rationale: `Cited for ${o.citations} priority prompt(s) where we're absent; earn a presence here.` })),
  ];

  log(`  work-order: ${gaps.length} citation gaps → ${onSite.length} on-site briefs · ${offSite.length} off-domain targets`);
  return { client: cfg.name, brand: cfg.brand, ranAt, gaps, onSite, offSite, tasks };
}

/** Build an on-site content brief (decide.mjs brief shape) from a query gap. */
function makeOnSiteBrief(gap, cfg, severity) {
  const slug = gap.prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const ymyl = /cost|price|safe|risk|side effect|results/i.test(gap.prompt) || cfg.vertical === 'medspa';
  const brief = {
    type: gap.funnelStage === 'comparison' ? 'comparison' : gap.funnelStage === 'category' ? 'category_answer' : 'answer',
    targetQuery: gap.prompt,
    url: `/answers/${slug}`,
    ymyl,
    city: gap.geo || null,
    // dataPoints/primarySources/author are filled by a human before drafting (content gates
    // refuse to draft until the unique-data table is present — anti-slop).
    dataPoints: [],
    primarySources: [],
  };
  return {
    type: 'content', severity, autoApplicable: false, brief,
    rationale: `AI engines named a competitor for "${gap.prompt}" (${gap.engine}) and not us; out-answer it on a server-rendered page (real local data required before drafting).`,
  };
}

const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
const sevRank = (s) => SEV[s] ?? 3;
