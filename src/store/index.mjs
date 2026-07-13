// seo-bot · store — ONE driver interface, three drivers (store/CONTRACT.md v1).
//
//   getStore(env, opts) -> org-scoped store facade over a StoreDriver:
//     driver 'fs'       — local reports/ files (DEFAULT when nothing is configured; org '_default'
//                         maps to today's --local filenames: dashboard-pending.json etc.)
//     driver 'gh'       — the gh-CLI seenai-queue wire, extracted verbatim from src/dashboard.mjs
//                         (sha-CAS puts, base64 contents API, legacy unprefixed paths for '_default')
//     driver 'postgres' — store/schema.sql via an OPTIONAL dynamic `pg` import; selected by
//                         DATABASE_URL. `pg` missing -> getStore REFUSES with install instructions
//                         (fail closed — never a silent fallback that hides misconfiguration).
//
// DUAL-USE MANDATE: with no env configured every consumer behaves byte-for-byte like today —
// src/dashboard.mjs passes { defaultDriver: 'gh' } so its remote wire stays the seenai-queue
// repo, and `--local` flows never construct a store at all. SaaS (postgres / SEENAI_ORG) is
// opt-in by env, never default-on. The future runner (src/runner.mjs, S3) consumes this same
// getStore() for work-orders/heartbeats.
//
// Fail-closed rules implemented here (CONTRACT §1–§3):
//   * invalid path segment / unknown kind / invalid org  -> refuse (null / {ok:false} / throw at getStore)
//   * malformed stored docs read as ABSENT (null); auth-bearing kinds absent = deny
//   * readLimits missing/malformed row -> MOST-RESTRICTIVE default (all-zero allowance)
//   * unknown work-order type -> refused, nothing written
//   * claimWorkOrder is atomic-ish per driver (pg claim_work_order(); gh sha-CAS; fs 'wx' lockfile)
//   * audit is append-only: putJson/deleteJson on audit/* refuse; only appendLog works

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, appendFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../config.mjs';

// ---------------------------------------------------------------- keyspace + validation

/** CONTRACT §1: path segments (64 chars). Shot FILENAME segments get 128 per schema.sql shots.name. */
const SEG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const FILE_SEG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** CONTRACT §2: org slug ('_default' is the only underscore-prefixed org). */
const ORG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** schema.sql client slug. */
export const CLIENT_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
/** CONTRACT §3.12: CLOSED work-order type enum — unknown type is refused, never executed. */
export const WORK_ORDER_TYPES = Object.freeze(['sync-dashboard', 'weekly-run', 'first-audit']);
/** CONTRACT §3.11: missing/malformed limits row = all-zero allowance (most restrictive). */
export const NO_ALLOWANCE = Object.freeze({ plan: null, sites: 0, promptsPerWeek: 0, experiments: 0, missing: true });

const KINDS = new Set(['pending', 'decisions', 'artifacts', 'tracking', 'shots', 'settings',
  'orgs', 'members', 'login-limits', 'shares', 'limits', 'work-orders', 'runners', 'audit']);
/** Kinds whose '_default' org maps to legacy v0 UNPREFIXED gh paths (CONTRACT §2 table). */
const LEGACY_KINDS = new Set(['pending', 'decisions', 'artifacts', 'tracking', 'shots', 'settings']);

/** Parse + validate a canonical store path. Invalid segment / unknown kind -> null (refuse). */
export function parseStorePath(path) {
  if (typeof path !== 'string' || !path) return null;
  const segs = path.split('/');
  if (segs.length < 2 || segs.length > 4) return null;
  const kind = segs[0];
  if (!KINDS.has(kind)) return null;
  for (let i = 1; i < segs.length; i++) {
    // last (file) segment may be a 128-char shot name (schema.sql shots.name); traversal armor:
    // both REs require an alnum/_ first char, so '.', '..' and '' can never pass.
    const re = i === segs.length - 1 ? FILE_SEG_RE : SEG_RE;
    if (!re.test(segs[i])) return null;
  }
  return { kind, segs };
}

export function validOrg(org) { return org === '_default' || (typeof org === 'string' && ORG_RE.test(org)); }

const stripExt = (n) => String(n).replace(/\.(json|ndjson|png)$/, '');
const nowIso = () => new Date().toISOString();
const rand6 = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/** gh path mapping: '_default' org drops the org segment for legacy kinds (CONTRACT §2). */
export function ghPathFor(path) {
  const p = parseStorePath(path);
  if (!p) return null;
  if (LEGACY_KINDS.has(p.kind) && p.segs[1] === '_default') return [p.kind, ...p.segs.slice(2)].join('/');
  return p.segs.join('/');
}

// ---------------------------------------------------------------- fs driver (default)

/** '_default' legacy mapping: the exact filenames `dashboard --local` uses today. */
function fsFileFor(root, path) {
  const p = parseStorePath(path);
  if (!p) return null;
  const { kind, segs } = p;
  if (segs[1] === '_default' && LEGACY_KINDS.has(kind)) {
    const rep = (c) => join(root, 'reports', c);
    if (kind === 'pending' && segs.length === 3) return join(rep(stripExt(segs[2])), 'dashboard-pending.json');
    if (kind === 'tracking' && segs.length === 3) return join(rep(stripExt(segs[2])), 'dashboard-tracking.json');
    if (kind === 'artifacts' && segs.length === 3) return join(rep(stripExt(segs[2])), 'dashboard-bundle.json');
    if (kind === 'settings' && segs.length === 3) return join(rep(stripExt(segs[2])), 'dashboard-settings.json');
    if (kind === 'decisions' && segs.length === 4) return join(rep(segs[2]), 'dashboard-decisions', segs[3]);
    if (kind === 'shots' && segs.length === 4) return join(rep(segs[2]), 'shots', segs[3]);
  }
  return join(root, 'reports', '_store', ...segs); // canonical layout for everything else
}

function fsDirFor(root, path) {
  const p = parseStorePath(path);
  if (!p) return null;
  const { kind, segs } = p;
  if (segs[1] === '_default' && LEGACY_KINDS.has(kind)) {
    if (['pending', 'tracking', 'artifacts', 'settings'].includes(kind) && segs.length === 2) return { mode: 'legacy-clients', kind };
    if (kind === 'decisions' && segs.length === 3) return { mode: 'dir', dir: join(root, 'reports', segs[2], 'dashboard-decisions') };
    if (kind === 'shots' && segs.length === 3) return { mode: 'dir', dir: join(root, 'reports', segs[2], 'shots') };
  }
  return { mode: 'dir', dir: join(root, 'reports', '_store', ...segs) };
}

const LEGACY_FILE = { pending: 'dashboard-pending.json', tracking: 'dashboard-tracking.json', artifacts: 'dashboard-bundle.json', settings: 'dashboard-settings.json' };

export function createFsDriver({ root = ROOT } = {}) {
  const readJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : null; } catch { return null; } };
  return {
    kind: 'fs', root,
    configured: () => true, // local files are always available (in-house mode)
    getJson(path) { const f = fsFileFor(root, path); return f ? readJson(f) : null; },
    putJson(path, doc, _message) {
      const p = parseStorePath(path);
      if (!p) return { ok: false, error: 'invalid-path' };
      if (p.kind === 'audit') return { ok: false, error: 'append-only' }; // audit only via appendLog
      const f = fsFileFor(root, path);
      try { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(doc, null, 2)); return { ok: true, path: path }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    deleteJson(path, _message) {
      const p = parseStorePath(path);
      if (!p) return { ok: false, error: 'invalid-path' };
      if (p.kind === 'audit') return { ok: false, error: 'append-only' };
      try { rmSync(fsFileFor(root, path), { force: true }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
    },
    listDir(dirPath) {
      const d = fsDirFor(root, dirPath);
      if (!d) return [];
      try {
        if (d.mode === 'legacy-clients') {
          const reps = join(root, 'reports');
          if (!existsSync(reps)) return [];
          return readdirSync(reps, { withFileTypes: true })
            .filter((e) => e.isDirectory() && existsSync(join(reps, e.name, LEGACY_FILE[d.kind]))).map((e) => e.name);
        }
        if (!existsSync(d.dir)) return [];
        return readdirSync(d.dir).map(stripExt);
      } catch { return []; }
    },
    getBlob(path) { const f = fsFileFor(root, path); try { return f && existsSync(f) ? readFileSync(f) : null; } catch { return null; } },
    putBlob(path, buffer, _message) {
      const p = parseStorePath(path);
      if (!p || !Buffer.isBuffer(buffer)) return { ok: false, error: 'invalid-path-or-buffer' };
      const f = fsFileFor(root, path);
      try { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, buffer); return { ok: true, path: ghPathFor(path) }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    appendLog(path, row) {
      const p = parseStorePath(path);
      if (!p || p.kind !== 'audit') return { ok: false, error: 'append-log-is-audit-only' };
      const f = fsFileFor(root, path);
      try { mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, JSON.stringify(row) + '\n'); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    claimWorkOrder(org, runnerId, types) {
      const dir = join(root, 'reports', '_store', 'work-orders', org);
      let names = [];
      try { names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')) : []; } catch { return null; }
      const orders = names.map((n) => ({ n, doc: readJson(join(dir, n)) }))
        .filter((o) => o.doc && o.doc.status === 'queued' && types.includes(o.doc.type))
        .sort((a, b) => String(a.doc.createdAt || '').localeCompare(String(b.doc.createdAt || '')) || a.n.localeCompare(b.n));
      for (const o of orders) {
        const lock = join(dir, o.n + '.claim');
        try { writeFileSync(lock, runnerId, { flag: 'wx' }); } catch { continue; } // lost the race → next order
        try {
          const fresh = readJson(join(dir, o.n));
          if (!fresh || fresh.status !== 'queued') continue; // claimed between scan and lock
          const claimed = { ...fresh, status: 'claimed', claimedBy: runnerId, claimedAt: nowIso(), attempts: (fresh.attempts || 0) + 1 };
          writeFileSync(join(dir, o.n), JSON.stringify(claimed, null, 2));
          return claimed;
        } finally { try { unlinkSync(lock); } catch { /* status='claimed' is the durable claim */ } }
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------- gh driver (extracted VERBATIM from src/dashboard.mjs)

export function createGhDriver(env = process.env) {
  const repo = env.SEO_BOT_STORE_REPO || env.STORE_REPO || 'supahotthanos/seenai-queue';
  // verbatim: same gh invocation, encoding, maxBuffer, stdio as the old dashboard.mjs ghApi()
  const gh = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf-8', input, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  const raw = (p) => JSON.parse(gh([`repos/${repo}/contents/${p}`])); // {content(base64), sha}
  const casPut = (p, contentB64, message, sha) => gh([`repos/${repo}/contents/${p}`, '-X', 'PUT', '--input', '-'], JSON.stringify({ message, content: contentB64, ...(sha ? { sha } : {}) }));
  return {
    kind: 'gh', repo,
    configured: () => true, // repo always resolves (default seenai-queue) — same assumption as today
    getJson(path) {
      const p = ghPathFor(path); if (!p) return null;
      try { return JSON.parse(Buffer.from(raw(p).content, 'base64').toString('utf8')); } catch { return null; }
    },
    // Optional CAS pair (CONTRACT §1): rev = the blob sha of the read. putJsonRev writes
    // ONLY if the file is still at rev — a concurrent writer (e.g. an admin flipping a
    // runner row to 'revoked') makes the put FAIL instead of being overwritten.
    getJsonMeta(path) {
      const p = ghPathFor(path); if (!p) return null;
      try { const j = raw(p); return { doc: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), rev: j.sha }; } catch { return null; }
    },
    putJsonRev(path, doc, message, rev) {
      const pp = parseStorePath(path);
      if (!pp) return { ok: false, error: 'invalid-path' };
      if (pp.kind === 'audit') return { ok: false, error: 'append-only' };
      if (typeof rev !== 'string' || !rev) return { ok: false, error: 'rev-required' }; // CAS without a rev is a plain overwrite — refuse
      const p = ghPathFor(path);
      try { casPut(p, Buffer.from(JSON.stringify(doc)).toString('base64'), message || `put ${p}`, rev); return { ok: true, path: p }; }
      catch (e) { return { ok: false, error: e.message, race: true }; } // lost the CAS: caller must re-read, never retry blind
    },
    putJson(path, doc, message) {
      const pp = parseStorePath(path);
      if (!pp) return { ok: false, error: 'invalid-path' };
      if (pp.kind === 'audit') return { ok: false, error: 'append-only' };
      const p = ghPathFor(path);
      try {
        let sha = null; try { sha = raw(p).sha; } catch { /* new file */ }
        casPut(p, Buffer.from(JSON.stringify(doc)).toString('base64'), message || `put ${p}`, sha);
        return { ok: true, path: p };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    deleteJson(path, message) {
      const pp = parseStorePath(path);
      if (!pp) return { ok: false, error: 'invalid-path' };
      if (pp.kind === 'audit') return { ok: false, error: 'append-only' };
      const p = ghPathFor(path);
      let sha = null;
      try { sha = raw(p).sha; } catch { return { ok: true }; } // deleting an absent doc → ok (contract)
      try { gh([`repos/${repo}/contents/${p}`, '-X', 'DELETE', '--input', '-'], JSON.stringify({ message: message || `delete ${p}`, sha })); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    listDir(dirPath) {
      const p = ghPathFor(dirPath); if (!p) return [];
      try {
        const files = JSON.parse(gh([`repos/${repo}/contents/${p}`]));
        return (Array.isArray(files) ? files : []).map((f) => (f.type === 'dir' ? f.name : stripExt(f.name)));
      } catch { return []; }
    },
    getBlob(path) {
      const p = ghPathFor(path); if (!p) return null;
      try { return Buffer.from(raw(p).content, 'base64'); } catch { return null; }
    },
    putBlob(path, buffer, message) {
      const p = ghPathFor(path);
      if (!p || !Buffer.isBuffer(buffer)) return { ok: false, error: 'invalid-path-or-buffer' };
      try {
        let sha = null; try { sha = raw(p).sha; } catch { /* new */ }
        casPut(p, buffer.toString('base64'), message || `blob ${p}`, sha);
        return { ok: true, path: p };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    appendLog(path, row) {
      const pp = parseStorePath(path);
      if (!pp || pp.kind !== 'audit') return { ok: false, error: 'append-log-is-audit-only' };
      const p = ghPathFor(path);
      try {
        let sha = null, prev = '';
        try { const j = raw(p); sha = j.sha; prev = Buffer.from(j.content, 'base64').toString('utf8'); } catch { /* new monthly file */ }
        casPut(p, Buffer.from(prev + JSON.stringify(row) + '\n').toString('base64'), `audit append`, sha); // sha-CAS → lost race throws, caller may retry
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    /** Optimized decisions consumption — EXACTLY today's ghStorePull loop (read content+sha once, delete with that sha). */
    readDecisions(org, client, { cleanup = true } = {}) {
      const base = ghPathFor(`decisions/${org}/${client}`); if (!base) return [];
      let files = [];
      try { files = JSON.parse(gh([`repos/${repo}/contents/${base}`])); } catch { return []; }
      const decisions = [];
      for (const f of (Array.isArray(files) ? files : [])) {
        if (!String(f.name).endsWith('.json')) continue;
        try {
          const j = raw(`${base}/${f.name}`);
          const blob = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
          for (const d of (blob.decisions || [])) decisions.push(d);
          if (cleanup) { try { gh([`repos/${repo}/contents/${base}/${f.name}`, '-X', 'DELETE', '--input', '-'], JSON.stringify({ message: `consume ${f.name}`, sha: j.sha })); } catch { /* */ } }
        } catch { /* skip bad decision file */ }
      }
      return decisions;
    },
    claimWorkOrder(org, runnerId, types) {
      const base = `work-orders/${org}`;
      let files = [];
      try { files = JSON.parse(gh([`repos/${repo}/contents/${base}`])); } catch { return null; }
      const named = (Array.isArray(files) ? files : []).filter((f) => String(f.name).endsWith('.json'))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))); // wo_<epochMs>_ → name order ≈ created order
      for (const f of named) {
        try {
          const j = raw(`${base}/${f.name}`);
          const doc = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
          if (!doc || doc.status !== 'queued' || !types.includes(doc.type)) continue;
          const claimed = { ...doc, status: 'claimed', claimedBy: runnerId, claimedAt: nowIso(), attempts: (doc.attempts || 0) + 1 };
          casPut(`${base}/${f.name}`, Buffer.from(JSON.stringify(claimed)).toString('base64'), `claim ${doc.id} by ${runnerId}`, j.sha); // sha-CAS: lost race throws → try next
          return claimed;
        } catch { continue; }
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------- selection + org-scoped facade

/**
 * getStore(env, opts) -> org-scoped store facade (async: the postgres driver is a dynamic import).
 *
 * Selection precedence (fail closed at every step):
 *   1. opts.driver || env.SEENAI_STORE_DRIVER   — explicit; unknown value → REFUSE
 *   2. env.DATABASE_URL                          — postgres ('pg' missing → REFUSE with instructions)
 *   3. env.SEO_BOT_STORE_REPO || env.STORE_REPO  — gh
 *   4. opts.defaultDriver || 'fs'                — nothing configured → local files
 *                                                  (dashboard.mjs passes defaultDriver:'gh' so its
 *                                                   remote wire is byte-identical to today)
 * Org: opts.org || env.SEENAI_ORG || '_default'; invalid slug → REFUSE (throw).
 *
 * Test seams: opts.pgModule (fake pg), opts.pgImport (importer override), opts.root (fs root).
 */
export async function getStore(env = process.env, opts = {}) {
  const org = opts.org || env.SEENAI_ORG || '_default';
  if (!validOrg(org)) {
    throw new Error(`store: invalid org "${org}" — must match ^[a-z0-9][a-z0-9-]{0,31}$ ('_default' is the only underscore-prefixed org). Refusing (fail closed).`);
  }
  let which = opts.driver || env.SEENAI_STORE_DRIVER || null;
  if (which && !['fs', 'gh', 'postgres'].includes(which)) {
    throw new Error(`store: unknown driver "${which}" (SEENAI_STORE_DRIVER) — valid: fs | gh | postgres. Refusing (fail closed).`);
  }
  if (!which) {
    if (env.DATABASE_URL) which = 'postgres';
    else if (env.SEO_BOT_STORE_REPO || env.STORE_REPO) which = 'gh';
    else which = opts.defaultDriver || 'fs';
  }

  let driver;
  if (which === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('store: driver "postgres" selected but DATABASE_URL is not set. Refusing (fail closed).');
    let pg = opts.pgModule || null;
    if (!pg) {
      const importer = opts.pgImport || ((s) => import(s));
      try { const m = await importer('pg'); pg = m?.default || m; } catch { pg = null; }
    }
    if (!pg || !pg.Pool) {
      throw new Error(
        'store: DATABASE_URL is set but the optional `pg` dependency is not installed.\n' +
        '  Install it:   npm install pg\n' +
        '  …or unset DATABASE_URL to keep using the gh/fs store.\n' +
        'Refusing to start with a silent fallback (fail closed — store/CONTRACT.md §1).');
    }
    const { createPgDriver } = await import('./pg-driver.mjs');
    driver = createPgDriver(new pg.Pool({ connectionString: env.DATABASE_URL }));
  } else if (which === 'gh') {
    driver = createGhDriver(env);
  } else {
    driver = createFsDriver({ root: opts.root || ROOT });
  }
  return wrapStore(driver, org);
}

/** Org-scoped semantic operations over a raw driver (paths built per CONTRACT §2/§3). */
export function wrapStore(driver, org) {
  const clientOk = (c) => typeof c === 'string' && CLIENT_RE.test(c);
  const store = {
    driver: driver.kind, org, raw: driver,
    configured: () => driver.configured(),

    // -- contract interface, delegated (canonical org-scoped paths in, driver mapping inside) --
    getJson: (p) => driver.getJson(p),
    putJson: (p, doc, m) => driver.putJson(p, doc, m),
    // optional CAS pair — delegated ONLY when the driver can compare-and-swap (gh sha-CAS)
    ...(typeof driver.getJsonMeta === 'function' && typeof driver.putJsonRev === 'function'
      ? { getJsonMeta: (p) => driver.getJsonMeta(p), putJsonRev: (p, doc, m, rev) => driver.putJsonRev(p, doc, m, rev) }
      : {}),
    deleteJson: (p, m) => driver.deleteJson(p, m),
    listDir: (p) => driver.listDir(p),
    getBlob: (p) => driver.getBlob(p),
    putBlob: (p, b, m) => driver.putBlob(p, b, m),
    appendLog: (p, row) => driver.appendLog(p, row),

    // -- pending / decisions / artifacts / tracking / settings / shots --
    readPending: (client) => clientOk(client) ? driver.getJson(`pending/${org}/${client}.json`) : null,
    writePending: (client, doc, message) => clientOk(client)
      ? driver.putJson(`pending/${org}/${client}.json`, doc, message || `push pending ${client} (${doc?.count ?? 0})`)
      : { ok: false, error: 'invalid-client' },
    async readDecisions(client, { cleanup = true } = {}) {
      if (!clientOk(client)) return [];
      if (driver.readDecisions) return driver.readDecisions(org, client, { cleanup }); // gh keeps its verbatim single-read+sha-delete loop
      const base = `decisions/${org}/${client}`;
      const names = await driver.listDir(base);
      const outArr = [];
      for (const n of names) {
        const p = `${base}/${n}.json`;
        const doc = await driver.getJson(p);
        if (doc && Array.isArray(doc.decisions)) outArr.push(...doc.decisions);
        if (doc && cleanup) await driver.deleteJson(p, `consume ${n}.json`);
      }
      return outArr;
    },
    writeDecision: (client, doc, { id, message } = {}) => clientOk(client)
      ? driver.putJson(`decisions/${org}/${client}/${id || `${Date.now()}-${rand6()}`}.json`, doc, message || `decision ${client}`)
      : { ok: false, error: 'invalid-client' },
    writeArtifact: (client, bundle, message) => clientOk(client)
      ? driver.putJson(`artifacts/${org}/${client}.json`, bundle, message || `publish bundle ${client}`)
      : { ok: false, error: 'invalid-client' },
    readArtifact: (client) => clientOk(client) ? driver.getJson(`artifacts/${org}/${client}.json`) : null,
    writeTracking: (client, doc, message) => clientOk(client)
      ? driver.putJson(`tracking/${org}/${client}.json`, doc, message || `push tracking ${client}`)
      : { ok: false, error: 'invalid-client' },
    readSettings: (client) => clientOk(client) ? driver.getJson(`settings/${org}/${client}.json`) : null,
    writeSettings: (client, doc, message) => clientOk(client)
      ? driver.putJson(`settings/${org}/${client}.json`, doc, message || `settings ${client}`)
      : { ok: false, error: 'invalid-client' },
    writeShot: (client, name, buffer, message) => clientOk(client)
      ? driver.putBlob(`shots/${org}/${client}/${name}`, buffer, message || `shot ${client}/${name}`)
      : { ok: false, error: 'invalid-client' },
    readShot: (client, name) => clientOk(client) ? driver.getBlob(`shots/${org}/${client}/${name}`) : null,

    // -- work orders (closed enum; claim gated on an ACTIVE runner row — fail closed) --
    writeWorkOrder(order) {
      const t = order && order.type;
      if (!WORK_ORDER_TYPES.includes(t)) return { ok: false, error: `unknown-type:${t}` }; // refuse, write nothing
      if (!clientOk(order.client)) return { ok: false, error: 'invalid-client' };
      const id = order.id || `wo_${Date.now()}_${rand6()}`;
      const doc = {
        id, type: t, client: order.client, status: 'queued',
        createdAt: order.createdAt || nowIso(), createdBy: order.createdBy || null,
        claimedBy: null, claimedAt: null, finishedAt: null, attempts: 0, result: null, error: null,
      };
      const res = driver.putJson(`work-orders/${org}/${id}.json`, doc, `enqueue ${t} ${order.client}`);
      return res && res.ok ? { ok: true, order: doc } : res;
    },
    async claimWorkOrder(runnerId, types) {
      const known = (Array.isArray(types) ? types : []).filter((t) => WORK_ORDER_TYPES.includes(t));
      if (!known.length || typeof runnerId !== 'string' || !runnerId) return null;
      const runner = await driver.getJson(`runners/${org}/${runnerId}.json`);
      if (!runner || runner.status !== 'active') return null; // missing/malformed/revoked runner → deny claim (CONTRACT §3.13)
      return driver.claimWorkOrder(org, runnerId, known);
    },
    async heartbeat(runnerId) {
      if (typeof runnerId !== 'string' || !runnerId) return { ok: false, error: 'invalid-runner-id' };
      const p = `runners/${org}/${runnerId}.json`;
      const gate = (row) => {
        if (!row || typeof row !== 'object' || !row.id) return { ok: false, error: 'unknown-runner' }; // deny, never create
        if (row.status !== 'active') return { ok: false, error: `runner-${row.status || 'malformed'}` };
        return null;
      };
      const at = nowIso();
      // Race guard (same finding as the runner's own heartbeat): a concurrent revocation
      // between read and write must never be resurrected. CAS when the driver can; else
      // merge onto a row re-read IMMEDIATELY before the write.
      if (typeof driver.getJsonMeta === 'function' && typeof driver.putJsonRev === 'function') {
        const meta = await driver.getJsonMeta(p);
        const bad = gate(meta && meta.doc); if (bad) return bad;
        const res = await driver.putJsonRev(p, { ...meta.doc, lastHeartbeatAt: at }, `heartbeat ${runnerId}`, meta.rev);
        if (res && res.ok) return { ok: true, at };
        const fresh = await driver.getJson(p);            // lost the CAS — observe, never overwrite
        return gate(fresh) || { ok: false, error: 'heartbeat-race-lost' };
      }
      const runner = await driver.getJson(p);
      const bad = gate(runner); if (bad) return bad;
      const fresh = await driver.getJson(p);              // re-read immediately before the write
      const badF = gate(fresh); if (badF) return badF;
      const res = await driver.putJson(p, { ...fresh, lastHeartbeatAt: at }, `heartbeat ${runnerId}`);
      return res && res.ok ? { ok: true, at } : res;
    },

    // -- limits (HARD fail-closed: missing/malformed row = all-zero allowance) --
    async readLimits() {
      const j = await driver.getJson(`limits/${org}.json`);
      const ints = ['sites', 'promptsPerWeek', 'experiments'];
      if (!j || typeof j !== 'object' || !ints.every((k) => Number.isInteger(j[k]) && j[k] >= 0)) return { ...NO_ALLOWANCE };
      return { plan: j.plan ?? null, sites: j.sites, promptsPerWeek: j.promptsPerWeek, experiments: j.experiments, updatedAt: j.updatedAt ?? null, missing: false };
    },

    // -- org row (auth-bearing: absent/malformed = deny) --
    async readOrg() {
      const j = await driver.getJson(`orgs/${org}.json`);
      if (!j || typeof j !== 'object' || j.id !== org || typeof j.name !== 'string') return null;
      return j;
    },

    // -- audit (append-only) --
    appendAudit(row) {
      const action = row && typeof row.action === 'string' && row.action ? row.action : null;
      if (!action) return { ok: false, error: 'audit-row-needs-action' };
      const month = nowIso().slice(0, 7); // yyyy-mm
      return driver.appendLog(`audit/${org}/${month}.ndjson`, {
        at: row.at || nowIso(), actorEmail: row.actorEmail || 'system', role: row.role ?? null,
        ip: row.ip ?? null, action, subject: row.subject ?? null, detail: row.detail ?? null,
      });
    },
  };
  return store;
}
