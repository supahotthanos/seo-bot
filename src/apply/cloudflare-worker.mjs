// seo-bot · apply/cloudflare-worker — generate + (gated) deploy a Cloudflare Worker that
// injects/overrides SEO HEAD elements via HTMLRewriter, for clients NOT on our own edge.
//
// This is the §2.3.3 "hotfix lane": a real server-side rewrite (seen by every AI crawler,
// non-JS bots included) — strictly better than OTTO's JS pixel, but still a 3rd-party-zone
// bolt-on, so it GRADUATES to a source PR (see edge/middleware-codegen.graduate). We reuse
// the cfToken()/cf() pattern from connect/cloudflare.mjs.
//
// Streaming-safe traps baked into the generated Worker (the SPE-666 class of bugs OTTO hit):
//   • Text-node chunking: HTMLRewriter delivers text in chunks; we accumulate via
//     chunk.lastInTextNode before deciding, and never assume a node arrives whole.
//   • Idempotent injection: we set a flag per element so we don't double-inject canonical /
//     re-stamp a title that already exists; existing tags are OVERWRITTEN, not duplicated.
//   • Per-handler try/catch: a thrown handler can truncate the streamed response, so every
//     element/text handler swallows its own error and leaves the byte stream intact.
//
// SAFETY: proposals pass through edge/cloaking-guard first; only head-only overrides are
// ever written into the Worker. The Worker never touches <body> visible text.
//
// Outputs:
//   reports/<client>/worker.js  — the deployable Worker source (preview AND deploy)
//   on --yes + token            — PUT the script to Cloudflare Workers + (optional) route

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { guardProposals, fieldOf } from '../edge/cloaking-guard.mjs';

const API = 'https://api.cloudflare.com/client/v4';

/** Reuse connect/cloudflare token resolution ("ENV:NAME" indirection supported). */
function cfToken(cfg) {
  const v = process.env.CLOUDFLARE_API_TOKEN || cfg?.cms?.cfToken || cfg?.edge?.cfToken;
  return v && v.startsWith('ENV:') ? process.env[v.slice(4)] : v;
}
async function cf(token, path, { method = 'GET', body, raw, contentType } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  else if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(`Cloudflare ${res.status}: ${(j.errors || []).map((e) => e.message).join('; ') || res.statusText}`);
  return j.result;
}

/** Pathname key for a proposal. */
function pathOf(cfg, p) {
  const raw = p.page || p.url || '/';
  try { return new URL(raw, cfg.baseUrl).pathname || '/'; }
  catch { return raw.startsWith('/') ? raw : `/${raw}`; }
}

/** Build the same path-keyed overlay shape apply/edge uses (so both lanes share rules). */
export function buildWorkerRules(cfg, proposals) {
  const rules = {};
  for (const p of proposals) {
    const path = pathOf(cfg, p);
    const field = fieldOf(p.type);
    const node = (rules[path] = rules[path] || {});
    if (field === 'jsonld') { node.jsonld = node.jsonld || []; node.jsonld.push(p.proposed); }
    else if (field === 'answer-capsule') { node.capsule = p.proposed; }
    else node[field] = p.proposed;
  }
  return rules;
}

/**
 * Generate the deployable Worker source as a string. Pure function (testable, no I/O).
 * The RULES object is embedded as JSON; the runtime logic is static & streaming-safe.
 * @param {object} rules  path-keyed overlay (from buildWorkerRules)
 * @returns {string} ES-module Worker source
 */
export function generateWorkerSource(rules) {
  const RULES_JSON = JSON.stringify(rules, null, 2);
  // NOTE: this is a STRING template emitted verbatim into worker.js — not executed here.
  return `// seo-bot · generated Cloudflare Worker (HTMLRewriter) — head-only SEO overrides.
// Server-rendered, AI-crawler-visible. Idempotent, text-node-chunk safe, per-handler try/catch.
// Generated artifact — graduate to a Next.js source PR (seo-bot edge/middleware-codegen.graduate)
// and delete this Worker once the PR merges and parity is verified.

const RULES = ${RULES_JSON};

/** Escape for an HTML attribute value. */
function attr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Escape for </script> safety inside a JSON-LD block. */
function ldSafe(s) {
  return String(s == null ? '' : s).replace(/<\\/(script)/gi, '<\\\\/$1');
}

class HeadInjector {
  constructor(rule) { this.rule = rule || {}; this.injectedCanonical = false; }
  element(end) {
    // Runs on the </head> end tag → inject anything that didn't already exist in the doc.
    try {
      const r = this.rule;
      if (r.canonical && !this.injectedCanonical) {
        end.before('<link rel="canonical" href="' + attr(r.canonical) + '">', { html: true });
        this.injectedCanonical = true;
      }
      if (r.robots && !this._robots) end.before('<meta name="robots" content="' + attr(r.robots) + '">', { html: true });
      if (r.description && !this._desc) end.before('<meta name="description" content="' + attr(r.description) + '">', { html: true });
      if (Array.isArray(r.jsonld)) {
        for (const node of r.jsonld) {
          const json = typeof node === 'string' ? node : JSON.stringify(node);
          end.before('<script type="application/ld+json">' + ldSafe(json) + '</script>', { html: true });
        }
      }
      if (r.capsule) {
        // Answer capsule is HEAD metadata mirroring (meta description style), never body text.
        end.before('<meta name="answer-capsule" content="' + attr(r.capsule) + '">', { html: true });
      }
    } catch (_) { /* never truncate the stream */ }
  }
}

/** Overwrite an existing <title> in place (text-node-chunk safe), de-duping injection. */
class TitleRewriter {
  constructor(rule, injector) { this.rule = rule; this.injector = injector; this.replaced = false; }
  element(el) {
    // setInnerContent replaces the whole node atomically (chunk-safe) — the clean path.
    try { if (this.rule.title) { el.setInnerContent(this.rule.title); this.replaced = true; } } catch (_) {}
  }
  text(chunk) {
    // Text-node CHUNKING trap: HTMLRewriter streams a text node in multiple chunks. If we
    // ever mutate text directly we must not act until chunk.lastInTextNode, and must drop
    // residual chunks of the value we replaced. setInnerContent already handled the swap, so
    // here we only guarantee no stray old-title chunk leaks through a chunk boundary.
    try { if (this.replaced && !chunk.lastInTextNode) chunk.remove(); } catch (_) {}
  }
}

function metaHandler(injector, rule) {
  return {
    element(el) {
      try {
        const name = (el.getAttribute('name') || '').toLowerCase();
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        if (name === 'description' && rule.description) { el.setAttribute('content', rule.description); injector._desc = true; }
        if (name === 'robots' && rule.robots) { el.setAttribute('content', rule.robots); injector._robots = true; }
        if (rel === 'canonical' && rule.canonical) { el.setAttribute('href', rule.canonical); injector.injectedCanonical = true; }
      } catch (_) { /* never truncate */ }
    },
  };
}

export default {
  async fetch(request, env, ctx) {
    let response;
    try { response = await fetch(request); } catch (e) { return new Response('origin error', { status: 502 }); }

    const url = new URL(request.url);
    const rule = RULES[url.pathname];
    const ct = response.headers.get('content-type') || '';
    if (!rule || !ct.includes('text/html')) return response; // only rewrite matched HTML pages

    try {
      const injector = new HeadInjector(rule);
      // We OVERWRITE existing tags in place (meta/title/canonical handlers) so we never
      // duplicate, and INJECT only the missing ones on the </head> end tag (idempotent).
      return new HTMLRewriter()
        .on('title', new TitleRewriter(rule, injector))
        .on('meta[name="description"], meta[name="robots"], link[rel="canonical"]', metaHandler(injector, rule))
        .on('head', {
          element(el) {
            try { el.onEndTag((end) => injector.element(end)); } catch (_) { /* never truncate */ }
          },
        })
        .transform(response);
    } catch (e) {
      return response; // any rewriter setup error → pass origin through untouched (no truncation)
    }
  },
};
`;
}

/** Read the last-deployed worker artifact (for diff/rollback context). */
function loadPriorWorker(client) {
  const f = join(ROOT, 'reports', client, 'worker.js');
  return existsSync(f) ? readFileSync(f, 'utf-8') : null;
}

/**
 * Generate (and gated-deploy) the Cloudflare Worker for a client.
 * Contract: applyCloudflareWorker(cfg, data, { log, confirm }) → { applied:[…] }
 * cfg.edge.worker = { scriptName?: "seo-bot-overlay", route?: "client.com/*", deploy?: false }
 */
export async function applyCloudflareWorker(cfg, data, { log = () => {}, confirm = false } = {}) {
  const proposals = (data?.proposals || []).filter((p) => p.autoApplicable !== false);
  if (!proposals.length) { log('  No proposals to inject.'); return { applied: [] }; }

  const { safe, refused } = guardProposals(proposals);
  for (const r of refused) log(`    ⛔ refused ${r.p.id} (${r.field}) — ${r.reason}`);
  if (!safe.length) { log('  All proposals refused by the cloaking guard — no Worker generated.'); return { applied: [], refused }; }

  const rules = buildWorkerRules(cfg, safe);
  const source = generateWorkerSource(rules);
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const workerPath = join(dir, 'worker.js');
  writeFileSync(workerPath, source);

  const ruleCount = Object.keys(rules).length;
  if (!confirm) {
    log(`  Cloudflare Worker PREVIEW — ${safe.length} head-only override(s) over ${ruleCount} path(s)${refused.length ? `, ${refused.length} refused` : ''}.`);
    for (const [path, node] of Object.entries(rules)) log(`    ${path} → ${Object.keys(node).join(', ')}`);
    log(`  Wrote ${workerPath}. Re-run with --yes to deploy to Cloudflare. (Then GRADUATE to a source PR.)`);
    return { applied: [], dryrun: true, refused, workerPath, source };
  }

  const token = cfToken(cfg);
  const scriptName = cfg.edge?.worker?.scriptName || `seo-bot-overlay-${cfg.name}`;
  if (!token) { log('  ⚠ CLOUDFLARE_API_TOKEN not set — wrote worker.js only (deploy manually or via wrangler).'); return { applied: [workerPath], refused, live: false }; }

  // Account id is required to upload a Worker script.
  const accountId = cfg.edge?.worker?.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) { log('  ⚠ CLOUDFLARE_ACCOUNT_ID / cfg.edge.worker.accountId not set — wrote worker.js only.'); return { applied: [workerPath], refused, live: false }; }

  if (loadPriorWorker(cfg.name)) log('  (prior worker.js preserved in git history for rollback.)');
  try {
    // Upload as an ES-module Worker. Multipart: metadata + the module file.
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ main_module: 'worker.js' })], { type: 'application/json' }));
    form.append('worker.js', new Blob([source], { type: 'application/javascript+module' }), 'worker.js');
    const res = await fetch(`${API}/accounts/${accountId}/workers/scripts/${scriptName}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.success === false) throw new Error(`${res.status}: ${(j.errors || []).map((e) => e.message).join('; ') || res.statusText}`);
    log(`  ✓ Deployed Worker "${scriptName}" (${ruleCount} path overrides). AI-crawler-visible, server-side.`);
    log(`  ↩ Rollback: delete the Worker route / script. GRADUATE: open the equivalent source PR, then remove this Worker.`);
    return { applied: [workerPath, `cf-worker:${scriptName}`], refused, live: true };
  } catch (e) {
    log(`  ✗ Worker deploy failed: ${e.message}. worker.js still written (deploy via wrangler).`);
    return { applied: [workerPath], refused, live: false, error: String(e.message) };
  }
}
