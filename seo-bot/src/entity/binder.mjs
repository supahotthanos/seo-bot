// seo-bot · entity/binder — cross-domain entity binder (stub for Epic 9 §5).
//
// OTTO operates inside ONE site's runtime DOM, so it can't bind a brand's identity across
// the several properties an owner controls (a directory, the brand site, per-location
// microsites). We own all of them, so we can emit ONE consistent identity graph:
//   • an identical `sameAs` array on every property (each property's @id is sameAs every
//     other property's @id + the shared external sameAs — Wikidata/KG/socials)
//   • `parentOrganization` / `subOrganization` (or `branchOf` for locations) relations so
//     engines resolve the whole portfolio to a single entity (equity + trust flow across).
//
// Input: cfg.domains[] — either bare hosts ["a.com","b.com"] or
//   [{ domain, role:"parent"|"brand"|"location"|"directory", brand?, baseUrl? }].
// The first entry (or the one with role "parent"/"brand") is the canonical parent.
// This is a STUB: it computes the relations + sameAs (pure, no I/O). Wiring each property's
// emitted @graph (schema-emit.mjs) to consume `bindForDomain()` is the follow-up unit.

/** Normalize cfg.domains[] into a uniform property list. */
function normalizeProperties(cfg) {
  const list = (cfg.domains || []).map((d) => (typeof d === 'string' ? { domain: d } : { ...d }));
  // Always include the primary client domain as a property if not already present.
  if (cfg.domain && !list.some((p) => normHost(p.domain) === normHost(cfg.domain))) {
    list.unshift({ domain: cfg.domain, role: 'brand', brand: cfg.brand, baseUrl: cfg.baseUrl });
  }
  for (const p of list) {
    p.domain = normHost(p.domain);
    p.baseUrl = (p.baseUrl || `https://${p.domain}`).replace(/\/$/, '');
    p.orgId = `${p.baseUrl}/#org`;
    p.brand = p.brand || cfg.brand || p.domain;
    p.role = p.role || 'brand';
  }
  return list;
}

function normHost(h) { return String(h || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase(); }

/** Choose the canonical parent property (explicit role wins; else first). */
function pickParent(props) {
  return props.find((p) => p.role === 'parent') || props.find((p) => p.role === 'brand') || props.find((p) => p.role === 'directory') || props[0] || null;
}

/**
 * Build the cross-domain binding.
 * @param {object} cfg                client config (reads cfg.domains[], cfg.domain, cfg.brand)
 * @param {{externalSameAs?:string[]}} opts  shared off-domain sameAs (Wikidata/KG/socials from sources/entity.mjs)
 * @returns {{
 *   properties: Array,
 *   parent: object|null,
 *   sameAs: string[],                     // identical array every property publishes
 *   relations: Object<string, object>,    // orgId → { parentOrganization?, subOrganization?, branchOf? }
 * }}
 */
export function bindDomains(cfg, { externalSameAs = [] } = {}) {
  const properties = normalizeProperties(cfg);
  const parent = pickParent(properties);

  // The shared sameAs = every property's @id ∪ the external (Wikidata/KG/socials) sameAs.
  const sameAs = [...new Set([...properties.map((p) => p.orgId), ...externalSameAs])];

  // parent/branch relations.
  const relations = {};
  for (const p of properties) {
    relations[p.orgId] = {};
    if (!parent) continue;
    if (p.orgId === parent.orgId) {
      const subs = properties.filter((q) => q.orgId !== parent.orgId);
      if (subs.length) relations[p.orgId].subOrganization = subs.map((q) => ({ '@id': q.orgId }));
    } else if (p.role === 'location') {
      relations[p.orgId].branchOf = { '@id': parent.orgId };
      relations[p.orgId].parentOrganization = { '@id': parent.orgId };
    } else {
      relations[p.orgId].parentOrganization = { '@id': parent.orgId };
    }
  }

  return { properties, parent, sameAs, relations };
}

/**
 * For one property's org @id, return the org-node fragment to MERGE into that property's
 * emitted @graph (schema-emit.buildOrgNode): the identical sameAs + its parent/branch relations.
 * @returns {{sameAs:string[]}} merged with the relation keys for that orgId
 */
export function bindForDomain(cfg, domain, { externalSameAs = [] } = {}) {
  const { sameAs, relations, properties } = bindDomains(cfg, { externalSameAs });
  const prop = properties.find((p) => p.domain === normHost(domain));
  if (!prop) return { sameAs, ...{} };
  // A property does not list itself in sameAs (that's the @id) — exclude its own orgId.
  const own = prop.orgId;
  return { sameAs: sameAs.filter((s) => s !== own), ...(relations[own] || {}) };
}
