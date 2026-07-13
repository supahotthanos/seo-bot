# store/CONTRACT.md — the SeenAI store data contract (v1.1)

> **Both repos implement against this file exactly.** The bot (`seo-bot`, this repo) and the
> dashboard (`seenai-next`) each ship ONE store-driver interface with two drivers behind it:
> the **gh-repo store** (v0 — the existing `supahotthanos/seenai-queue` private repo, keeps
> working forever) and **Postgres** (v1 — DDL in [`schema.sql`](schema.sql), selected by
> `DATABASE_URL`). Payload shapes inside documents are owned by
> `src/dashboard-contract.mjs` (pending records, tiers) and `src/dashboard.mjs`
> (bundle v1) — this contract moves them; it never reinterprets them.
> If this contract is wrong, fix it HERE first — never silently diverge in code.

---

## 1. Driver interface (identical in both repos)

```
StoreDriver {
  getJson(path)                        -> object | null        // missing/unreadable/unconfigured → null, never throws
  putJson(path, doc, message)          -> { ok:boolean }       // create-or-update; gh: sha CAS, pg: upsert
  deleteJson(path, message)            -> { ok:boolean }       // deleting an absent doc → { ok:true }
  listDir(dirPath)                     -> [string]             // child key names (no extension); [] on any failure
  getBlob(path)                        -> Buffer | null        // binary (screenshots)
  putBlob(path, buffer, message)       -> { ok:boolean }
  appendLog(path, row)                 -> { ok:boolean }       // append-only (audit); drivers MUST NOT rewrite history
  claimWorkOrder(org, runnerId, types) -> order | null         // ATOMIC queued→claimed transition; null = nothing claimable
  configured()                         -> boolean              // is the wire even set up? callers short-circuit honestly

  // OPTIONAL CAS extension (v1.2, additive) — drivers that can compare-and-swap expose
  // BOTH; callers MUST feature-detect and fall back to a fresh-read-then-putJson merge:
  getJsonMeta(path)                    -> { doc, rev } | null  // doc + opaque revision token (gh: blob sha)
  putJsonRev(path, doc, message, rev)  -> { ok:boolean, race?:true } // write IFF still at rev; lost race → ok:false, NEVER overwrite
}
```

Rules:
- **Fail closed:** malformed stored documents are treated as ABSENT (`null`) by readers; for
  auth-bearing kinds (orgs, members, limits, runners) absent = **deny**, never grant.
- **No throws across the interface** except `claimWorkOrder`, which may throw only on a
  driver-level integrity error (and the runner treats that as "claim failed, retry later").
- **Paths are the canonical keyspace** (§2). The Postgres driver maps paths to rows (§3);
  path segments MUST match `^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$` (traversal armor — same as
  the dashboard's `CLIENT_RE`, plus dot for file-ish keys), EXCEPT the **final (file)
  segment**, which may be up to **128 chars** (`^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$`) to
  match `schema.sql`'s `shots.name` CHECK (`{1,128}`). Directory/org/client segments stay
  capped at 64. Invalid segment → refuse.
- **Layering:** drivers implement EXACTLY this interface — nothing more. Semantic,
  org-scoped operations (`readPending`/`writePending`/`writeArtifact`/`heartbeat`/
  `readLimits`/`appendAudit`/…) live in the org-scoped **wrapper** built on top of a driver
  (`wrapStore(driver, org)` in `src/store/index.mjs`); the wrapper builds canonical paths
  per §2/§3 and owns the cross-kind checks a single driver call cannot see (see §3.13).
- **`pg` is an OPTIONAL dependency** in both repos. `DATABASE_URL` set but `pg` missing →
  refuse to start with install instructions. Never a silent fallback to another driver.

## 2. Org scoping + the `_default` legacy mapping

Every kind below is **org-scoped**. `org` is either the literal `'_default'` or a slug
matching `^[a-z0-9][a-z0-9-]{0,31}$` — i.e. `^(?:_default|[a-z0-9][a-z0-9-]{0,31})$`.
`_default` is the ONLY underscore-prefixed org that may be **stored**; any other
underscore-prefixed slug (e.g. `_evil`) MUST be refused at store construction (fail closed).

**Reserved, never stored (v1.1):** `_demo` is additionally RESERVED — it exists ONLY inside
the dashboard's signed read-only demo-session cookie and its bundled fixtures, and MUST
never touch the store. Org creation/signup MUST refuse `_demo` (and every other
underscore-prefixed slug) so a hostile signup can never claim it.

**When multi-tenant mode is OFF (today, and forever in in-house mode): `org = '_default'`.**
The gh driver maps the `_default` org to the **legacy v0 unprefixed paths**, so every existing
file keeps working with zero data migration:

| Canonical (org-scoped) path            | gh-repo path when org = `_default` (v0, today) | gh-repo path otherwise            |
|-----------------------------------------|------------------------------------------------|-----------------------------------|
| `pending/<org>/<client>.json`           | `pending/<client>.json`                        | `pending/<org>/<client>.json`     |
| `decisions/<org>/<client>/<id>.json`    | `decisions/<client>/<id>.json`                 | `decisions/<org>/<client>/<id>.json` |
| `artifacts/<org>/<client>.json`         | `artifacts/<client>.json`                      | `artifacts/<org>/<client>.json`   |
| `tracking/<org>/<client>.json`          | `tracking/<client>.json`                       | `tracking/<org>/<client>.json`    |
| `shots/<org>/<client>/<file>.png`       | `shots/<client>/<file>.png`                    | `shots/<org>/<client>/<file>.png` |
| `settings/<org>/<client>.json`          | `settings/<client>.json`                       | `settings/<org>/<client>.json`    |
| `configs/<org>/<client>.json` (v1.1)    | `configs/<client>.json`                        | `configs/<org>/<client>.json`     |

The Postgres driver always stores `org_id` explicitly (`'_default'` included) — no special case.

**Kinds NOT in the table above** (`orgs/`, `members/`, `limits/`, `work-orders/`, `runners/`,
`audit/`; and the token-keyed `login-limits/`, `shares/`, `invites/`) are **new in v1/v1.1 and
have no v0 files to stay compatible with** — the gh driver stores them at their canonical
(org-prefixed where applicable) paths for EVERY org, **including `_default`**. Only the seven
dashboard kinds in the table get the legacy unprefixed mapping (`configs` joins in v1.1
because the bot's in-house convention was already the unprefixed `configs/<client>.json`).
To be explicit: `runners/`, `work-orders/` and `limits/` are ALWAYS org-scoped — there is no
`_default` unprefixed mapping row for them.

## 3. Kinds — paths, shapes, semantics

Shared field conventions: timestamps are ISO-8601 UTC strings; `emailKey` =
lowercased email with `@` and `.` replaced by `_` (path-safe); every document that is
written by an authenticated actor carries `actorEmail`, `role`, `at`, `ip` audit fields.

### 3.1 `orgs/<org>.json` — table `orgs`
```jsonc
{ "id": "acme", "name": "Acme Aesthetics", "plan": "starter|growth|agency|internal",
  "status": "active|paused|churned", "createdAt": "…" }
```
- `_default` org always exists (seeded in schema.sql) with `plan:"internal"`.
- Malformed/missing org row → **deny all access to that org's data** (fail closed).

### 3.2 `members/<org>/<emailKey>.json` — table `members`
```jsonc
{ "email": "jane@acme.com",
  "role": "owner|admin|reviewer|read-only",
  "scrypt": { "algo": "scrypt", "N": 16384, "r": 8, "p": 1, "keylen": 64,
               "salt": "<base64 16B>", "hash": "<base64 64B>" },
  "createdAt": "…", "createdBy": "owner@acme.com", "disabled": false }
```
- Password verify: `node:crypto` `scryptSync(password, salt, keylen, {N,r,p})` +
  `timingSafeEqual`. Params live WITH the hash so they can be raised per-member later.
- Role powers: `reviewer` may decide **green/amber** tiers only; **red requires admin or
  owner**; `read-only` may decide nothing; `owner` additionally manages members, limits,
  runners, billing. Unknown/missing role → treat as NO access (fail closed).
- **Sessions are cookie-side** (HMAC-SHA256-signed httpOnly cookie `{org,email,role,iat,exp}`
  with `SESSION_SECRET`) — **no sessions table/kind exists** by design. Real member sessions
  are signed with `SESSION_SECRET` ONLY. (The dashboard's read-only DEMO token reuses the
  same payload shape — format `d1.<payloadB64url>.<sigB64url>`, org pinned `_demo`, role
  pinned `read-only` — and its signing secret intentionally falls back
  `SESSION_SECRET → AUTH_TOKEN → DASHBOARD_PASSWORD` so the demo works with SaaS flags OFF;
  that fallback MUST never be extended to real member sessions.)
- **An email present in MULTIPLE orgs (v1.1):** login resolves the member row by picking the
  first VALID row in ascending (sorted) org order — deterministic, never a guess among
  malformed rows. If multi-org membership becomes a real product surface, login MUST grow an
  org picker; until then this deterministic rule is the contract.

### 3.3 `login-limits/<emailKey>.json` — table `login_limits` (NOT org-scoped — login precedes org resolution)
```jsonc
{ "email": "jane@acme.com", "windowStart": "…", "failures": 3, "lockedUntil": "…|null" }
```
- Store-side because serverless instances share nothing. Policy (v1.1 — tightened from the
  original ≥10): **≥5 failures inside a 15-minute window** → `lockedUntil = now + 15min`
  (reset on success). The constant is `LOCK_THRESHOLD` in `seenai-next/lib/login-limits.js`;
  this doc and that constant MUST move together.
- Fail closed: counter row present-but-unreadable → treat as **locked**, never as clean.

### 3.4 `pending/<org>/<client>.json` — table `pending`
The bot-published approval queue. Document shape is EXACTLY today's
`src/dashboard.mjs` `pushDashboard` payload (unchanged):
```jsonc
{ "client": "…", "generatedAt": "…", "runId": "…|null", "count": 3,
  "records": [ /* buildPendingRecord() rows — schema:1, bot-stamped tier, policy, consensus, screenshot, overview */ ] }
```
- The dashboard NEVER recomputes `tier` — render + collect decisions only (invariant).

### 3.5 `decisions/<org>/<client>/<id>.json` — table `decisions`
Dashboard-written, bot-consumed (deleted after consumption by the bot's pull — pg driver
deletes the row; consumption is idempotent on the bot side as today). `<id>` =
`<epochMs>-<rand6>` as today. **v1 adds audit fields to each decision row:**
```jsonc
{ "client": "…", "decidedAt": "…",
  "decisions": [ { "taskId": "…", "decision": "approve|reject", "tier": "green|amber|red",
                    "bulk": false,
                    "actorEmail": "jane@acme.com", "role": "reviewer", "at": "…", "ip": "…" } ] }
```
- Legacy rows without audit fields remain readable (bot treats `actor` as before);
  multi-tenant mode REFUSES to write a decision without `actorEmail`+`role`.
- Enforcement at write time: role permits the tier (§3.2) or the API refuses — a red-tier
  decision by a reviewer is rejected server-side, not just hidden in the UI.

### 3.6 `artifacts/<org>/<client>.json` — table `artifacts`
The dashboard bundle, **shape = bundle v1** as documented in `src/dashboard.mjs`
`buildDashboardBundle()` JSDoc and mirrored in `seenai-next/lib/artifacts.js`. Opaque to the
store. Max 1.5 MB (`MAX_BUNDLE_BYTES`, clamp-trimmed oldest-first before publish).

### 3.7 `tracking/<org>/<client>.json` — table `tracking`
Per-prompt AI rankings + SoV, shape = today's `pushTracking` payload. Opaque to the store.

### 3.8 `shots/<org>/<client>/<file>.png` — table `shots`
Before/after PNGs (binary). Never publicly addressable; served only through the cookie-gated
dashboard (data-URL inlining as today).

### 3.9 `settings/<org>/<client>.json` — table `settings`
White-label settings `{ name, logoUrl, accent, updatedAt }` — sanitization contract stays in
`seenai-next/lib/settings.js` (sanitize on read AND write; https-only logo, hex-only accent).

### 3.10 `shares/<token>.json` — table `shares` (keyed by TOKEN, org carried inside)
```jsonc
{ "org": "acme", "client": "…", "reportType": "weekly", "createdAt": "…", "expiresAt": "…",
  "createdBy": "jane@acme.com" }
```
- The 192-bit base64url token IS the capability (resolved by token alone — that is why the
  path is not org-prefixed; `org` lives in the record, `org_id` in the row). 30-day expiry,
  revoke = delete. Legacy v0 records without `org` are read as org `_default`.

### 3.11 `limits/<org>.json` — table `limits` — **hard fail-closed semantics**
```jsonc
{ "plan": "starter", "sites": 1, "promptsPerWeek": 25, "experiments": 0, "updatedAt": "…" }
```
- Enforced ONLY when multi-tenant mode is ON, and **the `_default` org is never metered even
  then** (in-house dual-use mandate — this is intentional, not an oversight: `_default` is
  the operator's own org and has `plan:"internal"`).
- In multi-tenant mode: **missing or malformed limits row = all-zero allowance = paused**,
  with a visible "no plan limits on record" state. An org over any limit → new work orders
  refused with a stated reason + visible pause. **Never a silent overage.** Counters compare
  against real usage (client count from pending/artifacts; prompts from tracking; live
  experiments from the bundle) — the store never trusts a client-supplied count.

### 3.12 `work-orders/<org>/<id>.json` — table `work_orders`
```jsonc
{ "id": "wo_<epochMs>_<rand6>",
  "type": "sync-dashboard|weekly-run|first-audit",     // CLOSED enum — unknown type is refused by runners
  "client": "…",
  "status": "queued|claimed|done|failed",
  "createdAt": "…", "createdBy": "jane@acme.com",
  "claimedBy": "<runnerId>|null", "claimedAt": "…|null",
  "finishedAt": "…|null", "attempts": 0,
  "result": { /* summary, e.g. tiers pushed */ } | null,
  "error": "…|null" }
```
- Lifecycle: `queued → claimed → done|failed`. Claim is ATOMIC (`claimWorkOrder`): pg =
  `UPDATE … SET status='claimed', claimed_by=$r WHERE status='queued' … LIMIT 1 RETURNING *`
  under `FOR UPDATE SKIP LOCKED`; gh = read + sha-CAS PUT (lost race → try next order).
- A `claimed` order older than 2h with no completion may be re-queued by the control plane
  (attempts+1, max 3 → `failed`). Runners MUST be idempotent per order id.
- **Ownership split:** the runner increments `attempts` at claim time ONLY and never
  re-queues an order; the 2h stale-claim re-queue and the max-3 attempts cap are
  **control-plane-owned** (dashboard/S7) — a runner that dies mid-order simply leaves it
  `claimed` for the control plane to notice.
- **Unknown `type` → the runner refuses** (marks `failed`, `error:"unknown-type:<t>"`,
  executes nothing). Malformed order (bad client slug, org mismatch) → same.
- **`first-audit` payload convention (v1.1):** the order carries NO config payload — the
  runner resolves the client's onboarding config at `configs/<org>/<client>.json` (§3.16)
  by convention. Missing config → the runner marks the order `failed` with a stated reason
  (never guesses a config).

### 3.13 `runners/<org>/<runnerId>.json` — table `runners`
```jsonc
{ "id": "rn_<rand8>", "name": "mac-mini",
  "pairingTokenScrypt": { "algo": "scrypt", "N": 16384, "r": 8, "p": 1, "keylen": 64,
                           "salt": "<base64>", "hash": "<base64>" },
  "pairedAt": "…", "lastHeartbeatAt": "…|null", "version": "…", "status": "active|revoked" }
```
- The raw pairing token is shown ONCE at creation and stored only client-side by the runner;
  the store keeps the scrypt hash. Verify = scrypt + `timingSafeEqual`. `revoked` runners
  cannot claim (checked at claim time). Missing/malformed runner row → deny claim.
- **Which layer owns the claim gate:** the driver-level `claimWorkOrder(org, runnerId, types)`
  is a single-kind operation and cannot see the runner row — the active-runner check is owned
  by the **org-scoped wrapper** (`wrapStore().claimWorkOrder(runnerId, types)` reads
  `runners/<org>/<runnerId>` and returns `null` unless `status === 'active'` BEFORE any driver
  claim), so all three drivers enforce it uniformly. The runner process additionally re-checks
  its row on every heartbeat (mid-run revocation stops the loop).
- Heartbeat = update `lastHeartbeatAt` on every poll; the control plane alerts when stale
  (dead-run alerting, S7).

### 3.14 `audit/<org>/<yyyy-mm>.ndjson` — table `audit` — **append-only**
One row per sensitive action (login, decision, settings/share change, member/limit/runner
change, work-order enqueue/claim/complete):
```jsonc
{ "at": "…", "actorEmail": "…|runner:<id>|system", "role": "…|null", "ip": "…|null",
  "action": "decision.approve|decision.reject|login.success|login.locked|share.create|…",
  "subject": "<client|taskId|token8|memberEmail|orderId>",
  "tier": "green|amber|red|null",      // v1.1 additive: rides top-level on decision.* rows
  "changeId": "<decisions doc id>|null", // v1.1 additive: links the row to its decisions/<org>/<client>/<id>.json
  "detail": { } }
```
- Drivers implement `appendLog` ONLY for this kind — no update, no delete (pg enforces with a
  trigger; gh driver appends to the monthly file via sha-CAS). Compliance surface for YMYL
  clients: who approved what, when, from where.
- **gh-driver concurrency caveat:** the sha-CAS append means a CONCURRENT append can lose the
  race and surface `{ ok:false }` — append-only is preserved (nothing is overwritten), but the
  row was NOT written. Callers that need the row durably (compliance-critical actions) MUST
  retry on `{ ok:false }`; runner-side audit is best-effort by design and may drop a row under
  contention. The pg driver has no such race (INSERT-only).

### 3.15 `invites/<token>.json` — table `invites` (v1.1; keyed by TOKEN, like §3.10)
```jsonc
{ "org": "acme", "email": "jane@acme.com", "role": "admin|reviewer|read-only|owner",
  "createdAt": "…", "expiresAt": "…", "createdBy": "owner@acme.com" }
```
- The one-time set-password invite behind the S-C member-invite flow. The base64url token IS
  the capability (public `/set-password` route validates it server-side); **single-use =
  delete-on-consume** (consume writes the member row THEN deletes the token; a replayed token
  finds the member already exists and is refused). 7-day expiry; expired invites verify false.
- Role ceiling at MINT time: **admins cannot mint owner invites** (owner-role invites require
  an owner actor). Invalid org slug / unknown role / malformed email → refuse to mint.

### 3.16 `configs/<org>/<client>.json` — table `configs` (v1.1)
The onboarding wizard's generated client config — key set covers EVERY key of
`seo-bot/config/example.client.json` (plus `vertical`, `listings.canonicalNap`, `reviewers`).
Opaque to the store (shape owned by the wizard + the bot's config loader).
- `_default` maps to the legacy unprefixed `configs/<client>.json` (§2 table) — the bot's
  existing in-house convention, zero migration.
- Consumed by runners for `first-audit` work orders (§3.12) and always ALSO offered as a
  download for in-house CLI use (the store copy is a convenience, not the only path).
- Incomplete canonical-NAP fields are stored as `null` — the bot refuses rather than invents.

## 4. Security requirements (both repos)

- **No new hard deps.** Auth primitives are `node:crypto` only: `scryptSync` (params in §3.2),
  `randomBytes`, `createHmac('sha256')`, `timingSafeEqual` for EVERY secret compare.
  Dashboard stays next/react only; bot stays cheerio-only (+ optional `pg`).
- Secrets in env only (`SESSION_SECRET`, `DATABASE_URL`, `GH_TOKEN`); never in the store,
  never in the browser, never logged.
- All store access is server-side. The browser sees only cookie-gated pages and the tokenized
  `/share/<token>` read-only report (unchanged).

## 5. Versioning

- This is contract **v1.2**. Additive changes (new optional fields, new kinds) bump the minor
  and require no migration. Breaking changes require a new major version with an aligned
  `schema_migrations` entry AND a documented gh-driver mapping.
- **v1.2 changelog (2026-07-01):** optional CAS pair `getJsonMeta`/`putJsonRev` added to §1
  (gh driver: blob-sha CAS). Motivation: the runner heartbeat must never resurrect a
  concurrently revoked runner row — CAS drivers fail the racing put; non-CAS callers merge
  the heartbeat fields onto a row re-read immediately before the write.
- **v1.1 changelog (2026-07-01, reconciled from the S-C/S-D/S-E builds):** login-lock
  threshold tightened 10→5 (§3.3); `invites` kind + table added (§3.15); `configs` kind +
  table added with a `_default` legacy mapping row (§2, §3.16); `_demo` org slug reserved,
  never stored (§2); audit rows gain additive top-level `tier` + `changeId` on decision
  actions (§3.14); multi-org email login rule pinned (§3.2); demo-token note added (§3.2);
  `first-audit` config-resolution convention pinned (§3.12); `_default`-never-metered intent
  confirmed (§3.11).
- Document payload versions ride inside documents (`schema:1` on pending records,
  `version:1` on bundles) and are owned by `dashboard-contract.mjs` / `dashboard.mjs` —
  drivers never inspect them.
