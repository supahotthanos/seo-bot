# ARCHITECTURE-SAAS — SeenAI control plane + local runner (Phase 3, S0)

> Decided 2026-07-01. This document is the binding architecture for Phase 3 (SaaS-ification).
> The data contract both repos implement against lives at [`store/CONTRACT.md`](store/CONTRACT.md)
> + [`store/schema.sql`](store/schema.sql). The safety invariants in `AGENTS.md` and the memory
> folder are NOT restated here — they are assumed, untouched, and non-negotiable.

---

## 1. The decision

The bot has two hard **local** dependencies that no cloud can replace:

1. **The `claude` CLI subscription** (`src/llm.mjs`) — no API key, no metered spend. It runs
   where the operator's Claude subscription is logged in.
2. **Residential-IP stealth measurement** (patchright/playwright on the Mac Mini) — datacenter
   IPs get blocked; block-aware measurement requires a real household network.

Therefore the SaaS is a **control plane**, not a hosted bot:

```
┌────────────────────────── CLOUD (Vercel + Postgres) ──────────────────────────┐
│  seenai-next dashboard · auth (orgs/members/roles) · store · reports/shares   │
│  onboarding · plan limits · work-order queue · runner registry · audit log    │
└──────────────────────────────────┬────────────────────────────────────────────┘
                                   │  store driver (Postgres v1 / gh-repo v0)
                                   │  work-orders down · artifacts/pending up
┌──────────────────────────────────┴────────────────────────────────────────────┐
│  LOCAL RUNNER (operator machine — Mac Mini / laptop)                           │
│  the seo-bot itself: claude CLI · stealth browser · git/gh · PR adapters       │
│  `npx seenai-runner` — pairs with a token, polls work-orders, pushes artifacts │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Cloud control plane (Vercel + Postgres):** dashboard UI, auth, the store (contract in
  `store/CONTRACT.md`), white-label reports + tokenized shares, onboarding wizard, plan
  limits, the work-order queue, runner registry/heartbeats, append-only audit log.
- **Local runner:** the bot, unchanged. A thin poller (`npx seenai-runner`, packaged from this
  repo) claims work orders from the store and executes them through the **existing CLI entry
  points** — it adds zero new write paths and inherits every gate (PR-only, verifier consensus,
  YMYL flag-only, locked horizons, spam guards).

### Phase 3a vs 3b

- **3a — single-operator (agency-in-a-box):** YOU are the only runner, serving every client.
  One org (`_default`), the runner runs on the Mac Mini. This is also the demo and the dev
  environment.
- **3b — customer-run runners:** customers install `npx seenai-runner` on their own machine
  with their own Claude subscription. **No schema migration needed** — every store row already
  carries `org_id`, runners/work-orders/limits are already per-org, and pairing tokens are
  already org-scoped. 3b is a permissions/UX release, not a data release.

---

## 2. The runner (`npx seenai-runner`)

A single new module (planned: `src/runner.mjs`, bin alias `seenai-runner`) that:

1. **Pairs once:** `npx seenai-runner pair --org <org> --token <pairing-token>` — the control
   plane generated the token; the runner stores it locally (gitignored), the store keeps only a
   **scrypt hash** (`runners/<org>` row). A runner id is minted at pairing.
2. **Polls:** every N minutes (default 5), reads `work-orders/<org>` with `status=queued`.
3. **Claims atomically:** compare-and-set claim (Postgres `UPDATE … WHERE status='queued'`;
   gh driver uses the file-sha CAS) stamping `claimedBy=<runnerId>`, `claimedAt`. Two runners
   can never both win one order.
4. **Executes by type — closed allowlist**, mapped to existing CLI flows:

   | work-order type   | executes (existing code path)                                  |
   |-------------------|----------------------------------------------------------------|
   | `sync-dashboard`  | `dashboard <client> --sync` (push pending → pull decisions)    |
   | `weekly-run`      | `weekly <client> --push` (read-loop → consensus autopilot → dashboard sync → brief) |
   | `first-audit`     | `setup`/`audit` + `dashboard <client> --push` (first proposals into the queue) |

   **Unknown type → refuse** (order marked `failed` with `error:"unknown-type:<t>"`, nothing
   executed). New types require a runner release — the runner never `eval`s work-order content.
5. **Pushes artifacts:** the same `pushDashboard`/`publishBundle` writers, now through the store
   driver (see §4). Bundle shapes are `dashboard-contract.mjs` v1, unchanged.
6. **Heartbeats:** stamps `lastHeartbeatAt` on its `runners/<org>` row on every poll; the
   control plane raises a dead-runner alert when a heartbeat is older than 2× the poll interval
   and a `weekly-run` order sits unclaimed (S7 — a hung weekly cron must page, never silently
   skip a week).

**Fail-closed rules (all enforced in the runner):**

- Postgres driver selected but optional `pg` dep missing → refuse to start with install
  instructions (`npm i pg` or use the gh driver). Exactly the patchright pattern.
- Malformed work order (missing/invalid `type`, `client`, or org mismatch) → `failed`, logged,
  never partially executed.
- Org over a plan limit → the control plane stops enqueuing and the runner double-checks
  `limits/<org>` before executing; over-limit = order left `queued` + a visible "paused: plan
  limit" status. **Never a silent overage, never silent work.**
- Pairing token invalid/revoked → runner exits with instructions; it never retries into a lockout.

---

## 3. DUAL-USE MANDATE — the table of truth

In-house mode is **permanent and first-class**. Every SaaS capability is opt-in behind an env
or config key; with the flag absent the code path is byte-for-byte today's behavior.
`test/no-cloud.mjs` (wired into `npm test`) proves the core loop runs with **no network, no
cloud env, and `fetch` stubbed to throw**.

### Env/flag gates

| Feature | Gate (env/config) | Flag ABSENT → behavior identical to today |
|---|---|---|
| Store driver: Postgres | `DATABASE_URL` (+ optional `SEENAI_STORE_DRIVER=postgres`) | gh-repo store via `gh api` / `GH_TOKEN`, exactly as `src/dashboard.mjs` + `lib/store.js` do now |
| Store driver: gh-repo | `SEO_BOT_STORE_REPO` / `STORE_REPO` (existing) | default repo `supahotthanos/seenai-queue`, unchanged |
| Fully offline dashboard wire | `--local` flag (existing) | `dashboard <client> --local` reads/writes `reports/<client>/` files only — untouched |
| Multi-tenancy (orgs/members/roles) | `SEENAI_MULTI_TENANT=1` **and** `DATABASE_URL` on the dashboard | single shared `DASHBOARD_PASSWORD`/`AUTH_TOKEN` cookie auth, exactly today's `middleware.js` |
| Org scoping in the bot | `SEENAI_ORG=<org>` | org = `_default`; store paths keep their v0 unprefixed form (see CONTRACT §2) |
| Runner mode | explicit `npx seenai-runner` / `seo-bot runner` invocation (+ `SEENAI_RUNNER_TOKEN` — canonical name; `SEENAI_PAIRING_TOKEN` accepted as an alias — and `SEENAI_RUNNER_ID`) | no runner process exists; nothing polls; CLI commands run only when a human runs them |
| Plan limits | limits row present **and** multi-tenant mode ON | no limit checks anywhere in the CLI path — in-house is never metered |
| Work-order queue | orders only created by the SaaS dashboard; runner only claims when running | zero work-order code in any default CLI flow |
| Login rate-limit counters (store-side) | multi-tenant mode ON | today's login route, unchanged |
| Billing (S4, later) | `STRIPE_*` envs | no billing code loaded |

**A feature that only works through the cloud is a defect.** Every SaaS surface must have its
in-house equivalent: approvals (`dashboard --local` + `review`), reports (`report <client>`),
visibility (`measure`/`sources`), audit trail (`tasks.ndjson`/`change-ledger.ndjson`).

### What `test/no-cloud.mjs` locks in

With `GH_TOKEN`/`STORE_REPO`/`DATABASE_URL`/`SEENAI_*` all unset and `globalThis.fetch` stubbed
to throw: `help` + `list` render; `dashboard --local` pushes AND pulls against `reports/` files;
`apply` (dryrun adapter) works on a fixture proposal; `priors` and `onpage-coverage` run — with
**zero fetch attempts observed**. This test is part of `npm test` and is a release blocker.

---

## 4. Store evolution: gh-repo (v0) → Postgres (v1), ONE driver interface

The store keyspace is **path-shaped** and identical across drivers (full spec:
`store/CONTRACT.md`). Both repos talk to it through one interface:

```
StoreDriver {
  getJson(path)                    -> object | null           // missing/unreadable → null
  putJson(path, doc, message)      -> { ok }                  // create-or-update (CAS on gh sha)
  deleteJson(path, message)        -> { ok }                  // deleting absent file → ok:true
  listDir(dir)                     -> [name]                  // [] on any failure
  getBlob(path)                    -> Buffer | null           // screenshots
  putBlob(path, buf, message)      -> { ok }
  appendLog(path, row)             -> { ok }                  // audit: append-only, no rewrite
  claimWorkOrder(org, runnerId, types) -> order | null        // ATOMIC queued→claimed CAS
  configured()                     -> boolean                 // wire present? callers short-circuit honestly
}
```

- **v0 driver — gh-repo** (`supahotthanos/seenai-queue`): today's code IS this driver
  (`src/dashboard.mjs` `ghApi`/`ghStorePut`/`ghStorePull`; `seenai-next/lib/store.js`). It keeps
  working forever as the offline-capable/local fallback. Refactoring it behind the interface
  changes no wire bytes and no paths.
- **v1 driver — Postgres** (Neon via Vercel Marketplace): `store/schema.sql`. Selected by
  `DATABASE_URL`. The `pg` client is an **optionalDependency** in both repos (exactly like
  patchright in the bot) — missing dep + PG selected = refuse with instructions, never a
  silent fallback that hides misconfiguration.
- **Shapes are frozen:** `dashboard-contract.mjs` (pending records, `tierFor`, bundle v1) is the
  payload contract; drivers move opaque JSON documents and never reinterpret risk (the
  dashboard NEVER recomputes tiers — unchanged).
- **Path ↔ table mapping** is mechanical (CONTRACT §3): `pending/<org>/<client>.json` ↔
  `pending(org_id, client, doc)`, etc. The gh driver maps `_default` org to the legacy
  unprefixed v0 paths so every existing file keeps working with no data migration.

Migration order (S2): wrap gh calls behind the interface (no behavior change) → land the PG
driver → dashboard reads PG when `DATABASE_URL` set → bot runner writes PG when set → gh store
remains the v0/local driver indefinitely. Rotate `GH_TOKEN` to a fine-grained PAT during the
wrap (open hardening item).

---

## 5. Auth model (dashboard — S1 implements)

- **No new deps.** Hand-rolled on `node:crypto`, extending the existing httpOnly-cookie pattern:
  - passwords: `crypto.scryptSync` (N=16384, r=8, p=1, keylen=64, per-user 16-byte salt),
    params stored WITH the hash so they can be raised later (CONTRACT §4).
  - sessions: **cookie-side only** — HMAC-SHA256-signed payload
    `{org, email, role, iat, exp}` with `SESSION_SECRET`; httpOnly, Secure, SameSite=Lax.
    No session table (matches CONTRACT: sessions are cookie-side).
  - every compare (`hash`, cookie MAC, pairing token) via `crypto.timingSafeEqual`.
- **Login rate-limit counters are store-side** (`login-limits/<emailKey>`), because serverless
  instances share nothing: sliding window, lockout after repeated failures, fail-closed (counter
  row unreadable → treat as locked, never as clean).
- **Roles:** `owner` > `admin` > `reviewer` > `read-only`. Reviewer approves green/amber only;
  **red requires admin+**; owner manages members/billing/runners. Malformed org/member/limits
  row → **deny access**, never grant.
- Every approval/rejection/settings/share/runner action lands in `audit/<org>` (append-only)
  with `actorEmail, role, at, ip` — the YMYL compliance feature.
- Single-password mode (today's `DASHBOARD_PASSWORD`/`AUTH_TOKEN`) remains the default and maps
  to org `_default` with implicit role `owner`.

---

## 6. Plan limits — hard fail-closed semantics

`limits/<org>` = `{ sites, promptsPerWeek, experiments }` (CONTRACT §5). Enforced in the store
layer of the control plane (and re-checked by the runner before execution):

- **Missing or malformed limits row in multi-tenant mode → deny/pause** (treated as
  all-zero allowance), with a visible "paused — no plan limits on record" state. Never a guess.
- **Over limit → pause visibly**: new work orders refused with reason, queue banner in the
  dashboard, email/alert to the org owner. **Never a silent overage, never silent throttling.**
- In-house mode (multi-tenant OFF): no limits exist, nothing is metered — identical to today.

---

## 7. What stays human — FOREVER

These are not missing features; they are the product's moat and its legal survival:

- **Merging PRs.** Autopilot is PR-only; nothing auto-merges to production, ever.
- **YMYL/medical approval.** GLP-1 brands, before/after, review authenticity, health claims:
  detect + queue (red tier) only.
- **Outreach, pitches, review solicitation, wire submissions.** The bot pre-drafts and
  compliance-checks; a human sends and pays. No account farming, no incentivized reviews —
  those features do not exist by design.
- **State-law compliance judgment** (TX/CA/NY/FL medical-practice rules vary): flagged, never
  certified by the product.
- **Waiting out locked horizons.** No human OR machine peeks; the dashboard renders countdowns,
  not early verdicts.

The dashboard's job is to make the human's 10 minutes/week count; the engine's job is
everything else.

---

## 8. Deliverables index (Phase 3)

| Piece | Where | Status |
|---|---|---|
| This architecture | `ARCHITECTURE-SAAS.md` | **decided (this doc)** |
| Data contract | `store/CONTRACT.md` | **written (S0)** |
| Postgres DDL | `store/schema.sql` | **written (S0)** |
| No-cloud smoke test | `test/no-cloud.mjs` (in `npm test`) | **written (S0)** |
| Driver interface + PG driver (bot) | `src/store/` (planned) | S2 |
| Driver interface + PG driver (dashboard) | `seenai-next/lib/store-driver/` (planned) | S1/S2 |
| Orgs/members auth | `seenai-next` (planned) | S1 |
| Runner | `src/runner.mjs` + `seenai-runner` bin (planned) | S3a |
