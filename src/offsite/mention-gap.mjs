// seo-bot · offsite/mention-gap — turn the sources report (what the AI engines cite where
// we're ABSENT) into a prioritized HUMAN worksheet: one row = one human action, with a
// pre-drafted, honesty-guarded pitch.
//
// Evidence: research/aeo-deep-research-2026.md — Ahrefs (75k brands): unlinked brand mentions
// correlate with AI visibility ~0.66 vs backlinks ~0.22 ("mentions beat backlinks ~3:1");
// research/seo-aeo-master-playbook-2026.md #31 — third-party listicles cited ~6.5× more than
// own domain. Off-site is a WORKLIST, not an executor: the bot preps, a human sends everything
// (outreach/pitching is in the never-automate set).
//
// Fail-closed: no/empty sources report → { ok:false } with a helpful message, never an empty
// "all clear" worksheet. Pitch drafts: LLM via src/llm.mjs when available, else a deterministic
// template clearly labeled "DRAFT (no LLM)". Drafts NEVER fabricate relationships, credentials,
// awards, or prior contact — an LLM draft that trips the fabrication deny-list is discarded and
// replaced with the deterministic template (fail closed on honesty).

import { classify } from '../sources/index.mjs';
import { llmAvailable, complete } from '../llm.mjs';

// Claimable = the client can create/claim its own presence (no editor gatekeeping).
// Pitch-required = a third party controls inclusion; a human must pitch.
const CLAIMABLE = new Set(['review-directory', 'ugc-community', 'encyclopedic']);
const SKIP = new Set(['own', 'competitor']);

export function actionKindFor(type) {
  if (CLAIMABLE.has(type)) return 'claimable';
  if (SKIP.has(type)) return 'skip';
  return 'pitch-required'; // news-editorial, maps, gov-edu-medical, other listicle hosts
}

const ACTION_COPY = {
  'review-directory': 'Claim + fully complete the profile (photos, services, canonical NAP), then earn genuine reviews. NO gating/solicitation automation — FTC 16 CFR 465.',
  'ugc-community': 'Participate honestly (real answers, disclosed affiliation). Never astroturf, never sockpuppet.',
  encyclopedic: 'Pursue an entity ONLY if genuinely notable; use a COI edit request on the Talk page — never edit directly about yourself.',
  'news-editorial': 'Pitch the editor/writer with real, verifiable data (a human sends it).',
  'gov-edu-medical': 'Not pitchable — earn it: publish citable primary data these institutions could reference.',
  maps: 'Verify the Google Business Profile / Apple Business Connect listing (see `citations`).',
  other: 'Pitch the site owner for an earned mention with real data (a human sends it).',
};

/** Fabrication deny-list for auto-drafted pitches — any hit = the draft is discarded.
 *  We cannot verify relationships/credentials at draft time, so we fail closed on them. */
const FABRICATION_RES = [
  [/\b(long[\s-]?time|avid|loyal|big)\s+(reader|fan|listener|customer|follower|user)\b/i, 'claims a relationship (long-time reader/fan)'],
  [/\bwe\s+(met|spoke|talked|chatted)\b/i, 'claims prior contact'],
  [/\bas\s+(we\s+)?discussed\b/i, 'claims prior conversation'],
  [/\bfollowing\s+(you|your\s+(work|blog|column))\b/i, 'claims a follower relationship'],
  [/\baward[\s-]?winning\b/i, 'unverified award claim'],
  [/\bboard[\s-]?certified\b/i, 'unverified credential claim (humans add verified credentials before sending)'],
  [/#\s?1\b|\bnumber\s+one\b/i, 'self-ranking claim'],
  [/\b(best|premier|leading|top[\s-]rated)\b/i, 'bare superlative (promo tone backfires ~69% — see rules.mjs promo-tone)'],
];

/** Is a drafted pitch free of fabricated relationships/credentials/superlatives? */
export function pitchSafe(text) {
  const hits = [];
  for (const [re, why] of FABRICATION_RES) if (re.test(text || '')) hits.push(why);
  return { safe: hits.length === 0, hits };
}

/** Deterministic pitch template — facts from cfg only, clearly labeled. Always pitchSafe. */
export function deterministicPitch(row, cfg) {
  const brand = cfg.brand || cfg.name || 'the client';
  const site = cfg.baseUrl || (cfg.domain ? `https://${cfg.domain}` : '');
  const city = cfg.locations?.[0]?.nap?.city || cfg.city || '';
  const where = city ? ` in ${city}` : '';
  const head = `DRAFT (no LLM) — a human reviews, personalizes, and sends this. Do not add claims you cannot verify.`;
  if (row.type === 'review-directory') {
    return `${head}\n\nProfile claim checklist for ${row.host}:\n1. Claim/verify the ${brand} listing (owner email or phone verification).\n2. Fill every field: services, hours, canonical NAP, photos, booking link (${site}).\n3. Profile description (facts only): "${brand} is a med spa${where}. Services and pricing: ${site}."\n4. Earn reviews the legal way: great service + a plain ask. Never gate, never incentivize, never automate solicitation (FTC 16 CFR 465).`;
  }
  if (row.type === 'ugc-community') {
    return `${head}\n\nCommunity participation note for ${row.host} (post only where genuinely useful):\n"(Disclosure: I work at ${brand}${where}.) Answering the actual question: [human fills in a real, specific answer — prices as ranges, what to expect, no promotion]. Details: ${site}."\nRules: disclose affiliation every time, answer the question first, never post fake demand threads.`;
  }
  if (row.type === 'encyclopedic') {
    return `${head}\n\nNotability check for ${row.host}: only pursue if ${brand} has significant coverage in independent, reliable sources. If yes, file a Conflict-of-Interest edit request on the article Talk page citing those sources. Never edit the article directly about yourself. If not notable: skip — build sameAs entity records instead (see \`entity\`).`;
  }
  return `${head}\n\nSubject: ${city ? city + ' ' : ''}data for your readers — ${brand}\n\nHi [editor name — human fills in],\n\nI'm reaching out from ${brand}, a med spa${where} (${site}). AI assistants cite ${row.host} when people ask about services like ours, and your coverage is missing one option readers ask about.\n\nWhat I can offer for your piece: verifiable specifics — our published price ranges, provider credentials you can check against the state license registry, and review counts with live links. If ${brand} doesn't fit your criteria, no hard feelings — happy to be a source on local pricing data either way.\n\n[Human: verify every fact above before sending; add real contact details.]`;
}

/**
 * Build the ranked mention-gap rows from a sources report (sources/index.mjs analyzeSources
 * output: { topSources:[{host,type,citations,engines,promptCount}], ownPresent, ... }).
 * Pure; no IO. Fail-closed on missing/empty input.
 */
export function buildMentionGap(sourcesReport, cfg) {
  if (!sourcesReport || typeof sourcesReport !== 'object' || !Array.isArray(sourcesReport.topSources)) {
    return { ok: false, reason: 'no-sources-report', message: `No sources report found. Run \`node seo-bot/bin/seo-bot.mjs measure ${cfg?.name || '<client>'}\` then \`sources ${cfg?.name || '<client>'}\` first.`, rows: [] };
  }
  if (!sourcesReport.topSources.length) {
    return { ok: false, reason: 'empty-sources-report', message: 'The sources report has zero cited sources — the capture may have been blocked or empty. Re-run `measure` and `sources`.', rows: [] };
  }
  const rows = [];
  for (const s of sourcesReport.topSources) {
    if (!s?.host) continue;
    const type = s.type || classify(s.host, cfg);
    const kind = actionKindFor(type);
    if (kind === 'skip') continue; // own domain (not a gap) / competitor (not a target)
    rows.push({
      host: s.host,
      type,
      actionKind: kind,
      citations: Number.isFinite(s.citations) ? s.citations : 0,
      engines: Array.isArray(s.engines) ? s.engines : [],
      promptCount: Number.isFinite(s.promptCount) ? s.promptCount : 0,
      action: ACTION_COPY[type] || ACTION_COPY.other,
      autoApplicable: false, // a human does every one of these
    });
  }
  // Claimable first (lower effort, same citations), then by how often engines cite the host.
  rows.sort((a, b) => (a.actionKind === b.actionKind ? b.citations - a.citations : a.actionKind === 'claimable' ? -1 : 1));
  rows.forEach((r, i) => { r.priority = i + 1; });
  return { ok: true, rows, ownPresent: !!sourcesReport.ownPresent, capturedAt: sourcesReport.capturedAt || null };
}

/**
 * Fill row.pitch for each row. LLM (src/llm.mjs complete) when available AND the draft passes
 * the fabrication deny-list; otherwise the deterministic template. Never throws; never leaves
 * a row without a pitch.
 */
export async function draftPitches(rows, cfg, { useLlm = llmAvailable(), completeFn = complete, llmCap = 8, log = () => {} } = {}) {
  let llmUsed = 0;
  for (const row of rows) {
    const fallback = deterministicPitch(row, cfg);
    row.pitch = fallback; row.pitchSource = 'template';
    if (!useLlm || llmUsed >= llmCap) continue;
    try {
      const prompt = [
        `Draft a short (<=120 words) outreach note for a human to review and send. Target: ${row.host} (${row.type}). Goal: ${row.action}`,
        `Sender: ${cfg.brand || cfg.name}, a med spa (${cfg.baseUrl || cfg.domain || ''}).`,
        `HARD RULES: do NOT invent relationships, prior contact, credentials, awards, or rankings. No superlatives ("best", "#1", "leading"). Only verifiable facts. Honest, specific, low-pressure. If community post: disclose affiliation.`,
      ].join('\n');
      const draft = await completeFn(prompt, { system: 'You draft honest outreach. Never fabricate. Plain text only.', maxTokens: 400, client: cfg.name, tag: 'offsite-pitch' });
      llmUsed++;
      if (!draft) continue; // no LLM answer → keep deterministic (fail closed)
      const check = pitchSafe(draft);
      if (!check.safe) { log(`  pitch for ${row.host}: LLM draft rejected (${check.hits.join('; ')}) → template`); continue; }
      row.pitch = `DRAFT (LLM — human verifies every fact before sending)\n\n${draft.trim()}`;
      row.pitchSource = 'llm';
    } catch { /* keep deterministic fallback */ }
  }
  return rows;
}
