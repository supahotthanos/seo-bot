// seo-bot · edge/cloaking-guard — the non-negotiable safety gate for every edge write-back.
//
// Delivery rule §2.3.2: "Edge is for speed/personalization, never cloaking." An edge
// rule may override SEO HEAD elements (title/meta/canonical/robots/JSON-LD) and inject
// answer capsules, but it must NEVER make the VISIBLE textual facts diverge bot↔human.
// This is exactly the SPLX failure mode that caught Search Atlas. We make drift impossible
// by refusing — at codegen time — to emit any rule whose change is in the "visible-text"
// class. The runtime parity assertion (src/parity.mjs verifyParity / extractSeo) is the
// post-deploy confirmation; this guard is the pre-emit refusal.
//
// What's ALLOWED on the edge (head-only, same for bot + human):
//   title, description, canonical, robots, og/twitter, hreflang, JSON-LD, answer-capsule
// What's REFUSED (would alter human-visible body text, i.e. cloaking surface):
//   h1, bodyText, mainContent, copy, anything not in the allowlist below.
//
// Every adapter (apply/edge.mjs, apply/cloudflare-worker.mjs) MUST run proposals through
// guardProposals() before writing or generating Worker source. The dropped rules are
// returned so the caller can report exactly why each was refused.

/** Override classes that are head-only and identical for every UA → safe at the edge. */
export const EDGE_SAFE_FIELDS = new Set([
  'title', 'description', 'metaDescription', 'meta', 'canonical', 'robots',
  'og', 'opengraph', 'twitter', 'hreflang', 'alternates',
  'jsonld', 'json-ld', 'schema', 'answer-capsule', 'answercapsule', 'capsule',
]);

/** Override classes that alter human-visible body copy → cloaking risk → never at the edge. */
export const CLOAKING_FIELDS = new Set([
  'h1', 'h2', 'h3', 'heading', 'bodytext', 'body', 'maincontent', 'main', 'copy',
  'text', 'paragraph', 'content', 'visibletext',
]);

/**
 * Map a proposal.type to the override field it touches. Proposal types in this codebase
 * are dotted/kebab (e.g. "meta.title", "schema.localbusiness", "h1-missing"); we take the
 * leading token and normalize.
 * @param {string} type
 * @returns {string}
 */
export function fieldOf(type) {
  const t = String(type || '').toLowerCase();
  const toks = t.split(/[.\-_:/\s]/).filter(Boolean);
  let head = toks[0] || '';
  // Compound prefixes the audit emits ("meta.title", "meta.description", "head.canonical"):
  // a bare "meta"/"head" wrapper is not itself a field — the real field is the next token.
  if ((head === 'meta' || head === 'head' || head === 'tag') && toks[1]) head = toks[1];
  // Common aliases the audit emits.
  if (head === 'title') return 'title';
  if (head === 'metadescription' || head === 'description' || head === 'desc') return 'description';
  if (head === 'canonical') return 'canonical';
  if (head === 'robots' || head === 'noindex' || head === 'index') return 'robots';
  if (head === 'jsonld' || head === 'schema' || head === 'ldjson' || (head === 'json' && toks[1] === 'ld')) return 'jsonld'; // "json-ld" tokenizes to json+ld — without this, the allowlist's own 'json-ld' entry is unreachable
  if (head === 'og' || head === 'opengraph') return 'og';
  if (head === 'twitter') return 'twitter';
  if (head === 'hreflang' || head === 'alternates') return 'hreflang';
  if (head === 'capsule' || head === 'answer' || head === 'answercapsule') return 'answer-capsule';
  return head;
}

/**
 * Decide whether a single proposal is safe to materialize as an edge override.
 * SAFE only when (a) the field is in the head-only allowlist AND (b) it is not in the
 * known cloaking set. Anything unknown is refused (fail-closed).
 * @param {{type:string, proposed?:any, current?:any}} p
 * @returns {{ok:boolean, field:string, reason?:string}}
 */
export function classifyProposal(p) {
  const field = fieldOf(p?.type);
  if (CLOAKING_FIELDS.has(field)) {
    return { ok: false, field, reason: `"${field}" changes human-visible body text — would diverge bot↔human (cloaking). Graduate to a source PR instead.` };
  }
  if (!EDGE_SAFE_FIELDS.has(field)) {
    return { ok: false, field, reason: `"${field}" is not in the edge head-only allowlist — refusing (fail-closed). Apply via apply/nextjs.mjs source PR.` };
  }
  return { ok: true, field };
}

/**
 * Partition proposals into edge-safe and refused. The single guard both edge adapters call.
 * @param {Array} proposals
 * @returns {{safe:Array, refused:Array<{p:object, field:string, reason:string}>}}
 */
export function guardProposals(proposals = []) {
  const safe = [];
  const refused = [];
  for (const p of proposals) {
    const c = classifyProposal(p);
    if (c.ok) safe.push(p);
    else refused.push({ p, field: c.field, reason: c.reason });
  }
  return { safe, refused };
}
