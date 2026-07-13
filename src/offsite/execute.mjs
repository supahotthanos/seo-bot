// seo-bot · offsite/execute — run the MECHANICAL off-page bucket end-to-end:
//   ① listings sync (payloads always; API writes only where free creds exist — GBP)
//   ② NAP-drift monitor (public listing pages, read-only)
//   ③ newsroom mirror publish (rides the gated PR adapters ONLY; fake-refresh guard
//      blocks refires with no real content change)
//   ④ IndexNow ping + lastmod discipline (a URL's lastmod may bump ONLY on a real diff)
//   ⑤ monitoring-only: mentions / listicle radar / review velocity / Wikipedia+Reddit WATCH
//   ⑥ ONE consolidated human worksheet for everything not mechanically executable
//
// DRY-RUN BY DEFAULT: `offsite-exec <client> --execute` prints exactly what would happen and
// makes ZERO network calls; writes happen only with --execute --yes, and every write is
// journaled to the change-ledger. Wikipedia/Reddit are WATCH-ONLY — this module (and the
// whole src/offsite/ folder, enforced by a test) exports nothing that posts, comments,
// edits, or creates accounts anywhere.
//
// E2's mention-gap / newsroom / listicle-radar and E1's local/reviews are consumed as
// SOFT dependencies: when merged they slot in; while absent their sections read
// 'unavailable' (visible, never silent).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';
import { isFakeRefresh } from '../integrity.mjs';
import { recordChanges, listChanges } from '../change-ledger.mjs';
import { PR_ADAPTERS } from '../autopilot.mjs';
import { syncListings } from './listings.mjs';
import { napDriftMonitor } from './nap-drift.mjs';
import { draftReviewReplies } from './replies.mjs';
import { consolidateWorksheet, complianceNotApplicable, gateScrapedContent } from './worksheet.mjs';

// ---- monitoring-only surfaces (WATCH — never write) --------------------------------------
export const MONITOR_ONLY_SURFACES = Object.freeze(['wikipedia', 'reddit']);

/** Build the WATCH checklist for surfaces the bot must never touch. Pure, read-only. */
export function watchPresence(cfg) {
  const brand = encodeURIComponent(cfg?.brand || cfg?.domain || '');
  return MONITOR_ONLY_SURFACES.map((surface) => ({
    surface,
    mode: 'WATCH-ONLY',
    checkUrl: surface === 'wikipedia'
      ? `https://en.wikipedia.org/w/index.php?search=${brand}`
      : `https://www.reddit.com/search/?q=${brand}`,
    policy: 'The bot NEVER posts, comments, edits, votes, or creates accounts here. A human may participate authentically; astroturfing is a named black-hat tactic (research/seo-aeo-master-playbook-2026.md).',
  }));
}

// ---- freshness discipline -----------------------------------------------------------------
/** Sitemap lastmod may bump ONLY when a real content diff exists (June-2026 fake-refresh guard). */
export function lastmodGate({ url = '', beforeText = '', afterText = '' } = {}) {
  const fake = isFakeRefresh(beforeText, afterText);
  return fake
    ? { url, allowed: false, reason: 'no material content change — lastmod stays put (fake-refresh guard, June-2026 spam class)' }
    : { url, allowed: true, reason: 'real content diff — lastmod bump + IndexNow ping allowed' };
}

/** A newsroom item may refire only when its numbers/text actually changed (same guard). */
export function newsroomRefireGate({ id = '', beforeText = '', afterText = '' } = {}) {
  const fake = isFakeRefresh(beforeText, afterText);
  return fake
    ? { id, allowed: false, reason: 'unchanged content/numbers — refire BLOCKED (fake-refresh guard)' }
    : { id, allowed: true, reason: 'material update — refire allowed via the PR adapter' };
}

// ---- soft dependencies (E1/E2 modules) ------------------------------------------------------
async function softImport(spec) {
  try { return { available: true, mod: await import(spec) }; }
  catch { return { available: false, mod: null, note: `${spec} not merged yet — section unavailable (visible, not silent)` }; }
}

/**
 * The offsite runner. DRY-RUN unless execute && confirm.
 * @param fetchFn injected fetch (tests use a spy; dry-run must record ZERO calls)
 * @param deps   injectable data for tests / orchestrator:
 *               { reviews: [...], contentDiffs: [{url,beforeText,afterText}], tokenFn }
 */
export async function runOffsite(cfg, { execute = false, confirm = false, fetchFn = globalThis.fetch, deps = {}, writeFiles = true, log = () => {} } = {}) {
  const live = execute && confirm;
  const mode = live ? 'live' : 'dry-run';
  log(`\n▶ offsite ${cfg.name} — mode: ${mode}${execute && !confirm ? ' (--execute without --yes = dry-run; add --yes to write)' : ''}`);
  const ledger = []; // journaled at the end (live only)
  const worksheetRows = [];
  const worksheetRejected = [];

  // ① listings sync -------------------------------------------------------------------------
  const listings = await syncListings(cfg, { execute, confirm, fetchFn, tokenFn: deps.tokenFn, writeFiles, log });
  if (!listings.refused) {
    for (const r of listings.rows) {
      if (r.status === 'EXECUTED' && r.ledger) ledger.push({ ...r.ledger, rule: 'offsite-listing-sync' });
      if (r.status === 'SKIPPED-NO-CREDS') worksheetRows.push({
        id: `listing-${r.targetId}`, action: r.targetId === 'zocdoc' ? 'pay' : 'submit', target: r.target,
        url: r.payloadFile || null,
        content: `Use the pre-filled payload (${r.payloadFile || 'payload emitted in-memory'}). NAP must match EXACTLY.`,
        // No gate ran and none applies: the payload is derived deterministically from the
        // operator's own canonicalNap config — say so honestly, never stamp a fake pass.
        compliance: complianceNotApplicable('deterministic config-derived payload (canonical NAP + registry URL — no free-text content to gate)'),
        why: `no creds/API for ${r.target} — human submits the prepared payload (status SKIPPED-NO-CREDS)`,
      });
    }
  }

  // ② NAP-drift monitor (public pages, read-only; network only on a live run) ----------------
  let drift = { rows: [], note: 'dry-run — would fetch the configured public listing pages (read-only) and diff NAP vs canonical' };
  if (live) drift = await napDriftMonitor(cfg, { fetchFn, log });
  for (const a of drift.alerts || []) {
    // The observed values are SCRAPED from external listing pages (untrusted input) — run
    // them through the real sanitization gate before they may reach the human worksheet.
    const raw = `Observed ${a.drift.map((d) => `${d.field}: "${d.observed ?? 'MISSING'}" (canonical "${d.canonical}")`).join(' · ')} — correct the listing to the canonical NAP.`;
    const gated = gateScrapedContent(raw);
    if (!gated.ok) {
      worksheetRejected.push({ target: `Fix NAP drift on ${a.id}`, reason: 'scraped drift content failed the sanitization gate (fail closed — external page content is untrusted)', violations: gated.violations });
      continue;
    }
    worksheetRows.push({
      id: `nap-drift-${a.id}`, action: 'submit', target: `Fix NAP drift on ${a.id}`, url: a.url,
      content: gated.sanitized,
      compliance: { checked: true, ok: gated.ok, gate: 'gateScrapedContent', violations: gated.violations },
      why: 'NAP drift silently erodes local rankings; aggregators re-corrupt fixed listings over time',
    });
  }

  // ③ newsroom mirror publish (soft E2 dep; PR adapters ONLY — never wordpress live-write) ----
  const newsroomDep = await softImport('./newsroom.mjs');
  let newsroom = { available: false, note: newsroomDep.note };
  if (newsroomDep.available) {
    const prSafe = PR_ADAPTERS.has(cfg.cms?.type);
    if (!prSafe) newsroom = { available: true, blocked: true, note: `cms.type "${cfg.cms?.type}" is not a PR adapter (${[...PR_ADAPTERS].join('/')}) — newsroom mirror publish refused (never a live overwrite)` };
    else {
      const items = (typeof newsroomDep.mod.newsroomItems === 'function' ? newsroomDep.mod.newsroomItems(cfg) : []) || [];
      const gated = items.map((it) => ({ ...it, gate: newsroomRefireGate({ id: it.id, beforeText: it.beforeText || '', afterText: it.afterText || '' }) }));
      newsroom = { available: true, items: gated, publishable: gated.filter((g) => g.gate.allowed).length, blockedRefires: gated.filter((g) => !g.gate.allowed).length, note: live ? 'publishable items ride the PR adapter' : 'dry-run — nothing pushed' };
    }
  }
  log(`  Newsroom: ${newsroom.available ? (newsroom.blocked ? '⛔ ' + newsroom.note : `${newsroom.publishable ?? 0} publishable · ${newsroom.blockedRefires ?? 0} refires blocked (fake-refresh)`) : '— ' + newsroom.note}`);

  // ④ IndexNow + lastmod discipline ----------------------------------------------------------
  const diffs = Array.isArray(deps.contentDiffs) && deps.contentDiffs.length
    ? deps.contentDiffs
    : listChanges(cfg.name, { limit: 20 }).filter((c) => c.url).map((c) => ({ url: c.url, beforeText: String(c.before ?? ''), afterText: String(c.after ?? '') }));
  const gates = diffs.map((d) => lastmodGate(d));
  const pingable = gates.filter((g) => g.allowed).map((g) => g.url);
  const blocked = gates.filter((g) => !g.allowed);
  let indexnow = { mode, candidates: gates.length, pingable: pingable.length, blockedNoDiff: blocked.length, gates };
  if (live && pingable.length) {
    const { pingIndexNow, bingSubmitIfKeyed } = await import('../indexnow.mjs');
    const r = await pingIndexNow(pingable, cfg.domain, process.env.INDEXNOW_KEY || cfg.indexnowKey);
    const b = await bingSubmitIfKeyed(cfg, pingable);
    indexnow = { ...indexnow, pinged: r, bing: b };
    if (r.ok && !r.skipped) ledger.push({ url: pingable.join(','), field: 'indexnow-ping', before: null, after: `${pingable.length} URLs`, ref: r.endpoint });
  }
  log(`  IndexNow/lastmod: ${gates.length} candidates · ${pingable.length} real-diff (${mode === 'live' ? 'pinged' : 'would ping'}) · ${blocked.length} BLOCKED no-diff (lastmod frozen)`);

  // ⑤ monitoring-only ------------------------------------------------------------------------
  const mentionDep = await softImport('./mention-gap.mjs');
  const listicleDep = await softImport('./listicle-radar.mjs');
  const reviewsDep = await softImport('../local/reviews.mjs');
  const monitoring = {
    mentions: mentionDep.available ? { available: true } : { available: false, note: mentionDep.note },
    listicleRadar: listicleDep.available ? { available: true } : { available: false, note: listicleDep.note },
    reviewVelocity: reviewsDep.available ? { available: true } : { available: false, note: reviewsDep.note },
    watch: watchPresence(cfg),
  };
  // Read-only monitors, called with the E2/E1 modules' REAL signatures (they are sync +
  // data-driven, not fetching): buildMentionGap(sourcesReport, cfg) and
  // listicleRadar(capture, cfg, {log}). Missing input data → visible "skipped" note;
  // a throw → visible error object. Never a crash, never a silent pass (fail-closed).
  if (live && (mentionDep.available || listicleDep.available)) {
    const idx = await softImport('./index.mjs');
    if (mentionDep.available && typeof mentionDep.mod.buildMentionGap === 'function') {
      try {
        const sourcesReport = idx.available && typeof idx.mod.readSourcesReport === 'function' ? idx.mod.readSourcesReport(cfg.name) : null;
        monitoring.mentions.result = sourcesReport
          ? await mentionDep.mod.buildMentionGap(sourcesReport, cfg)
          : { skipped: true, note: 'no sources report yet — run `sources <client>` first' };
      } catch (e) { monitoring.mentions.result = { error: String(e?.message || e) }; }
    }
    if (listicleDep.available && typeof listicleDep.mod.listicleRadar === 'function') {
      try {
        const capture = idx.available && typeof idx.mod.readLatestCapture === 'function' ? idx.mod.readLatestCapture(cfg) : null;
        monitoring.listicleRadar.result = capture
          ? await listicleDep.mod.listicleRadar(capture, cfg, { log })
          : { skipped: true, note: 'no AI-visibility capture yet — run `measure <client>` first' };
      } catch (e) { monitoring.listicleRadar.result = { error: String(e?.message || e) }; }
    }
  }
  if (live && reviewsDep.available && typeof reviewsDep.mod.reviewVelocity === 'function') {
    try { monitoring.reviewVelocity.result = await reviewsDep.mod.reviewVelocity(cfg, { log }); }
    catch (e) { monitoring.reviewVelocity.result = { error: String(e?.message || e) }; }
  }
  log(`  Monitoring: mentions ${monitoring.mentions.available ? '✓' : '—'} · listicle-radar ${monitoring.listicleRadar.available ? '✓' : '—'} · review-velocity ${monitoring.reviewVelocity.available ? '✓' : '—'} · Wikipedia/Reddit WATCH-only (${monitoring.watch.length} surfaces)`);

  // ⑤b review replies (drafted for the human; never posted by the bot) ------------------------
  let reviews = Array.isArray(deps.reviews) ? deps.reviews : null;
  if (!reviews && live) {
    try { const { gbpReviews } = await import('../data/gbp.mjs'); const r = await gbpReviews(cfg, { log: () => {} }); reviews = r.enabled ? r.reviews : null; } catch { reviews = null; }
  }
  const replies = draftReviewReplies(reviews || [], cfg);
  for (const r of replies.rows) {
    if (r.status === 'DRAFTED') worksheetRows.push({
      id: `reply-${(r.reviewer || 'x').replace(/\W+/g, '-').toLowerCase()}`, action: 'paste', target: `Reply to ${r.reviewer} (${r.stars}★, GBP)`,
      // Pass through the REAL gate result from draftReviewReplies (checkReplyCompliance ran
      // on every draft) — never restate it as an unconditional literal.
      content: r.draft, compliance: { checked: r.gate?.checked === true, ok: r.gate?.ok === true, gate: 'checkReplyCompliance', violations: [] },
      why: 'owner responsiveness is a review-trust signal; the HUMAN posts (never automated)',
    });
    else worksheetRejected.push({ target: `Reply to ${r.reviewer}`, reason: 'review-reply draft failed the compliance gate', violations: r.violations });
  }
  if (reviews) log(`  Review replies: ${replies.drafted} drafted (worksheet, human posts) · ${replies.rejected} rejected by the compliance gate`);

  // refusal + unavailable sections land on the worksheet too (visible)
  if (listings.refused) worksheetRejected.push({ target: 'Listings sync (ALL targets)', reason: listings.reason + ' ' + listings.fix });

  // ⑥ consolidate the worksheet + report -------------------------------------------------------
  const ws = consolidateWorksheet(cfg, worksheetRows, { rejected: worksheetRejected, writeFiles, log });

  let journaled = 0;
  if (live && ledger.length) journaled = recordChanges(cfg.name, ledger, { adapter: 'offsite' });

  const report = { client: cfg.name, generatedAt: nowIso(), mode, listings: { refused: listings.refused, reason: listings.reason || null, rows: listings.rows, executed: listings.executed || 0 }, napDrift: drift, newsroom, indexnow, monitoring, replies: { drafted: replies.drafted, rejected: replies.rejected }, worksheet: { rows: ws.rows.length, rejected: ws.rejected.length, path: ws.mdPath }, journaled };
  if (writeFiles) {
    const dir = join(ROOT, 'reports', cfg.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'offsite-report.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(dir, 'offsite-report.md'), renderReport(cfg, report));
    log(`  Report → ${join(dir, 'offsite-report.md')}`);
  }
  log(`  ${mode === 'live' ? `${listings.executed || 0} listing write(s) + ${indexnow.pinged ? 'IndexNow ping' : 'no ping'} executed · ${journaled} journaled` : 'dry-run complete — nothing written off-site. Add --yes to execute.'}\n`);
  return report;
}

function renderReport(cfg, r) {
  const L = [`# Off-page report — ${cfg.brand}`, `${r.generatedAt} · mode: ${r.mode}`, ''];
  L.push('## Listings sync');
  if (r.listings.refused) L.push(`⛔ REFUSED: ${r.listings.reason}`);
  else for (const row of r.listings.rows) L.push(`- ${row.status === 'EXECUTED' ? '✅' : row.status === 'FAILED' ? '❌' : row.status === 'DRY-RUN' ? '🟡' : '📋'} **${row.target}** — ${row.status}${row.would ? ` (${row.would})` : ''}${row.payloadFile ? ` → ${row.payloadFile}` : ''}`);
  L.push('', '## NAP drift');
  if (r.napDrift.note) L.push(`- ${r.napDrift.note}`);
  for (const d of r.napDrift.rows || []) L.push(`- ${d.status === 'DRIFT' ? '🔴' : d.status === 'consistent' ? '✅' : '⚠️'} ${d.id} — ${d.status}${d.drift?.length ? ': ' + d.drift.map((x) => x.field).join(', ') : ''}`);
  L.push('', '## Newsroom mirror', `- ${r.newsroom.available ? (r.newsroom.blocked ? '⛔ ' + r.newsroom.note : `${r.newsroom.publishable ?? 0} publishable · ${r.newsroom.blockedRefires ?? 0} refires blocked by the fake-refresh guard`) : '— ' + r.newsroom.note}`);
  L.push('', '## IndexNow / lastmod discipline', `- ${r.indexnow.candidates} candidates · ${r.indexnow.pingable} with a REAL diff · ${r.indexnow.blockedNoDiff} blocked (no material change → lastmod frozen)`);
  L.push('', '## Monitoring (read-only)');
  L.push(`- mentions: ${r.monitoring.mentions.available ? 'wired' : r.monitoring.mentions.note}`);
  L.push(`- listicle radar: ${r.monitoring.listicleRadar.available ? 'wired' : r.monitoring.listicleRadar.note}`);
  L.push(`- review velocity: ${r.monitoring.reviewVelocity.available ? 'wired' : r.monitoring.reviewVelocity.note}`);
  for (const w of r.monitoring.watch) L.push(`- ${w.surface}: WATCH-ONLY → ${w.checkUrl}`);
  L.push('', `## Human worksheet`, `- ${r.worksheet.rows} actions (+${r.worksheet.rejected} rejected) → ${r.worksheet.path || '(not written)'}`);
  return L.join('\n');
}
