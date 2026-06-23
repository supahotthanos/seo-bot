# Wiring the 100x layer into the live loop

The Search Atlas teardown build (see `../research/searchatlas-100x-aeo-engine-plan.md`) shipped as **standalone modules + foundation contracts**, all `node --check`-clean and unit-tested, with the safe/additive bits already wired:

**Already wired (safe, default behavior unchanged):**
- EV priority ranking → `priority.mjs` called in `decide.mjs saveProposals` (every `propose`/`run` now leads with highest-EV fixes).
- Apply adapters → `apply/index.mjs` dispatches `cms.type: edge | cloudflare-worker` (server-rendered write-back, no JS pixel).
- CLI verbs → `review`, `report`, `portfolio`, `probe`, `crawlbudget`, `content optimize` (+ `bin/seo-bot.mjs help`).

**NOT auto-wired into the `run` loop on purpose** — these change runtime behavior and need per-client config (edge IDs, log drains, GBP approval) + a deliberate enable. Each is gated; turn on per client. Snippets below are verbatim from the build agents.

---

## Foundation contracts (import these)
- `priority.mjs` → `rankProposals(proposals)`, `scoreProposal(p)`
- `tasks.mjs` → `currentTasks`, `upsertFromProposals`, `setStatus`, `STATUSES` (ledger: `reports/<client>/tasks.ndjson`)
- `parity.mjs` → `verifyParity(cfg, urls, {expect, renderFn})`, `extractSeo(html)` (render-parity + cloaking guard)
- `connect/aibot-ips.mjs` → `fetchBotRanges({log})`, `verifyBot(ip, claimedBot, ranges)`, `analyzeCrawlLog(logText, {ranges, log})`

## Epic 1 — policy gating (orchestrator step ④, before `if (apply)`)
```js
import { decideBatch, buildSignals, loadStatsDecisions } from './policy.mjs';
import { upsertFromProposals, setStatus, currentTasks } from './tasks.mjs';
const stats = await loadStatsDecisions(cfg.name);
const { auto, queued } = decideBatch(result.proposals, cfg, { stats, signals: buildSignals(gsc, ga4) });
upsertFromProposals(cfg.name, result.proposals);
const tasks = currentTasks(cfg.name); const idFor = (p) => tasks.find((t) => t.taskKey === `${p.type}:${p.page}`)?.id;
for (const p of queued) { const id = idFor(p); if (id) setStatus(cfg.name, id, 'queued', { actor: 'auto', note: p.policy.blockers.join('; ') }); }
for (const p of auto)   { const id = idFor(p); if (id) setStatus(cfg.name, id, 'approved', { actor: 'auto' }); }
// then apply ONLY the approved set; high-traffic/YMYL/legal stay queued.
```

## Epic 2 — render-parity (replace/augment step ⑤ verify)
```js
import { verifyParity } from './parity.mjs';
const parity = await verifyParity(cfg, pages, { log }); // fails any JS-only / cloaking / bot-mismatch fix
```

## Epic 4 — DNS/email-auth (onboard/index.mjs step ①, + `dns` CLI flags)
```js
import { scoreEmailAuth } from './email-auth.mjs';
import { auditDnsTrust } from './connect/dns.mjs';
// after lookupDns(d): fold scoreEmailAuth(dns).proposals + auditDnsTrust(cfg, dns).proposals into the report.
// gated writers: writeCaa/writeDmarc/writeBimi/writeMtaSts/writeVerification/writeIndexNowKey (confirm-only).
```

## Epic 5 — log intelligence (orchestrator after ①, + decide hook)
```js
import { ingestLogs } from './connect/logs.mjs';
import { analyzeCrawlBudget, wasteToProposals } from './crawlbudget.mjs';
import { crawlToCite } from './crawl-to-cite.mjs';
if (cfg.logs?.drainUrl || cfg.logs?.file) {
  await ingestLogs(cfg, { log });
  const cb = await analyzeCrawlBudget(cfg, { log });            // also in decide.mjs: proposals.push(...wasteToProposals(cb,{startId:pid}))
  const c2c = await crawlToCite(cfg, { log });
}
```

## Epic 7 — content-IR (CLI wired; gate hook)
`content optimize <client> <file> --query "<q>" [--serp]`. Optional: in `content/gates.mjs scoreContent`, fold `buildCoverageGate(model)(draft).score` as a soft component.

## Epic 8 — AEO (rules.mjs + decide.mjs)
```js
// rules.mjs auditPage, after parsePage: import { auditAeo } from './aeo.mjs';
for (const fnd of auditAeo(p).findings) out.push(f(fnd.rule, fnd.severity, fnd.message, fnd.recommendation, fnd.evidence));
// decide.mjs buildProposals per page: import { proposeAeoFixes } from './aeo.mjs';
for (const ap of await proposeAeoFixes(p, cfg)) proposals.push({ ...ap, id: ++pid });
```
Add tactics entries: `atomic-answer-chunk`, `fanout-subtopic-coverage`, `passage-independence`, `geo-stats-quotes-citations`, `rrf-citation-preflight`.

## Epic 9 — entity graph (orchestrator after ③)
```js
import { extractEntities, resolveOrgSameAs } from './entity/extract.mjs';
import { loadGraph, ingestPage, saveGraph } from './entity/graph.mjs';
import { emitAll } from './entity/schema-emit.mjs';
const graph = loadGraph(cfg); const orgSameAs = (await resolveOrgSameAs(cfg)).sameAs;
for (const page of r.pages) ingestPage(graph, cfg, extractEntities(page.html, page.url, cfg), { orgSameAs });
saveGraph(cfg, graph); for (const p of emitAll(graph, cfg).proposals) result.proposals.push(p);
// emitEntityGraph proposals carry type 'schema.entity-graph' → edge adapter maps via cloaking-guard.fieldOf → 'jsonld' (edge-safe).
```

## Epic 10 — internal links (apply/nextjs patch path; CLI/orchestrator)
`sculpt.mjs` emits `type:'internal-link'` with a `patch:{file,find,replace}` (server-rendered `<a>` into a real sentence) — rides the existing PR path. Add a `sculpt` CLI case calling `runSculpt(cfg,{log,confirm})`; register its diff-in-diff experiment via `stats/controller.mjs`.

## Epic 12 — self-driving experiments (orchestrator step ⑩)
```js
import { selfDriveStep } from './experiments/loop.mjs';
const experiments = await selfDriveStep(cfg, {
  proposals: result.proposals,
  metrics: await buildExperimentMetrics(cfg, gsc, ga4), // caller builds from pullGSC (per-page control/variant), ga4Report, cruxRecord, measure
}, { log, confirm, horizonDays: 28 });
```
Variant assignment is deterministic per page (FNV-1a of `experimentId::path`) — Googlebot & humans get one identical rendering (not cloaking).

## Epic 13 — measurement/SOV (measure.mjs + orchestrator ⑦/⑧ + report card)
```js
import { computeSov } from './measure/sov.mjs';
import { buildWorkOrder } from './measure/work-order.mjs';
import { buildPromptPanel } from './measure/prompts.mjs';
import { sovChangeRecords } from './measure/sov-change-records.mjs';
// feed buildPromptPanel(cfg).prompts to track.mjs; after capture: computeSov(capture,{cfg}); buildWorkOrder(capture,cfg) → upsertFromProposals;
// if prior capture: sovChangeRecords({cfg,before,after,beforeGa4,afterGa4}) → runController(cfg.name, records).
```

## MCP surface
`node src/mcp-server.mjs` (stdio) exposes `seo_audit/propose/apply(confirm)/measure/verify/list_clients` — point Claude Code / internal agents at it.

---
**Order to enable:** parity (Epic 2) → policy gating (Epic 1) → logs (Epic 5) → AEO+entity proposers (8,9) → measurement (13) → experiments (12). Enable per client; every write stays gated behind `--yes`; high-traffic/YMYL/legal med-spa never auto-applies.
