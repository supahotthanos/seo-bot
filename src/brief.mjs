// seo-bot · brief — the daily oversight brief. The loop runs autonomously, but the SEO lead
// / CNAI founders need to SEE what changed and be able to undo it. This reads the change-
// ledger (every write is journaled with a before-value) + the autopilot run log, and emits a
// per-site (and portfolio) daily digest: what was auto-pushed by verifier consensus vs what
// was held for human review, "⚠ might be wrong" flags, and the exact rollback command for
// each change. Delivered to a file (+ optional webhook). Visibility + reversibility = the
// safety net that makes full autonomy acceptable.

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listConfigs, loadConfig } from './config.mjs';
import { nowIso } from './util.mjs';

const SENSITIVE_RE = /\/(reviews?|testimonials?|pricing|book|consult|before-after|results|weight-?loss|glp-?1|conditions?|medical)\b|^\/?$/i;

/** Flag a journaled change as "might be wrong / needs a look" — pure, testable. */
export function flagChange(c = {}) {
  const flags = [];
  if (c.before == null && c.adapter !== 'nextjs' && c.adapter !== 'edge') flags.push('no before-snapshot → cannot one-click rollback');
  if (/autopilot/.test(c.runId || '') && SENSITIVE_RE.test(c.url || '')) flags.push('autopilot touched a sensitive/high-value path (review this)');
  if (c.adapter === 'wordpress') flags.push('live WordPress overwrite (no PR diff)');
  return flags;
}

/** Build the per-client brief from journaled changes + autopilot + AI-visibility extras. Pure. */
export function buildBrief(client, changes = [], autopilot = null, extras = {}) {
  const auto = changes.filter((c) => /autopilot/.test(c.runId || ''));
  const human = changes.filter((c) => !/autopilot/.test(c.runId || ''));
  const flagged = changes.map((c) => ({ ...c, flags: flagChange(c) })).filter((c) => c.flags.length);

  const L = [`## ${client}`, `${changes.length} change(s) — ${auto.length} autopilot (verifier-consensus), ${human.length} human · ${flagged.length} flagged`];
  if (autopilot) L.push(`autopilot last run: ${autopilot.applied || 0} applied · ${autopilot.verifierRejected || 0} held by verifiers · ${autopilot.policyQueued || 0} queued by policy`);
  if (changes.length) {
    L.push('', '| When | Page | Change | By | Rollback |', '|---|---|---|---|---|');
    for (const c of changes.slice(0, 40)) L.push(`| ${(c.ts || '').slice(5, 16)} | ${c.url || '?'} | ${c.field || c.type || '?'} | ${/autopilot/.test(c.runId || '') ? '🤖 consensus' : '👤 human'} | \`rollback ${client}\` |`);
  }
  if (flagged.length) {
    L.push('', '### ⚠ Might be wrong — review these');
    for (const c of flagged) L.push(`- **${c.url}** (${c.field || c.type}): ${c.flags.join('; ')}`);
  }
  if (!changes.length) L.push('', '_No changes in the window._');

  // ---- AI visibility + the source map (for the Seenai dev / off-site team) ----
  const vis = extras.visibility, src = extras.sources;
  if (vis && Object.keys(vis).length) {
    L.push('', '### 📡 AI visibility this week (ChatGPT / AI Mode / Perplexity / AIO / organic)');
    for (const [e, s] of Object.entries(vis)) L.push(`- **${e}**: ${s.visibility_pct}% mentioned · ${s.cited_pct}% cited · avg pos ${s.avg_position ?? '—'} (${s.answered}/${s.prompts})`);
  }
  if (src?.topSources?.length) {
    L.push('', '### 🔗 What AI is citing for our queries → send to the dev/off-site team', '', '| Source | Type | Citations |', '|---|---|---|');
    for (const s of src.topSources.slice(0, 12)) L.push(`| ${s.host} | ${s.type} | ${s.citations} |`);
    if (src.offsiteWorklist?.length) {
      L.push('', '**Off-site targets we are ABSENT from (get listed / mentioned / reviewed):**');
      for (const w of src.offsiteWorklist.slice(0, 10)) L.push(`- [ ] **${w.host}** (${w.type}) — ${w.action}`);
    }
    if (src.ownPresent === false) L.push('', '⚠ Our domain was **not cited at all** — the off-site presence above is the path in.');
  }
  return { client, total: changes.length, autopilot: auto.length, human: human.length, flagged, sources: src || null, visibility: vis || null, markdown: L.join('\n') };
}

function readLedger(client, hours) {
  const f = join(ROOT, 'reports', client, 'change-ledger.ndjson');
  if (!existsSync(f)) return [];
  const cutoff = Date.now() - hours * 3600 * 1000;
  return readFileSync(f, 'utf-8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .filter((r) => { const t = Date.parse(r.ts); return !Number.isFinite(t) || t >= cutoff; });
}

function readJson(client, file) {
  const f = join(ROOT, 'reports', client, file);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf-8')); } catch { return null; }
}
const readAutopilot = (client) => readJson(client, 'autopilot-latest.json');
const readSources = (client) => readJson(client, 'sources.json'); // off-site citation map (from `sources`)
function readVisibility(cfg) {
  const clientDir = join(ROOT, 'reports', cfg.name, 'ai-visibility');
  const globalDir = join(ROOT, 'data', 'ai-visibility'); // single-brand default OUT_DIR — only THIS client's if it matches
  for (const [d, mustMatch] of [[clientDir, false], [globalDir, true]]) {
    if (!existsSync(d)) continue;
    try {
      const files = readdirSync(d).filter((f) => f.endsWith('.json')).sort();
      if (!files.length) continue;
      const j = JSON.parse(readFileSync(join(d, files[files.length - 1]), 'utf-8'));
      if (mustMatch) { // never attribute another brand's global capture to this client
        const bm = j.brand && cfg.brand && j.brand.toLowerCase() === cfg.brand.toLowerCase();
        const dm = j.domain && cfg.domain && j.domain.replace(/^www\./, '') === cfg.domain.replace(/^www\./, '');
        if (!bm && !dm) continue;
      }
      return j.summary || null;
    } catch { /* */ }
  }
  return null;
}

export async function dailyBrief(cfg, { log = () => {}, hours = 24, deliver = true } = {}) {
  const changes = readLedger(cfg.name, hours);
  const brief = buildBrief(cfg.name, changes, readAutopilot(cfg.name), { sources: readSources(cfg.name), visibility: readVisibility(cfg) });
  const md = `# SEO bot — daily brief (${cfg.brand})\n${nowIso()} · last ${hours}h\n\n${brief.markdown}\n`;
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'daily-brief.md'), md);
  if (deliver) await deliverBrief(cfg, md, brief);
  log(`  Daily brief (${cfg.brand}): ${brief.total} changes, ${brief.flagged.length} flagged → ${join(dir, 'daily-brief.md')}`);
  return brief;
}

/** Portfolio digest across every client — one email for the founders. */
export async function portfolioBrief({ log = () => {}, hours = 24, deliver = true } = {}) {
  const parts = []; let totals = { changes: 0, flagged: 0 };
  for (const name of listConfigs()) {
    let cfg; try { cfg = loadConfig(name); } catch { continue; }
    const b = await dailyBrief(cfg, { log: () => {}, hours, deliver: false });
    totals.changes += b.total; totals.flagged += b.flagged.length;
    if (b.total) parts.push(b.markdown);
  }
  const md = `# SEO bot — daily portfolio brief\n${nowIso()} · last ${hours}h · ${totals.changes} changes, ${totals.flagged} flagged across ${listConfigs().length} sites\n\n${parts.join('\n\n') || '_No changes anywhere in the window._'}\n`;
  const dir = join(ROOT, 'reports'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'portfolio-brief.md'), md);
  if (deliver) await deliverBrief({ name: 'portfolio', brief: { recipients: process.env.SEO_BRIEF_TO } }, md, totals);
  log(`  Portfolio brief: ${totals.changes} changes, ${totals.flagged} flagged → ${join(dir, 'portfolio-brief.md')}`);
  return { ...totals, markdown: md };
}

/** Deliver via webhook (Slack/Discord/Zapier) if configured; else just the file. Graceful. */
async function deliverBrief(cfg, markdown, brief) {
  const hook = cfg.brief?.webhook || process.env.SEO_BRIEF_WEBHOOK;
  if (!hook) return { delivered: false, note: 'no webhook (set cfg.brief.webhook or SEO_BRIEF_WEBHOOK) — file only' };
  try { await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: markdown }) }); return { delivered: true }; }
  catch (e) { return { delivered: false, note: String(e.message || e) }; }
}
