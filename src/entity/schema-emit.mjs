// seo-bot · entity/schema-emit — generate a server-side JSON-LD @graph keyed by @id from
// the entity graph, and a proposal object the apply layer can ship.
//
// 2026 REALITY (do NOT regress):
//   • FAQPage / HowTo / QAPage no longer earn rich results (deprecated May 2026) — we NEVER
//     emit them here. (schema.mjs already flags them as no-longer-wins.)
//   • What still earns/grounds: Organization, (Medical)LocalBusiness, Review,
//     AggregateRating, Service, Offer, BreadcrumbList — plus the linked-data lever AI
//     engines actually use: an @id-keyed @graph with `about` (primary) + `mentions`
//     (secondary) and a real `sameAs` (Wikidata > Google KG > socials, from sources/entity.mjs).
//
// The emitted @graph is ONE <script type="application/ld+json"> with:
//   1) the Organization / (Medical)LocalBusiness node (sameAs, @id = <base>/#org)
//   2) a WebPage node for the URL with `about` → primary entity @id, `mentions` → [@ids]
//   3) referenced entity nodes (MedicalProcedure/Thing) keyed by @id, each w/ its sameAs
//
// The proposal is shaped so BOTH apply paths accept it:
//   • apply/nextjs.mjs → advisory (templated per-URL JSON-LD; dev team injects in generateMetadata)
//   • apply/edge.mjs   → type "schema.entity-graph" maps via cloaking-guard fieldOf → "jsonld",
//     so buildOverlay pushes `proposed` into node.jsonld[] (server-rendered, edge-live).

import { getEntity, queryByEntity } from './graph.mjs';

/** Pick the org's schema type: med-spa vertical → MedicalBusiness, else LocalBusiness/Organization. */
function orgType(cfg) {
  if (cfg.vertical === 'medspa') return ['MedicalBusiness', 'LocalBusiness'];
  if (cfg.locations?.length || cfg.listings?.canonicalNap) return 'LocalBusiness';
  return 'Organization';
}

/** Build the Organization / LocalBusiness node from cfg + the graph's org entity. */
function buildOrgNode(cfg, graph) {
  const base = (cfg.baseUrl || `https://${cfg.domain}`).replace(/\/$/, '');
  const orgId = `${base}/#org`;
  const stored = getEntity(graph, orgId);
  const nap = cfg.listings?.canonicalNap || null;
  const node = {
    '@type': orgType(cfg),
    '@id': orgId,
    name: cfg.brand,
    url: base,
  };
  const sameAs = stored?.sameAs?.length ? stored.sameAs : (cfg.socialProfiles || cfg.listings?.socialProfiles || []);
  if (sameAs?.length) node.sameAs = [...new Set(sameAs)];
  if (nap) {
    if (nap.phone) node.telephone = nap.phone;
    const addr = { '@type': 'PostalAddress' };
    if (nap.street) addr.streetAddress = nap.street;
    if (nap.city) addr.addressLocality = nap.city;
    if (nap.state) addr.addressRegion = nap.state;
    if (nap.zip) addr.postalCode = nap.zip;
    if (Object.keys(addr).length > 1) node.address = addr;
  }
  return node;
}

/** Build a referenced entity node (treatment/condition/etc.) keyed by its @id. */
function buildEntityNode(entity) {
  const node = { '@type': entity['@type'] || 'Thing', '@id': entity['@id'], name: entity.name };
  if (entity.sameAs?.length) node.sameAs = entity.sameAs;
  if (entity.synonyms?.length) node.alternateName = entity.synonyms;
  return node;
}

/**
 * Emit a JSON-LD @graph for one page + a ship-ready proposal.
 *
 * @param {{url:string}|string} page   the page (object with .url, or a URL string)
 * @param {object} graph               a loaded entity graph (entity/graph.loadGraph)
 * @param {object} cfg                 client config
 * @returns {{ jsonld:object, proposal:object|null, about:object|null, mentions:object[] }}
 */
export function emitEntityGraph(page, graph, cfg) {
  const url = (typeof page === 'string' ? page : page?.url || '').replace(/#.*$/, '');
  const roles = graph.pages[url] || { about: [], mentions: [] };

  const orgNode = buildOrgNode(cfg, graph);
  const nodes = [orgNode];

  // WebPage node carrying about/mentions (the entity-grounding lever).
  const webPage = { '@type': 'WebPage', '@id': `${url}#webpage`, url, isPartOf: { '@id': orgNode['@id'] } };
  const aboutIds = (roles.about || []).filter((id) => id !== orgNode['@id']);
  const mentionIds = (roles.mentions || []).filter((id) => id !== orgNode['@id']);

  // Referenced entity nodes (deduped). about → first id; mentions → rest.
  const referenced = new Map();
  let aboutEntity = null;
  for (const id of aboutIds) { const e = getEntity(graph, id); if (e) { referenced.set(id, buildEntityNode(e)); if (!aboutEntity) aboutEntity = e; } }
  for (const id of mentionIds) { const e = getEntity(graph, id); if (e && !referenced.has(id)) referenced.set(id, buildEntityNode(e)); }

  if (aboutEntity) webPage.about = { '@id': aboutEntity['@id'] };
  // Org is always at least a mention of every page (publisher relation) + topical mentions.
  const mentionRefs = [{ '@id': orgNode['@id'] }, ...mentionIds.map((id) => ({ '@id': id }))];
  if (mentionRefs.length) webPage.mentions = dedupeRefs(mentionRefs);

  nodes.push(webPage, ...referenced.values());

  const jsonld = { '@context': 'https://schema.org', '@graph': nodes };

  // No about/mentions topical entity → no entity proposal worth shipping (org-only schema is
  // already handled by schema.mjs); return the graph but a null proposal.
  const proposal = (aboutEntity || mentionIds.length)
    ? {
        id: `entity-graph:${url}`,
        type: 'schema.entity-graph',          // fieldOf → "jsonld" (edge-safe; nextjs advisory)
        page: url,
        severity: 'medium',
        autoApplicable: false,                // per-URL JSON-LD → human/dev-team injects (med-spa = never auto)
        current: '(no @id entity @graph)',
        proposed: jsonld,
        rationale: `Entity @graph: page is about ${aboutEntity ? aboutEntity.name : '—'}` +
          `${mentionIds.length ? `, mentions ${mentionIds.length} more` : ''}; org carries ${orgNode.sameAs?.length || 0} sameAs. ` +
          'about/mentions + dereferenceable @id is the linked-data lever AI engines ground on (OTTO can\'t add the @id route).',
      }
    : null;

  return { jsonld, proposal, about: aboutEntity || null, mentions: mentionIds.map((id) => getEntity(graph, id)).filter(Boolean) };
}

function dedupeRefs(refs) {
  const seen = new Set(); const out = [];
  for (const r of refs) { if (!seen.has(r['@id'])) { seen.add(r['@id']); out.push(r); } }
  return out;
}

/**
 * Emit entity-graph proposals for every page in the graph that has roles.
 * Convenience wrapper for the orchestrator step.
 * @returns {{proposals:object[], jsonldByUrl:Object<string,object>}}
 */
export function emitAll(graph, cfg) {
  const proposals = [], jsonldByUrl = {};
  for (const url of Object.keys(graph.pages)) {
    const { jsonld, proposal } = emitEntityGraph(url, graph, cfg);
    jsonldByUrl[url] = jsonld;
    if (proposal) proposals.push(proposal);
  }
  return { proposals, jsonldByUrl };
}

export { queryByEntity };
