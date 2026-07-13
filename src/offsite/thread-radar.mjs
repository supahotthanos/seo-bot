// seo-bot · offsite/thread-radar — the UGC/forum sibling of listicle-radar (GOAL criterion 7).
//
// Finds the exact THREADS (Reddit/Quora/forums) that AI engines actually cite in our prompt
// panel where the client is ABSENT, and turns each into ONE human action: a worksheet row with
// a drafted, DISCLOSED reply the human may post from their own account.
//
// HARD INVARIANTS (the anti-RedRover line — suite-asserted):
//   • This module NEVER posts, comments, votes, or creates accounts anywhere. It exports no
//     network-write surface at all — it reads capture artifacts and writes worksheet files.
//   • Every draft leads with an explicit affiliation DISCLOSURE — an undisclosed endorsement
//     is an FTC 16 CFR 465 violation and is exactly the RedRover pattern we refuse.
//   • Drafts pass checkReplyCompliance (no incentives, no sentiment-gating, no patient-hood)
//     — a failed gate drops the draft to a "manual-only" note, never a ready paste.

import { checkReplyCompliance } from './replies.mjs';

const THREAD_PATTERNS = [
  /reddit\.com\/r\/[^/]+\/comments\//i,
  /quora\.com\/[^/]+/i,
  /community\.[^/]+\/(t|topic|thread)\//i,
  /forum(s)?\.[^/]+\//i,
  /\.(com|org|net)\/(t|thread|topic)s?\/\d/i,
];

/** PURE: is this URL a UGC thread (not a homepage/profile/listing)? */
export function looksLikeThread(url = '') {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  return THREAD_PATTERNS.some((re) => re.test(url));
}

/** PURE: does any brand token appear in the thread title/snippet/url? */
export function brandPresent(entry = {}, brandTokens = []) {
  const hay = `${entry.url || ''} ${entry.title || ''} ${entry.snippet || ''}`.toLowerCase();
  return brandTokens.some((t) => t && hay.includes(t));
}

/** PURE: deterministic disclosed reply draft (LLM never required; honesty over polish). */
export function draftDisclosedReply(entry = {}, cfg = {}) {
  const brand = cfg.brand || cfg.name || 'our clinic';
  const city = cfg.location || cfg.city || '';
  const disclosure = `Disclosure: I work with ${brand}${city ? ` in ${city}` : ''}.`;
  const body = [
    disclosure,
    `On the question in this thread — a few facts that usually help: check that the provider lists real credentials (NP/PA/MD) and publishes actual price ranges rather than "call us".`,
    `Happy to answer specifics from the provider side; and obviously get multiple consults before booking anything.`,
  ].join(' ');
  const gate = checkReplyCompliance(body);
  return { body, disclosure, gate, ready: gate.ok === true };
}

/**
 * PURE core: from capture rows (fanout-capture citations + sources report), find cited
 * threads where the client is absent. captures = [{status, citations:{results:[{title,url,snippet}], urls:[]}}].
 */
export function findThreadTargets(captures = [], cfg = {}) {
  const brandTokens = [cfg.brand, cfg.name, ...(cfg.brandAliases || [])]
    .filter((s) => typeof s === 'string' && s.trim().length >= 3).map((s) => s.toLowerCase());
  const own = (cfg.baseUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const seen = new Map();
  for (const c of captures) {
    if (!c || c.status !== 'ok') continue; // blocked/empty rows carry no evidence (fail-closed)
    const results = c.citations?.results || [];
    const bare = (c.citations?.urls || []).map((u) => ({ url: u, title: '', snippet: '' }));
    for (const e of [...results, ...bare]) {
      if (!looksLikeThread(e.url)) continue;
      if (own && e.url.toLowerCase().includes(own)) continue;      // our own thread — nothing to do
      if (brandPresent(e, brandTokens)) continue;                   // already mentioned — not a gap
      const key = e.url.split('?')[0];
      const prev = seen.get(key) || { ...e, url: key, citedIn: 0 };
      prev.citedIn += 1;
      if (e.title && !prev.title) prev.title = e.title;
      seen.set(key, prev);
    }
  }
  return [...seen.values()].sort((a, b) => b.citedIn - a.citedIn);
}

/** Assemble worksheet-ready rows (one human action each). Pure — caller persists. */
export function threadRadar(captures = [], cfg = {}, { log = () => {}, max = 20 } = {}) {
  const targets = findThreadTargets(captures, cfg).slice(0, Math.max(1, max));
  const rows = targets.map((t, i) => {
    const draft = draftDisclosedReply(t, cfg);
    return {
      id: `thread-${i + 1}`,
      action: 'reply-disclosed',
      target: t.title || t.url,
      url: t.url,
      citedIn: t.citedIn,
      content: draft.ready ? draft.body : '',
      manualOnly: !draft.ready,
      compliance: draft.gate,
      why: `cited by AI ${t.citedIn}× in our panel; client absent — a DISCLOSED, useful reply from a real human account is the only compliant way in`,
    };
  });
  log(`  thread-radar: ${rows.length} thread target(s)${rows.length ? '' : ' — no cited threads with the client absent (or no captures with citations yet)'}`);
  return { status: rows.length ? 'ok' : 'empty', rows };
}
