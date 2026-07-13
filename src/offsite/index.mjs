// seo-bot · offsite — the off-domain mention engine (E2). Runs the three analyzers against
// the latest reports and writes ONE prioritized human worksheet:
//   1. mention-gap  — hosts the engines cite where we're absent (+ pre-drafted pitches)
//   2. listicle-radar — third-party "best X in {city}" listicles to earn inclusion in
//   3. newsroom     — wire-fire verdicts (mirror-first, cadence, fake-refresh, hard gates)
//
// A HUMAN SENDS EVERYTHING. There is deliberately no --execute: outreach, pitching, and wire
// submission are in the never-automate set. Fail-closed: missing inputs produce { ok:false }
// with instructions, never an empty worksheet that reads as "no work to do".

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';
import { buildMentionGap, draftPitches } from './mention-gap.mjs';
import { listicleRadar } from './listicle-radar.mjs';
import { evaluateWireFire } from './newsroom.mjs';
import { llmAvailable } from '../llm.mjs';

/** Latest sources report (sources/index.mjs writes reports/<client>/sources.json). */
export function readSourcesReport(client) {
  const p = join(ROOT, 'reports', client, 'sources.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

/** Latest AI-visibility capture (track.mjs writes reports/<client>/ai-visibility/*.json).
 *  The global data/ai-visibility fallback is single-brand legacy — like brief.mjs, we only
 *  accept it when the capture's brand/domain matches THIS client (never attribute another
 *  brand's capture; fail closed to null instead). */
export function readLatestCapture(cfg) {
  const client = typeof cfg === 'string' ? cfg : cfg?.name;
  const clientDir = join(ROOT, 'reports', client ?? '', 'ai-visibility');
  const globalDir = join(ROOT, 'data', 'ai-visibility');
  for (const [d, mustMatch] of [[clientDir, false], [globalDir, true]]) {
    if (!existsSync(d)) continue;
    const files = readdirSync(d).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) continue;
    try {
      const j = JSON.parse(readFileSync(join(d, files[files.length - 1]), 'utf-8'));
      if (mustMatch) {
        const brand = typeof cfg === 'object' && cfg ? cfg.brand : null;
        const domain = typeof cfg === 'object' && cfg ? cfg.domain : null;
        const bm = j.brand && brand && String(j.brand).toLowerCase() === String(brand).toLowerCase();
        const dm = j.domain && domain && String(j.domain).replace(/^www\./, '') === String(domain).replace(/^www\./, '');
        if (!bm && !dm) continue; // another brand's global capture → not ours
      }
      return j;
    } catch { /* fall through */ }
  }
  return null;
}

/** Optional release ledger: reports/<client>/newsroom/releases.json = [releaseRecord,...].
 *  Each record: { id, title, body, numbers:[{label,value,source}], firedAt:[iso], mirrorPath,
 *  mirrorPublishedAt?, previous?: { body, numbers } }. */
export function readReleases(client) {
  const p = join(ROOT, 'reports', client, 'newsroom', 'releases.json');
  if (!existsSync(p)) return { present: false, releases: [] };
  try {
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    return { present: true, releases: Array.isArray(j) ? j : [] };
  } catch { return { present: true, releases: [], parseError: true }; }
}

export async function runOffsite(cfg, { log = () => {}, useLlm = llmAvailable() } = {}) {
  const sources = readSourcesReport(cfg.name);
  const capture = readLatestCapture(cfg);
  const rel = readReleases(cfg.name);

  const gap = buildMentionGap(sources, cfg);
  const radar = listicleRadar(capture, cfg, { log });

  if (!gap.ok && !radar.ok && !rel.releases.length) {
    const message = [
      `Nothing to work from for "${cfg.name}" — fail closed, no worksheet written.`,
      `  · mention-gap: ${gap.message}`,
      `  · listicle-radar: ${radar.message}`,
      `  · newsroom: no reports/${cfg.name}/newsroom/releases.json${rel.parseError ? ' (file exists but is not valid JSON)' : ''}`,
    ].join('\n');
    log(message);
    return { ok: false, reason: 'no-inputs', message };
  }

  if (gap.ok) await draftPitches(gap.rows, cfg, { useLlm, log });
  const wire = rel.releases.map((r) => ({ id: r?.id ?? null, title: r?.title ?? '', verdict: evaluateWireFire(r, { previous: r?.previous || null }) }));

  // ---- unified tasks (decide.mjs / tasks.mjs proposal shape) for later upsert ----
  const tasks = [
    ...(gap.ok ? gap.rows.map((r) => ({ type: 'offsite-mention', page: r.host, severity: r.actionKind === 'claimable' ? 'medium' : 'low', autoApplicable: false, current: `engines cite ${r.host} (${r.citations}×); we're absent`, proposed: r.action, rationale: `Mentions beat backlinks ~3:1 (Ahrefs r≈0.66 vs 0.22) — earn a presence where the engines already look.` })) : []),
    ...(radar.ok ? radar.tasks.map((t) => ({ type: 'offsite-listicle', page: t.url || t.host, severity: t.severity, autoApplicable: false, current: `third-party listicle cited where we're absent`, proposed: t.action, rationale: t.rationale })) : []),
  ];

  // ---- write the worksheet ----
  // DISTINCT FILE from E10's offsite-worksheet.{md,json} (offsite/worksheet.mjs): the two
  // commands have different schemas, so each writes its OWN file and cross-references the
  // other — running `offsite` and `offsite-exec` in either order loses nothing.
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const L = [`# Off-domain mention worksheet — ${cfg.brand}`, `${nowIso()} · every row = ONE HUMAN ACTION. Nothing here is automated; a human reviews, personalizes, and sends everything.`, ''];

  L.push('## 1. Mention gaps (sources the engines cite where we are absent)');
  if (!gap.ok) L.push(`⚠ ${gap.message}`);
  else {
    if (!gap.ownPresent) L.push('⚠ The client domain was NOT cited at all in the captured answers — this list is the path in.', '');
    L.push('| # | Host | Type | Kind | Cited | Engines |', '|---|---|---|---|---|---|');
    for (const r of gap.rows) L.push(`| ${r.priority} | ${r.host} | ${r.type} | ${r.actionKind} | ${r.citations}× | ${r.engines.join(', ')} |`);
    L.push('');
    for (const r of gap.rows) L.push(`### ${r.priority}. ${r.host} (${r.actionKind})`, `- [ ] ${r.action}`, '', '```', r.pitch, '```', '');
  }

  L.push('## 2. Third-party listicle inclusion targets');
  if (!radar.ok) L.push(`⚠ ${radar.message}`);
  else if (!radar.tasks.length) L.push(`(none found in ${radar.usableRows} usable answers — ${radar.blockedRows} blocked rows excluded, not counted as absence)`);
  else for (const t of radar.tasks) L.push(`- [ ] **${t.host}**${t.title ? ` — "${t.title}"` : ''}${t.url ? ` (${t.url})` : ''} · ${t.severity} · ${t.engines.join(', ')} · confidence: ${t.confidence}\n      ${t.action}`);
  L.push('');

  L.push('## 3. Newsroom / wire discipline');
  if (!rel.present) L.push(`(no release ledger — add reports/${cfg.name}/newsroom/releases.json to track mirror-first + refire cadence)`);
  else if (rel.parseError) L.push('⚠ releases.json exists but is not valid JSON — fix it; refusing to guess (fail closed).');
  else if (!rel.releases.length) L.push('(release ledger is empty)');
  else for (const w of wire) {
    L.push(`- ${w.verdict.ok ? '✅ READY TO FIRE (human submits)' : '⛔ REFUSED'} — ${w.title || w.id}`);
    for (const r of w.verdict.reasons) L.push(`    · ${r.gate}: ${r.detail}`);
  }
  L.push('', '_Hard rules: human sends all outreach; wire submission is manual; no review solicitation automation (FTC 16 CFR 465); no self-ranking lists — ever._');
  const hasExecWs = existsSync(join(dir, 'offsite-worksheet.md'));
  if (hasExecWs) L.push('', '_Companion worksheet: [offsite-worksheet.md](offsite-worksheet.md) — mechanical off-page actions (listings/NAP/replies) from the `offsite-exec` command (separate file, nothing merged or overwritten)._');

  writeFileSync(join(dir, 'offsite-mentions-worksheet.md'), L.join('\n'));
  writeFileSync(join(dir, 'offsite-mentions-worksheet.json'), JSON.stringify({
    client: cfg.name, generatedAt: nowIso(),
    companion: hasExecWs ? 'offsite-worksheet.json' : null,
    mentionGap: gap.ok ? { ownPresent: gap.ownPresent, rows: gap.rows } : { error: gap.reason, message: gap.message },
    listicles: radar.ok ? { tasks: radar.tasks, refused: radar.refused.length, usableRows: radar.usableRows, blockedRows: radar.blockedRows } : { error: radar.reason, message: radar.message },
    newsroom: wire,
    tasks,
  }, null, 2));

  log(`\n  Off-site worksheet — ${cfg.brand}: ${gap.ok ? gap.rows.length : 0} mention targets · ${radar.ok ? radar.tasks.length : 0} listicle targets · ${wire.length} release verdict(s)`);
  log(`  → ${join(dir, 'offsite-mentions-worksheet.md')}\n`);
  return { ok: true, gap, radar, wire, tasks, mdPath: join(dir, 'offsite-mentions-worksheet.md') };
}
