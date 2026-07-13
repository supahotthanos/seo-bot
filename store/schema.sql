-- store/schema.sql — SeenAI store, Postgres DDL (contract v1).
-- Implements store/CONTRACT.md exactly. Every tenant-owned table carries org_id with a FK
-- to orgs(id) and an index; the '_default' org is seeded so single-operator/legacy mode
-- maps cleanly (CONTRACT §2). Timestamps are timestamptz; JSON documents are jsonb and
-- OPAQUE to the store (payload shapes are owned by dashboard-contract.mjs / dashboard.mjs).
--
-- Fail-closed notes encoded here:
--   * roles / plans / work-order types+statuses are CHECK-constrained closed enums —
--     an unknown value cannot be written, so readers never have to guess.
--   * audit is append-only (trigger blocks UPDATE/DELETE).
--   * work-order claiming is an atomic UPDATE … WHERE status='queued' (see claim_work_order).

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     integer PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL
);
INSERT INTO schema_migrations (version, description)
  VALUES (1, 'contract v1 — orgs/members/login_limits/pending/decisions/artifacts/tracking/shots/settings/shares/limits/work_orders/runners/audit')
  ON CONFLICT (version) DO NOTHING;
INSERT INTO schema_migrations (version, description)
  VALUES (2, 'contract v1.1 — invites (one-time set-password, delete-on-consume) + configs (onboarding client config)')
  ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------- 3.1 orgs
CREATE TABLE IF NOT EXISTS orgs (
  id         text PRIMARY KEY CHECK (id ~ '^[a-z0-9_][a-z0-9-]{0,31}$'),
  name       text NOT NULL,
  plan       text NOT NULL DEFAULT 'internal'
             CHECK (plan IN ('starter', 'growth', 'agency', 'internal')),
  status     text NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'paused', 'churned')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Single-operator / legacy mapping: when multi-tenant is OFF, org = '_default' everywhere.
INSERT INTO orgs (id, name, plan) VALUES ('_default', 'In-house (single operator)', 'internal')
  ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------- 3.2 members
CREATE TABLE IF NOT EXISTS members (
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email      text NOT NULL CHECK (email = lower(email)),
  role       text NOT NULL
             CHECK (role IN ('owner', 'admin', 'reviewer', 'read-only')),
  -- scrypt params live WITH the hash (CONTRACT §3.2): {algo,N,r,p,keylen,salt,hash}
  scrypt     jsonb NOT NULL
             CHECK (scrypt ? 'salt' AND scrypt ? 'hash' AND scrypt ? 'N'
                    AND scrypt ? 'r' AND scrypt ? 'p' AND scrypt ? 'keylen'),
  disabled   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  PRIMARY KEY (org_id, email)
);
CREATE INDEX IF NOT EXISTS members_org_idx   ON members (org_id);
CREATE INDEX IF NOT EXISTS members_email_idx ON members (email);  -- login: find orgs by email

-- ------------------------------------- 3.3 login rate-limit counters (store-side;
-- NOT org-scoped: login precedes org resolution. Sessions are cookie-side — no table.)
CREATE TABLE IF NOT EXISTS login_limits (
  email        text PRIMARY KEY CHECK (email = lower(email)),
  window_start timestamptz NOT NULL DEFAULT now(),
  failures     integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_until timestamptz
);

-- ------------------------------------------------------------- 3.4 pending
CREATE TABLE IF NOT EXISTS pending (
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client     text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  doc        jsonb NOT NULL,          -- pushDashboard payload (schema:1 records, bot-stamped tiers)
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client)
);
CREATE INDEX IF NOT EXISTS pending_org_idx ON pending (org_id);

-- ----------------------------------------------------------- 3.5 decisions
CREATE TABLE IF NOT EXISTS decisions (
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client     text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  id         text NOT NULL,           -- <epochMs>-<rand6>
  doc        jsonb NOT NULL,          -- { client, decidedAt, decisions:[{taskId, decision, tier,
                                      --   bulk, actorEmail, role, at, ip}] }  (audit fields, §3.5)
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client, id)
);
CREATE INDEX IF NOT EXISTS decisions_org_client_idx ON decisions (org_id, client);

-- ----------------------------------------------------------- 3.6 artifacts
CREATE TABLE IF NOT EXISTS artifacts (
  org_id       text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client       text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  doc          jsonb NOT NULL,        -- bundle v1 (≤ MAX_BUNDLE_BYTES, clamp-trimmed by the bot)
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client)
);
CREATE INDEX IF NOT EXISTS artifacts_org_idx ON artifacts (org_id);

-- ------------------------------------------------------------ 3.7 tracking
CREATE TABLE IF NOT EXISTS tracking (
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client     text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  doc        jsonb NOT NULL,          -- pushTracking payload (prompt matrix + SoV)
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client)
);
CREATE INDEX IF NOT EXISTS tracking_org_idx ON tracking (org_id);

-- --------------------------------------------------------------- 3.8 shots
CREATE TABLE IF NOT EXISTS shots (
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client     text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  name       text NOT NULL CHECK (name ~ '^[A-Za-z0-9._-]{1,128}$'),
  bytes      bytea NOT NULL,          -- PNG; served only through the cookie-gated dashboard
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client, name)
);
CREATE INDEX IF NOT EXISTS shots_org_client_idx ON shots (org_id, client);

-- ------------------------------------------------------------ 3.9 settings
CREATE TABLE IF NOT EXISTS settings (
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client     text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  doc        jsonb NOT NULL,          -- { name, logoUrl, accent, updatedAt } — sanitized on read AND write
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client)
);
CREATE INDEX IF NOT EXISTS settings_org_idx ON settings (org_id);

-- ------------------------------------------------- 3.10 shares (keyed by TOKEN;
-- the 192-bit token is the capability, org rides along for scoping/cleanup)
CREATE TABLE IF NOT EXISTS shares (
  token       text PRIMARY KEY CHECK (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  org_id      text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client      text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  report_type text NOT NULL CHECK (report_type IN ('weekly')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  created_by  text
);
CREATE INDEX IF NOT EXISTS shares_org_idx ON shares (org_id);

-- ---------------------------------------------- 3.11 limits (hard fail-closed:
-- in multi-tenant mode a MISSING or malformed row = all-zero allowance = visible pause)
CREATE TABLE IF NOT EXISTS limits (
  org_id           text PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  plan             text NOT NULL CHECK (plan IN ('starter', 'growth', 'agency', 'internal')),
  sites            integer NOT NULL CHECK (sites >= 0),
  prompts_per_week integer NOT NULL CHECK (prompts_per_week >= 0),
  experiments      integer NOT NULL CHECK (experiments >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------- 3.12 work orders
CREATE TABLE IF NOT EXISTS work_orders (
  org_id      text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  id          text NOT NULL,          -- wo_<epochMs>_<rand6>
  type        text NOT NULL
              CHECK (type IN ('sync-dashboard', 'weekly-run', 'first-audit')),  -- CLOSED enum (§3.12)
  client      text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  status      text NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued', 'claimed', 'done', 'failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  claimed_by  text,                   -- runner id
  claimed_at  timestamptz,
  finished_at timestamptz,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result      jsonb,
  error       text,
  PRIMARY KEY (org_id, id),
  CHECK (status <> 'claimed' OR claimed_by IS NOT NULL)  -- a claim always names its runner
);
CREATE INDEX IF NOT EXISTS work_orders_poll_idx ON work_orders (org_id, status, created_at);

-- Atomic claim (CONTRACT §3.12 / driver claimWorkOrder): two runners can never win the same
-- order. Usage:  SELECT * FROM claim_work_order('<org>', '<runnerId>', ARRAY['weekly-run',…]);
CREATE OR REPLACE FUNCTION claim_work_order(p_org text, p_runner text, p_types text[])
RETURNS SETOF work_orders
LANGUAGE sql
AS $$
  UPDATE work_orders w
     SET status = 'claimed', claimed_by = p_runner, claimed_at = now(), attempts = w.attempts + 1
   WHERE (w.org_id, w.id) = (
           SELECT c.org_id, c.id FROM work_orders c
            WHERE c.org_id = p_org AND c.status = 'queued' AND c.type = ANY (p_types)
            ORDER BY c.created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1)
  RETURNING w.*;
$$;

-- -------------------------------------------------------------- 3.13 runners
CREATE TABLE IF NOT EXISTS runners (
  org_id             text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  id                 text NOT NULL,   -- rn_<rand8>
  name               text NOT NULL,
  pairing_token_scrypt jsonb NOT NULL -- hash only — the raw pairing token is never stored (§3.13)
              CHECK (pairing_token_scrypt ? 'salt' AND pairing_token_scrypt ? 'hash'),
  paired_at          timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at  timestamptz,     -- stamped on every poll; stale ⇒ dead-run alert (S7)
  version            text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS runners_org_idx ON runners (org_id);

-- ------------------------------------- 3.15 invites (v1.1; keyed by TOKEN like shares —
-- the one-time set-password capability; single-use = DELETE on consume, 7-day expiry)
CREATE TABLE IF NOT EXISTS invites (
  token      text PRIMARY KEY CHECK (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email      text NOT NULL CHECK (email = lower(email)),
  role       text NOT NULL
             CHECK (role IN ('owner', 'admin', 'reviewer', 'read-only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_by text                      -- admins can never mint 'owner' invites (enforced at mint, §3.15)
);
CREATE INDEX IF NOT EXISTS invites_org_idx ON invites (org_id);

-- ------------------------------------- 3.16 configs (v1.1; onboarding wizard output —
-- key set covers example.client.json; consumed by first-audit runners by convention)
CREATE TABLE IF NOT EXISTS configs (
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client     text NOT NULL CHECK (client ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$'),
  doc        jsonb NOT NULL,           -- opaque to the store (wizard + bot config loader own the shape)
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, client)
);
CREATE INDEX IF NOT EXISTS configs_org_idx ON configs (org_id);

-- ------------------------------------------------------- 3.14 audit (append-only)
CREATE TABLE IF NOT EXISTS audit (
  org_id      text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  seq         bigserial,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_email text,                   -- member email | 'runner:<id>' | 'system'
  role        text,
  ip          text,
  action      text NOT NULL,          -- decision.approve | login.locked | share.create | …
  subject     text,                   -- client | taskId | token8 | memberEmail | orderId
  detail      jsonb,
  PRIMARY KEY (org_id, seq)
);
CREATE INDEX IF NOT EXISTS audit_org_at_idx ON audit (org_id, at);

-- Append-only enforcement: history can never be rewritten (compliance surface).
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit is append-only (store/CONTRACT.md §3.14): % refused', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS audit_no_rewrite ON audit;
CREATE TRIGGER audit_no_rewrite
  BEFORE UPDATE OR DELETE ON audit
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();

COMMIT;
