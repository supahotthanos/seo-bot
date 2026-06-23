// seo-bot · entity/graph — an @id-keyed entity store for one client, persisted to
// reports/<client>/entity-graph.json (file-based; NO Supabase/DB dep — the whole bot is
// plug-and-play + zero-infra by design). This is the structural lever OTTO cannot have: a
// real, dereferenceable, cross-page knowledge graph rooted on a domain WE own.
//
// Shape on disk:
//   {
//     client, domain, updatedAt,
//     entities: {                         // keyed by @id (a URI on the client domain)
//       "https://site.com/#org": { "@id", "@type", name, kind, sameAs:[], synonyms:[] },
//       "https://site.com/entity/botox#id": { … }
//     },
//     pages: {                            // page URL → roles
//       "https://site.com/services/botox": { about:["…#botox"], mentions:["…#org", …] }
//     }
//   }
//
// @id minting: the org lives at `<baseUrl>/#org`; topical entities at
// `<baseUrl>/entity/<slug>#id` (dereferenceable once Epic 9's /entity/[slug] route exists).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso, slugify } from '../util.mjs';

const dirFor = (client) => join(ROOT, 'seo-bot', 'reports', client);
const fileFor = (client) => join(dirFor(client), 'entity-graph.json');

/** Mint a stable @id on the client domain for an entity. Org gets `/#org`. */
export function mintId(cfg, entity) {
  const base = (cfg.baseUrl || `https://${cfg.domain}`).replace(/\/$/, '');
  if (entity.kind === 'organization') return `${base}/#org`;
  return `${base}/entity/${slugify(entity.name)}#id`;
}

/** Load a client's graph (or a fresh empty one). */
export function loadGraph(cfg) {
  const client = cfg.name || cfg;
  const f = fileFor(client);
  if (existsSync(f)) {
    try { return JSON.parse(readFileSync(f, 'utf-8')); } catch { /* corrupt → rebuild */ }
  }
  return { client, domain: cfg.domain || null, baseUrl: cfg.baseUrl || null, updatedAt: null, entities: {}, pages: {} };
}

/** Persist a graph back to disk. */
export function saveGraph(cfg, graph) {
  const client = cfg.name || cfg;
  mkdirSync(dirFor(client), { recursive: true });
  graph.updatedAt = nowIso();
  writeFileSync(fileFor(client), JSON.stringify(graph, null, 2));
  return fileFor(client);
}

/**
 * Insert/merge an entity node by @id (mints one if absent). Unions sameAs + synonyms so
 * repeated upserts across pages converge instead of clobbering.
 * @param {object} graph  a loaded graph (mutated + returned)
 * @param {object} cfg    client config (for @id minting)
 * @param {{name, kind, schemaType, sameAs?:string[], synonyms?:string[], '@id'?:string}} entity
 * @returns {string} the entity's @id
 */
export function upsertEntity(graph, cfg, entity) {
  const id = entity['@id'] || mintId(cfg, entity);
  const prev = graph.entities[id] || {};
  graph.entities[id] = {
    '@id': id,
    '@type': entity.schemaType || prev['@type'] || 'Thing',
    name: entity.name || prev.name,
    kind: entity.kind || prev.kind || null,
    sameAs: [...new Set([...(prev.sameAs || []), ...(entity.sameAs || [])])],
    synonyms: [...new Set([...(prev.synonyms || []), ...(entity.synonyms || [])])],
  };
  return id;
}

/**
 * Link a page to an entity with a role (about | mentions). `about` is exclusive-ish: a page
 * has at most one primary `about`; everything else is `mentions`. De-duplicates and prevents
 * the same id appearing in both roles (about wins).
 * @returns {object} the page's role record
 */
export function linkPageEntity(graph, pageUrl, entityId, role = 'mentions') {
  const url = (pageUrl || '').replace(/#.*$/, '');
  const rec = (graph.pages[url] = graph.pages[url] || { about: [], mentions: [] });
  if (role === 'about') {
    if (!rec.about.includes(entityId)) rec.about.push(entityId);
    rec.mentions = rec.mentions.filter((m) => m !== entityId); // about supersedes a prior mention
  } else {
    if (!rec.about.includes(entityId) && !rec.mentions.includes(entityId)) rec.mentions.push(entityId);
  }
  return rec;
}

/** Resolve an @id to its full entity node (or null). */
export function getEntity(graph, id) { return graph.entities[id] || null; }

/**
 * Query the graph by an entity (name OR @id) → { entity, aboutPages[], mentionPages[] }.
 * Powers "which pages are about Botox?" and the entity-detail route.
 */
export function queryByEntity(graph, nameOrId) {
  const id = graph.entities[nameOrId]
    ? nameOrId
    : Object.keys(graph.entities).find((k) => (graph.entities[k].name || '').toLowerCase() === String(nameOrId).toLowerCase());
  if (!id) return { entity: null, aboutPages: [], mentionPages: [] };
  const aboutPages = [], mentionPages = [];
  for (const [url, roles] of Object.entries(graph.pages)) {
    if (roles.about?.includes(id)) aboutPages.push(url);
    if (roles.mentions?.includes(id)) mentionPages.push(url);
  }
  return { entity: graph.entities[id], aboutPages, mentionPages };
}

/**
 * Ingest one page's extractEntities() output into the graph: upsert org + about + mentions,
 * link roles, attach resolved org sameAs. Returns the page's role ids.
 * @param {object} graph
 * @param {object} cfg
 * @param {object} extracted  output of entity/extract.extractEntities
 * @param {{orgSameAs?:string[]}} opts  org sameAs from resolveOrgSameAs (optional)
 */
export function ingestPage(graph, cfg, extracted, { orgSameAs = [] } = {}) {
  const { url, org, about, mentions = [] } = extracted;
  const aboutIds = [], mentionIds = [];

  if (org) {
    const orgId = upsertEntity(graph, cfg, { ...org, sameAs: orgSameAs });
    // The org is a mention on most pages (the page is ABOUT the treatment, mentions the brand)…
    if (about && about.name === org.name) { linkPageEntity(graph, url, orgId, 'about'); aboutIds.push(orgId); }
    else { linkPageEntity(graph, url, orgId, 'mentions'); mentionIds.push(orgId); }
  }
  if (about && about.name !== org?.name) {
    const aboutId = upsertEntity(graph, cfg, about);
    linkPageEntity(graph, url, aboutId, 'about'); aboutIds.push(aboutId);
  }
  for (const m of mentions) {
    if (org && m.name === org.name) continue; // org already linked above
    const mid = upsertEntity(graph, cfg, m);
    linkPageEntity(graph, url, mid, 'mentions'); mentionIds.push(mid);
  }
  return { url, about: aboutIds, mentions: mentionIds };
}

/** Tiny rollup for reports/CLIs. */
export function summarizeGraph(graph) {
  const kinds = {};
  for (const e of Object.values(graph.entities)) kinds[e.kind || 'unknown'] = (kinds[e.kind || 'unknown'] || 0) + 1;
  return { entities: Object.keys(graph.entities).length, pages: Object.keys(graph.pages).length, byKind: kinds };
}
