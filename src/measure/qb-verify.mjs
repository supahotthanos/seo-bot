// seo-bot · measure/qb-verify — LLM integrity audit of the query-bank panel.
//
// The SECOND, independent line of defense behind the deterministic wall classifiers
// (capture-governor's isHardWall / isChallenge): a cheap headless `claude -p --model sonnet`
// pass re-reads SUSPICIOUS persisted rows — model label unread, no ranked list parsed, or a
// short answer — and adjudicates each one: is this text a REAL assistant answer to the prompt,
// or an error page / throttle interstitial / UI fragment that slipped past the regexes?
//
// Junk is QUARANTINED, never deleted: status → 'junk-llm' (original kept in statusWas), and every
// consumer already filters status === 'ok', so quarantined rows fall out of the panel, the deck's
// AI-visibility stat, variance decomposition and the voice corpus automatically. Rows judged real
// are stamped with the verdict so they are never re-billed to the adjudicator.
//
// FAIL-CLOSED: no claude CLI, a hung session, or unparseable verdicts → NOTHING changes.
// Subscription-only (the claude CLI on the Mini's Max login) — never an API key. Sonnet by
// default: adjudication is easy work; the cheap tier protects the account's Opus budget.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { ROOT } from '../config.mjs';

const CLAUDE = process.env.SEO_BOT_CLAUDE_BIN || 'claude';
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000; // batch adjudication is one prompt — 5 min is generous
export const QB_VERIFY_MODEL = process.env.SEO_BOT_QB_VERIFY_MODEL || 'sonnet';

/** PURE: is this persisted row worth an LLM look? Only ok-rows (junk already excluded), never
 *  rows a previous pass has stamped, and only the shapes where the deterministic pipeline was
 *  least sure of itself: unread model label, no parsed ranked list, or a suspiciously short answer. */
export function isSuspectRow(r) {
  if (!r || r.status !== 'ok' || r.llmVerdict) return false;
  return r.model == null || !(Array.isArray(r.ranked) && r.ranked.length) || String(r.answer || '').length < 200;
}

/** PURE: one compact adjudication prompt for a batch of rows. The contract is a bare JSON array —
 *  no prose — so parsing is mechanical and fail-closed. */
export function buildVerifyPrompt(rows = []) {
  const items = rows.map((r, i) => JSON.stringify({
    i,
    prompt: String(r.promptText || '').slice(0, 120),
    model: r.model ?? null,
    rankedCount: (r.ranked || []).length,
    text: String(r.answer || r.answerExcerpt || '').replace(/\s+/g, ' ').slice(0, 500),
  }));
  return [
    'You are a data-integrity auditor for a panel of captured ChatGPT answers.',
    'For each item below, decide whether `text` is a REAL assistant answer to `prompt`.',
    'real=true  → genuine answer content (even partial, even without a ranked list, even with map-widget noise mixed in).',
    'real=false → an error page, rate-limit / "unusual activity" interstitial, CAPTCHA text, empty UI chrome, or text unrelated to the prompt.',
    'Reply with ONLY a JSON array, no prose, one object per item:',
    '[{"i":0,"real":true,"why":"<10 words max>"}, ...]',
    '',
    ...items,
  ].join('\n');
}

/** PURE + fail-closed: parse the adjudicator's reply. Returns a Map(i → {real, why}) covering only
 *  well-formed verdicts with in-range indices; anything unparseable returns null (change nothing). */
export function parseVerdicts(raw = '', n = 0) {
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  let arr = null;
  try { arr = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const out = new Map();
  for (const v of arr) {
    if (!v || typeof v !== 'object') continue;
    const i = Number(v.i);
    if (!Number.isInteger(i) || i < 0 || i >= n || typeof v.real !== 'boolean') continue;
    out.set(i, { real: v.real, why: String(v.why || '').slice(0, 80) });
  }
  return out.size ? out : null;
}

/** PURE: apply verdicts to the full row array. Judged-junk rows are quarantined (status 'junk-llm',
 *  original in statusWas); every adjudicated row gets llmVerdict so it is never re-billed. */
export function applyVerdicts(allRows = [], suspectIdx = [], verdicts = new Map(), { nowIso = '', model = QB_VERIFY_MODEL } = {}) {
  let junked = 0, stamped = 0;
  for (const [vi, verdict] of verdicts) {
    const row = allRows[suspectIdx[vi]];
    if (!row) continue;
    row.llmVerdict = { real: verdict.real, why: verdict.why, at: nowIso, model };
    stamped += 1;
    if (!verdict.real) { row.statusWas = row.status; row.status = 'junk-llm'; junked += 1; }
  }
  return { junked, stamped };
}

/**
 * Audit every client's observations.ndjson under reports/query-bank/. Rewrites a file ONLY when
 * at least one of its rows was adjudicated (previous content saved to observations.ndjson.bak).
 * `exec` is injectable for tests (the suite never spawns the real CLI).
 */
export function runQbVerify({ root = ROOT, exec = null, log = () => {}, maxRows = 50, nowIso = new Date().toISOString(), model = QB_VERIFY_MODEL, dry = false } = {}) {
  const base = join(root, 'reports', 'query-bank');
  if (!existsSync(base)) return { status: 'no-panel', scanned: 0, suspects: 0, junked: 0, byClient: {} };

  // Gather suspects across all clients (bounded — one cheap batch per run; the loop drains over passes).
  const clients = [];
  let scanned = 0, suspectsTotal = 0;
  for (const c of readdirSync(base)) {
    const f = join(base, c, 'observations.ndjson');
    if (!existsSync(f)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    const rows = lines.map((l) => { if (!l.trim()) return null; try { return JSON.parse(l); } catch { return { __raw: l }; } });
    const idx = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.__raw) continue;
      scanned += 1;
      if (isSuspectRow(r) && suspectsTotal < maxRows) { idx.push(i); suspectsTotal += 1; }
    }
    if (idx.length) clients.push({ client: c, file: f, rows, idx });
  }
  if (!suspectsTotal) { log('  qb-verify: no suspicious rows — panel clean'); return { status: 'clean', scanned, suspects: 0, junked: 0, byClient: {} }; }

  // One flat batch across clients; suspectIdx maps batch position → (client, row index).
  const batch = [], where = [];
  for (const c of clients) for (const i of c.idx) { batch.push(c.rows[i]); where.push({ c, i }); }
  const prompt = buildVerifyPrompt(batch);
  log(`  qb-verify: adjudicating ${batch.length} suspicious rows (of ${scanned} scanned) via claude --model ${model}`);
  if (dry) return { status: 'dry', scanned, suspects: batch.length, junked: 0, byClient: {} };

  const run = exec || ((bin, args, input) => execFileSync(bin, args, { cwd: root, encoding: 'utf8', timeout: VERIFY_TIMEOUT_MS, killSignal: 'SIGKILL', input, stdio: ['pipe', 'pipe', 'ignore'] }));
  let raw = null;
  try { raw = run(CLAUDE, ['-p', '--model', model, '--output-format', 'text'], prompt); }
  catch (e) { log(`  qb-verify: claude run failed (${String(e && e.message || e).slice(0, 100)}) — fail-closed, nothing changed`); return { status: 'llm-failed', scanned, suspects: batch.length, junked: 0, byClient: {} }; }
  const verdicts = parseVerdicts(raw, batch.length);
  if (!verdicts) { log('  qb-verify: unparseable verdicts — fail-closed, nothing changed'); return { status: 'unparseable', scanned, suspects: batch.length, junked: 0, byClient: {} }; }

  // Apply per client, rewrite only touched files (previous content → .bak).
  const byClient = {};
  let junkedTotal = 0;
  for (const c of clients) {
    const localIdx = [];
    const localVerdicts = new Map();
    for (const [vi, v] of verdicts) { if (where[vi].c === c) { localVerdicts.set(localIdx.length, v); localIdx.push(where[vi].i); } }
    if (!localVerdicts.size) continue;
    const { junked, stamped } = applyVerdicts(c.rows, localIdx, localVerdicts, { nowIso, model });
    if (stamped) {
      writeFileSync(c.file + '.bak', readFileSync(c.file, 'utf8'));
      writeFileSync(c.file, c.rows.filter(Boolean).map((r) => r.__raw ?? JSON.stringify(r)).join('\n') + '\n');
      byClient[c.client] = { stamped, junked };
      junkedTotal += junked;
      log(`  qb-verify: ${c.client} — ${stamped} adjudicated, ${junked} quarantined (junk-llm)`);
    }
  }
  return { status: 'ok', scanned, suspects: batch.length, junked: junkedTotal, byClient };
}
