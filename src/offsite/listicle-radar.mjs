// seo-bot · offsite/listicle-radar — find third-party "best X in {city}" listicles among the
// sources the AI engines actually cite where the CLIENT IS ABSENT, and emit HUMAN inclusion
// tasks (pitch the publisher with real data).
//
// Evidence: research/aeo-deep-research-2026.md (~63% of AI citations are listicles);
// research/seo-aeo-master-playbook-2026.md #31 (third-party listicles cited ~6.5× more than
// own domain) and #28: self-#1 listicle networks were demoted Jan-2026 (−49%) and Lily Ray's
// study shows AI recommends a rival ~69% of the time from self-serving lists anyway.
//
// HARD INVARIANT: this module can NEVER generate or propose a self-ranking page ("publish our
// own #1 / best-of list"). Every emitted task passes forbidSelfRanking(); anything that trips
// it is dropped and reported in `refused`. Third-party inclusion only, human sends everything.
//
// Consumes the scripts/ai-visibility/track.mjs capture shape:
//   { brand, domain, ranAt, results:[{ engine, prompt, status, mentioned, cited,
//     citedDomains?:[host], citations?:[{title,url}], note, error? }] }
// Block-aware: rows with status 'blocked' or an error are EXCLUDED (a blocked scrape is not
// evidence of absence — invariant 7).

import { classify } from '../sources/index.mjs';
import { hostOf } from '../util.mjs';

export const LISTICLE_TITLE_RE = /(?<![a-z0-9])(best|top[\s-]?\d+|top[\s-]rated|\d+\s+best|roundup)(?![a-z0-9])/i;
const BEST_IN_GEO_PROMPT_RE = /\b(best|top)\b.*\b(in|near)\b/i;
// Hosts that ARE the listicle (pure ranked-roundup directories) — host-only fallback evidence.
const LISTICLE_HOSTS_RE = /threebestrated|expertise\.com|bestprosintown|top\s?10|kev's best|kevsbest/i;

/** Does a cited source look like a third-party "best X in {city}" listicle? */
export function looksLikeListicle({ url = '', title = '', prompt = '' } = {}) {
  let path = '';
  try { path = decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, ' '); } catch { /* host-only */ }
  if (LISTICLE_TITLE_RE.test(title) || LISTICLE_TITLE_RE.test(path)) return { match: true, confidence: 'url-match' };
  const host = url ? hostOf(url) : '';
  if (LISTICLE_HOSTS_RE.test(host || url)) return { match: true, confidence: 'host-match' };
  if (!path && !title && BEST_IN_GEO_PROMPT_RE.test(prompt)) return { match: true, confidence: 'prompt-inferred' };
  return { match: false, confidence: null };
}

// Self-ranking deny patterns — a task may never tell anyone to publish OUR OWN ranked list.
const SELF_RANKING_RES = [
  /\b(publish|create|launch|build|write|add|generate|spin\s+up)\b[^.]{0,80}\b(our|your|own)\b[^.]{0,80}\b(list|listicle|ranking|roundup|best[\s-]?of|top[\s-]?\d+)\b/i,
  /\bself[\s-]?rank/i,
  /\brank\s+(ourselves|yourself|our\s+\w+)\s+(#\s?1|first|number\s+one|top)\b/i,
  /\b(our|your)\s+(own\s+)?(site|domain|blog|page)\b[^.]{0,60}\b(#\s?1|number\s+one|best[\s-]?of)\b/i,
];

/**
 * Final invariant filter: drop any task that (a) targets the client's own domain, or
 * (b) contains self-ranking language in ANY text field. Returns { tasks, refused }.
 */
export function forbidSelfRanking(tasks, cfg) {
  const own = (cfg?.domain || '').replace(/^www\./, '').toLowerCase();
  const kept = [], refused = [];
  for (const t of tasks || []) {
    if (!t) continue;
    const host = String(t.host || '').replace(/^www\./, '').toLowerCase();
    if (own && host && (host === own || host.endsWith('.' + own))) { refused.push({ task: t, why: 'targets-own-domain' }); continue; }
    const text = [t.action, t.proposed, t.rationale, t.title, t.note].filter(Boolean).join(' | ');
    const hit = SELF_RANKING_RES.find((re) => re.test(text));
    if (hit) { refused.push({ task: t, why: `self-ranking-language: ${hit}` }); continue; }
    kept.push(t);
  }
  return { tasks: kept, refused };
}

/**
 * Scan a capture for third-party listicles cited on prompts where the client is absent.
 * Fail-closed: missing/empty capture (or all rows blocked) → { ok:false } with a helpful
 * message — never a silent empty task list that reads as "no gaps".
 */
export function listicleRadar(capture, cfg, { log = () => {} } = {}) {
  if (!capture || !Array.isArray(capture.results)) {
    return { ok: false, reason: 'no-capture', message: `No AI-visibility capture found. Run \`node seo-bot/bin/seo-bot.mjs measure ${cfg?.name || '<client>'}\` first.`, tasks: [], refused: [] };
  }
  const usable = capture.results.filter((r) => r && !r.error && r.status !== 'blocked');
  const blocked = capture.results.length - usable.length;
  if (!usable.length) {
    return { ok: false, reason: 'no-usable-rows', message: `Capture has ${capture.results.length} row(s) but none usable (${blocked} blocked/errored). Blocked scrapes are excluded, not counted as absence — re-run \`measure\`.`, tasks: [], refused: [] };
  }

  const byKey = new Map(); // host|url → task
  for (const r of usable) {
    if (r.cited || r.mentioned) continue; // we're present — not a gap
    const prompt = r.prompt || '';
    // Prefer full citations [{title,url}] when the capture has them; fall back to citedDomains hosts.
    const cands = Array.isArray(r.citations) && r.citations.length
      ? r.citations.map((c) => ({ url: c?.url || '', title: c?.title || '', host: hostOf(c?.url || '') }))
      : (r.citedDomains || []).map((d) => ({ url: '', title: '', host: hostOf(String(d).startsWith('http') ? d : `https://${d}`) || String(d).replace(/^www\./, '') }));
    for (const c of cands) {
      if (!c.host) continue;
      const type = classify(c.host, cfg);
      if (type === 'own' || type === 'competitor') continue; // never target ourselves; can't pitch a rival's page
      const li = looksLikeListicle({ url: c.url, title: c.title, prompt });
      if (!li.match) continue;
      const key = `${c.host}|${c.url}`;
      const t = byKey.get(key) || {
        type: 'offsite-listicle', host: c.host, url: c.url || null, title: c.title || null, sourceType: type,
        confidence: li.confidence, prompts: new Set(), engines: new Set(), autoApplicable: false,
        action: 'Pitch the publisher for THIRD-PARTY inclusion — a human sends real, verifiable data (review counts with live links, checkable credentials, transparent price ranges). Never fabricate, never buy a fake ranking, never self-publish a ranked list.',
      };
      t.prompts.add(prompt); t.engines.add(r.engine);
      if (li.confidence === 'url-match') t.confidence = 'url-match'; // strongest evidence wins
      byKey.set(key, t);
    }
  }

  let tasks = [...byKey.values()].map((t) => ({
    ...t, prompts: [...t.prompts], engines: [...t.engines],
    severity: t.engines.size > 1 ? 'high' : 'medium',
    rationale: `Cited for ${t.prompts.size} prompt(s) where ${cfg?.brand || 'the client'} is absent — third-party listicles are the dominant AI citation surface; inclusion is earned, never self-published.`,
  })).sort((a, b) => b.prompts.length - a.prompts.length);

  // Hard invariant, applied unconditionally on the way out.
  const guarded = forbidSelfRanking(tasks, cfg);
  tasks = guarded.tasks;
  log(`  listicle-radar: ${usable.length} usable rows (${blocked} blocked excluded) → ${tasks.length} inclusion task(s)${guarded.refused.length ? ` · ${guarded.refused.length} REFUSED (self-ranking guard)` : ''}`);
  return { ok: true, tasks, refused: guarded.refused, usableRows: usable.length, blockedRows: blocked };
}
