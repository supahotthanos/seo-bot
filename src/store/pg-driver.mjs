// seo-bot · store — Postgres driver (store/schema.sql, contract v1).
//
// Constructed by src/store/index.mjs getStore() AFTER the optional `pg` dependency resolves
// (dynamic import; missing → getStore refuses with install instructions — fail closed).
// This module itself never imports `pg`: it takes any pool with .query(text, params) —
// which is also the test seam (fake pg client in test/run.mjs).
//
// Mapping is mechanical (CONTRACT §3): the path keyspace ↔ rows. Documents in doc-jsonb
// tables are OPAQUE; column-shaped kinds (orgs/members/limits/work_orders/runners/shares/
// login_limits) map field-by-field. Fail closed: any query error or malformed row reads as
// ABSENT (null / [] / {ok:false}); only claimWorkOrder may throw (CONTRACT §1).

import { parseStorePath } from './index.mjs';

const iso = (v) => (v instanceof Date ? v.toISOString() : (v ?? null));
/** Path emailKey: lowercased email with '@'/'.' → '_' (CONTRACT §3). SQL side uses translate(). */
const EMAIL_KEY_SQL = "translate(email, '@.', '__')";

// row -> document mappers (snake_case rows in, contract-shaped docs out)
const MAP = {
  orgs: (r) => ({ id: r.id, name: r.name, plan: r.plan, status: r.status, createdAt: iso(r.created_at) }),
  members: (r) => ({ email: r.email, role: r.role, scrypt: r.scrypt, disabled: !!r.disabled, createdAt: iso(r.created_at), createdBy: r.created_by ?? null }),
  'login-limits': (r) => ({ email: r.email, windowStart: iso(r.window_start), failures: r.failures, lockedUntil: iso(r.locked_until) }),
  shares: (r) => ({ token: r.token, org: r.org_id, client: r.client, reportType: r.report_type, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at), createdBy: r.created_by ?? null }),
  limits: (r) => ({ plan: r.plan, sites: r.sites, promptsPerWeek: r.prompts_per_week, experiments: r.experiments, updatedAt: iso(r.updated_at) }),
  'work-orders': (r) => ({ id: r.id, type: r.type, client: r.client, status: r.status, createdAt: iso(r.created_at), createdBy: r.created_by ?? null, claimedBy: r.claimed_by ?? null, claimedAt: iso(r.claimed_at), finishedAt: iso(r.finished_at), attempts: r.attempts ?? 0, result: r.result ?? null, error: r.error ?? null }),
  runners: (r) => ({ id: r.id, name: r.name, pairingTokenScrypt: r.pairing_token_scrypt, pairedAt: iso(r.paired_at), lastHeartbeatAt: iso(r.last_heartbeat_at), version: r.version ?? null, status: r.status }),
};

/** Kinds stored as an opaque jsonb `doc` keyed by (org_id, client). */
const DOC_KINDS = new Set(['pending', 'artifacts', 'tracking', 'settings']);
const TABLE = { pending: 'pending', artifacts: 'artifacts', tracking: 'tracking', settings: 'settings' };
const stripExt = (n) => String(n).replace(/\.(json|ndjson|png)$/, '');

export function createPgDriver(pool) {
  const q = (text, params) => pool.query(text, params); // may reject → callers fail soft (except claim)
  const one = async (text, params) => { const r = await q(text, params); return (r && r.rows && r.rows[0]) || null; };
  const soft = async (fn, dflt) => { try { return await fn(); } catch { return dflt; } };

  return {
    kind: 'postgres',
    configured: () => true, // DATABASE_URL was required to construct this driver

    async getJson(path) {
      const p = parseStorePath(path);
      if (!p) return null;
      const { kind, segs } = p;
      return soft(async () => {
        if (DOC_KINDS.has(kind) && segs.length === 3) {
          const r = await one(`SELECT doc FROM ${TABLE[kind]} WHERE org_id = $1 AND client = $2`, [segs[1], stripExt(segs[2])]);
          return r ? r.doc : null;
        }
        if (kind === 'decisions' && segs.length === 4) {
          const r = await one('SELECT doc FROM decisions WHERE org_id = $1 AND client = $2 AND id = $3', [segs[1], segs[2], stripExt(segs[3])]);
          return r ? r.doc : null;
        }
        if (kind === 'orgs' && segs.length === 2) {
          const r = await one('SELECT id, name, plan, status, created_at FROM orgs WHERE id = $1', [stripExt(segs[1])]);
          return r ? MAP.orgs(r) : null;
        }
        if (kind === 'members' && segs.length === 3) {
          const r = await one(`SELECT email, role, scrypt, disabled, created_at, created_by FROM members WHERE org_id = $1 AND ${EMAIL_KEY_SQL} = $2`, [segs[1], stripExt(segs[2])]);
          return r ? MAP.members(r) : null;
        }
        if (kind === 'login-limits' && segs.length === 2) {
          const r = await one(`SELECT email, window_start, failures, locked_until FROM login_limits WHERE ${EMAIL_KEY_SQL} = $1`, [stripExt(segs[1])]);
          return r ? MAP['login-limits'](r) : null;
        }
        if (kind === 'shares' && segs.length === 2) {
          const r = await one('SELECT token, org_id, client, report_type, created_at, expires_at, created_by FROM shares WHERE token = $1', [stripExt(segs[1])]);
          return r ? MAP.shares(r) : null;
        }
        if (kind === 'limits' && segs.length === 2) {
          const r = await one('SELECT plan, sites, prompts_per_week, experiments, updated_at FROM limits WHERE org_id = $1', [stripExt(segs[1])]);
          return r ? MAP.limits(r) : null;
        }
        if (kind === 'work-orders' && segs.length === 3) {
          const r = await one('SELECT id, type, client, status, created_at, created_by, claimed_by, claimed_at, finished_at, attempts, result, error FROM work_orders WHERE org_id = $1 AND id = $2', [segs[1], stripExt(segs[2])]);
          return r ? MAP['work-orders'](r) : null;
        }
        if (kind === 'runners' && segs.length === 3) {
          const r = await one('SELECT id, name, pairing_token_scrypt, paired_at, last_heartbeat_at, version, status FROM runners WHERE org_id = $1 AND id = $2', [segs[1], stripExt(segs[2])]);
          return r ? MAP.runners(r) : null;
        }
        return null; // audit is append-only, shots are blobs — not JSON-gettable
      }, null);
    },

    async putJson(path, doc, _message) {
      const p = parseStorePath(path);
      if (!p) return { ok: false, error: 'invalid-path' };
      if (!doc || typeof doc !== 'object') return { ok: false, error: 'invalid-doc' };
      const { kind, segs } = p;
      if (kind === 'audit') return { ok: false, error: 'append-only' };
      return soft(async () => {
        if (DOC_KINDS.has(kind) && segs.length === 3) {
          await q(`INSERT INTO ${TABLE[kind]} (org_id, client, doc, updated_at) VALUES ($1, $2, $3, now())
                   ON CONFLICT (org_id, client) DO UPDATE SET doc = $3, updated_at = now()`,
            [segs[1], stripExt(segs[2]), doc]);
          return { ok: true, path: segs.join('/') };
        }
        if (kind === 'decisions' && segs.length === 4) {
          await q(`INSERT INTO decisions (org_id, client, id, doc) VALUES ($1, $2, $3, $4)
                   ON CONFLICT (org_id, client, id) DO UPDATE SET doc = $4`,
            [segs[1], segs[2], stripExt(segs[3]), doc]);
          return { ok: true, path: segs.join('/') };
        }
        if (kind === 'orgs' && segs.length === 2) {
          if (doc.id !== stripExt(segs[1])) return { ok: false, error: 'org-id-mismatch' };
          await q(`INSERT INTO orgs (id, name, plan, status) VALUES ($1, $2, $3, $4)
                   ON CONFLICT (id) DO UPDATE SET name = $2, plan = $3, status = $4`,
            [doc.id, doc.name, doc.plan || 'internal', doc.status || 'active']);
          return { ok: true };
        }
        if (kind === 'members' && segs.length === 3) {
          const key = String(doc.email || '').toLowerCase().replace(/[@.]/g, '_');
          if (!doc.email || key !== stripExt(segs[2])) return { ok: false, error: 'email-key-mismatch' }; // path must match the doc (fail closed)
          await q(`INSERT INTO members (org_id, email, role, scrypt, disabled, created_by) VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (org_id, email) DO UPDATE SET role = $3, scrypt = $4, disabled = $5`,
            [segs[1], String(doc.email).toLowerCase(), doc.role, doc.scrypt, !!doc.disabled, doc.createdBy ?? null]);
          return { ok: true };
        }
        if (kind === 'login-limits' && segs.length === 2) {
          if (!doc.email) return { ok: false, error: 'email-required' };
          await q(`INSERT INTO login_limits (email, window_start, failures, locked_until) VALUES ($1, $2, $3, $4)
                   ON CONFLICT (email) DO UPDATE SET window_start = $2, failures = $3, locked_until = $4`,
            [String(doc.email).toLowerCase(), doc.windowStart || new Date().toISOString(), doc.failures ?? 0, doc.lockedUntil ?? null]);
          return { ok: true };
        }
        if (kind === 'shares' && segs.length === 2) {
          await q(`INSERT INTO shares (token, org_id, client, report_type, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (token) DO UPDATE SET expires_at = $5`,
            [stripExt(segs[1]), doc.org || '_default', doc.client, doc.reportType || 'weekly', doc.expiresAt, doc.createdBy ?? null]);
          return { ok: true };
        }
        if (kind === 'limits' && segs.length === 2) {
          await q(`INSERT INTO limits (org_id, plan, sites, prompts_per_week, experiments, updated_at) VALUES ($1, $2, $3, $4, $5, now())
                   ON CONFLICT (org_id) DO UPDATE SET plan = $2, sites = $3, prompts_per_week = $4, experiments = $5, updated_at = now()`,
            [stripExt(segs[1]), doc.plan, doc.sites, doc.promptsPerWeek, doc.experiments]);
          return { ok: true };
        }
        if (kind === 'work-orders' && segs.length === 3) {
          await q(`INSERT INTO work_orders (org_id, id, type, client, status, created_by, claimed_by, claimed_at, finished_at, attempts, result, error)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                   ON CONFLICT (org_id, id) DO UPDATE SET status = $5, claimed_by = $7, claimed_at = $8, finished_at = $9, attempts = $10, result = $11, error = $12`,
            [segs[1], stripExt(segs[2]), doc.type, doc.client, doc.status || 'queued', doc.createdBy ?? null,
              doc.claimedBy ?? null, doc.claimedAt ?? null, doc.finishedAt ?? null, doc.attempts ?? 0, doc.result ?? null, doc.error ?? null]);
          return { ok: true };
        }
        if (kind === 'runners' && segs.length === 3) {
          await q(`INSERT INTO runners (org_id, id, name, pairing_token_scrypt, last_heartbeat_at, version, status) VALUES ($1, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (org_id, id) DO UPDATE SET name = $3, pairing_token_scrypt = $4, last_heartbeat_at = $5, version = $6, status = $7`,
            [segs[1], stripExt(segs[2]), doc.name, doc.pairingTokenScrypt, doc.lastHeartbeatAt ?? null, doc.version ?? null, doc.status || 'active']);
          return { ok: true };
        }
        return { ok: false, error: `unmapped-kind:${kind}` };
      }, { ok: false, error: 'pg-write-failed' });
    },

    async deleteJson(path, _message) {
      const p = parseStorePath(path);
      if (!p) return { ok: false, error: 'invalid-path' };
      const { kind, segs } = p;
      if (kind === 'audit') return { ok: false, error: 'append-only' }; // history is never rewritten
      return soft(async () => {
        if (DOC_KINDS.has(kind) && segs.length === 3) { await q(`DELETE FROM ${TABLE[kind]} WHERE org_id = $1 AND client = $2`, [segs[1], stripExt(segs[2])]); return { ok: true }; }
        if (kind === 'decisions' && segs.length === 4) { await q('DELETE FROM decisions WHERE org_id = $1 AND client = $2 AND id = $3', [segs[1], segs[2], stripExt(segs[3])]); return { ok: true }; }
        if (kind === 'shots' && segs.length === 4) { await q('DELETE FROM shots WHERE org_id = $1 AND client = $2 AND name = $3', [segs[1], segs[2], segs[3]]); return { ok: true }; }
        if (kind === 'orgs' && segs.length === 2) { await q('DELETE FROM orgs WHERE id = $1', [stripExt(segs[1])]); return { ok: true }; }
        if (kind === 'members' && segs.length === 3) { await q(`DELETE FROM members WHERE org_id = $1 AND ${EMAIL_KEY_SQL} = $2`, [segs[1], stripExt(segs[2])]); return { ok: true }; }
        if (kind === 'login-limits' && segs.length === 2) { await q(`DELETE FROM login_limits WHERE ${EMAIL_KEY_SQL} = $1`, [stripExt(segs[1])]); return { ok: true }; }
        if (kind === 'shares' && segs.length === 2) { await q('DELETE FROM shares WHERE token = $1', [stripExt(segs[1])]); return { ok: true }; }
        if (kind === 'limits' && segs.length === 2) { await q('DELETE FROM limits WHERE org_id = $1', [stripExt(segs[1])]); return { ok: true }; }
        if (kind === 'work-orders' && segs.length === 3) { await q('DELETE FROM work_orders WHERE org_id = $1 AND id = $2', [segs[1], stripExt(segs[2])]); return { ok: true }; }
        if (kind === 'runners' && segs.length === 3) { await q('DELETE FROM runners WHERE org_id = $1 AND id = $2', [segs[1], stripExt(segs[2])]); return { ok: true }; }
        return { ok: false, error: `unmapped-kind:${kind}` };
      }, { ok: false, error: 'pg-delete-failed' });
    },

    async listDir(dirPath) {
      const p = parseStorePath(dirPath);
      if (!p) return [];
      const { kind, segs } = p;
      return soft(async () => {
        const names = async (text, params) => { const r = await q(text, params); return (r.rows || []).map((x) => String(x.name)); };
        if (DOC_KINDS.has(kind) && segs.length === 2) return names(`SELECT client AS name FROM ${TABLE[kind]} WHERE org_id = $1 ORDER BY client`, [segs[1]]);
        if (kind === 'decisions' && segs.length === 3) return names('SELECT id AS name FROM decisions WHERE org_id = $1 AND client = $2 ORDER BY id', [segs[1], segs[2]]);
        if (kind === 'shots' && segs.length === 3) return (await names('SELECT name FROM shots WHERE org_id = $1 AND client = $2 ORDER BY name', [segs[1], segs[2]])).map(stripExt);
        if (kind === 'work-orders' && segs.length === 2) return names('SELECT id AS name FROM work_orders WHERE org_id = $1 ORDER BY created_at, id', [segs[1]]);
        if (kind === 'runners' && segs.length === 2) return names('SELECT id AS name FROM runners WHERE org_id = $1 ORDER BY id', [segs[1]]);
        if (kind === 'members' && segs.length === 2) return names(`SELECT ${EMAIL_KEY_SQL} AS name FROM members WHERE org_id = $1 ORDER BY email`, [segs[1]]);
        return [];
      }, []);
    },

    async getBlob(path) {
      const p = parseStorePath(path);
      if (!p || p.kind !== 'shots' || p.segs.length !== 4) return null;
      return soft(async () => {
        const r = await one('SELECT bytes FROM shots WHERE org_id = $1 AND client = $2 AND name = $3', [p.segs[1], p.segs[2], p.segs[3]]);
        return r && r.bytes != null ? Buffer.from(r.bytes) : null;
      }, null);
    },

    async putBlob(path, buffer, _message) {
      const p = parseStorePath(path);
      if (!p || p.kind !== 'shots' || p.segs.length !== 4 || !Buffer.isBuffer(buffer)) return { ok: false, error: 'invalid-path-or-buffer' };
      return soft(async () => {
        await q(`INSERT INTO shots (org_id, client, name, bytes, updated_at) VALUES ($1, $2, $3, $4, now())
                 ON CONFLICT (org_id, client, name) DO UPDATE SET bytes = $4, updated_at = now()`,
          [p.segs[1], p.segs[2], p.segs[3], buffer]);
        return { ok: true, path: p.segs.join('/') };
      }, { ok: false, error: 'pg-write-failed' });
    },

    async appendLog(path, row) {
      const p = parseStorePath(path);
      if (!p || p.kind !== 'audit' || p.segs.length !== 3) return { ok: false, error: 'append-log-is-audit-only' };
      return soft(async () => {
        await q('INSERT INTO audit (org_id, at, actor_email, role, ip, action, subject, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [p.segs[1], row.at || new Date().toISOString(), row.actorEmail ?? null, row.role ?? null, row.ip ?? null, row.action, row.subject ?? null, row.detail ?? null]);
        return { ok: true }; // audit has NO update/delete path in this driver — append-only by construction (+ schema trigger)
      }, { ok: false, error: 'pg-append-failed' });
    },

    /** ATOMIC claim via schema.sql claim_work_order() (FOR UPDATE SKIP LOCKED). May throw (contract allows). */
    async claimWorkOrder(org, runnerId, types) {
      const r = await q('SELECT * FROM claim_work_order($1, $2, $3)', [org, runnerId, types]);
      const row = r && r.rows && r.rows[0];
      return row ? MAP['work-orders'](row) : null;
    },
  };
}
