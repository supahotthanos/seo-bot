// seo-bot · measure/heal — the self-healing capture escalation.
//
// Scripts do the scraping (zero LLM cost, fast); when a previously-working capture goes
// dark (the ChatGPT 5.3/5.4 pattern: fan-out fields RELOCATED and every static parser went
// blind), we escalate to a `claude -p` session with the Playwright MCP attached — Claude
// drives the browser with judgment, finds where the data moved, captures THIS run's data,
// and PROPOSES the updated recipe. Subscription-only (the claude CLI), never an API key.
//
// INVARIANTS:
//   • PROPOSE-ONLY: the heal agent writes reports/<client>/heal/** ONLY. It is explicitly
//     instructed never to edit src/, never to commit, never to push. Recipe changes land as
//     proposal files a human (or an explicit follow-up command) turns into a PR.
//   • FAIL-CLOSED: no claude CLI → 'skipped-no-llm'; unparseable agent output → 'failed'
//     (never a fake 'healed'); watchdog SIGKILL on hangs → 'timeout'.
//   • OWN-SHELL ONLY: a nested `claude -p` inside another Claude Code session can 401 —
//     heal is built to run from cron/Task Scheduler or a user shell (same as llm.mjs).
//   • SCHEDULED AUTO-HEAL IS OPT-IN: cfg.heal?.enabled === true (strict boolean, the
//     autopilot.push pattern). Manual `seo-bot heal <client>` is always allowed.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../config.mjs';
import { llmAvailable } from '../llm.mjs';

const CLAUDE = process.env.SEO_BOT_CLAUDE_BIN || 'claude';
const HEAL_TIMEOUT_MS = 20 * 60 * 1000; // same hard watchdog as measure.mjs — a hung browser must not freeze cron

/**
 * PURE: should a failed capture escalate to a heal session?
 * Escalate ONLY when the capture went dark against a KNOWN-GOOD baseline — a first-ever
 * empty run proves nothing (maybe the engine genuinely ran no searches), and blocked runs
 * are a scraping/IP problem, not a recipe problem (healing can't fix a Turnstile wall).
 * @param {{status?:string, rows?:Array}} current   latest capturePanel output (or single row)
 * @param {{status?:string, rows?:Array}} previous  the last SAVED capture for the same client/engine
 */
export function shouldEscalate(current, previous) {
  const usable = (c) => {
    if (!c) return 0;
    if (Array.isArray(c.rows)) return c.rows.filter((r) => r?.status === 'ok' && (r.subqueries || []).length).length;
    return c.status === 'ok' && (c.subqueries || []).length ? 1 : 0;
  };
  const blocked = (c) => {
    if (!c) return false;
    if (Array.isArray(c.rows)) return c.rows.length > 0 && c.rows.every((r) => r?.status === 'blocked');
    return c.status === 'blocked';
  };
  if (blocked(current)) return { escalate: false, reason: 'blocked — an access problem, not a recipe problem (heal cannot fix a bot wall)' };
  if (usable(current) > 0) return { escalate: false, reason: 'capture healthy' };
  if (usable(previous) === 0) return { escalate: false, reason: 'no successful baseline — an empty first run is not evidence the recipe broke' };
  return { escalate: true, reason: 'capture went dark against a known-good baseline — recipe likely broke (field relocation?)' };
}

/**
 * PURE: build the healing prompt for the claude -p agent.
 * Carries the current field map (research/fanout-extraction-2026.md) as starting knowledge
 * and hard propose-only rules. Output contract: a single JSON object on stdout.
 */
export function buildHealPrompt({ client, engine = 'chatgpt', samplePrompt, fieldMap = '', outDir }) {
  return [
    `You are the capture-repair agent for seo-bot. The scripted fan-out capture for engine "${engine}" stopped returning sub-queries after previously working — the extraction recipe likely broke (fields relocated, UI changed, or response shape moved).`,
    '',
    'YOUR JOB (in order):',
    `1. Use the Playwright MCP browser tools to open ${engine === 'perplexity' ? 'https://www.perplexity.ai' : 'https://chatgpt.com'} and submit this test prompt: ${JSON.stringify(samplePrompt)}`,
    '2. Inspect the network traffic / conversation payload the way the old recipe did, and find where the fan-out sub-queries live NOW. Known previous locations (your starting map):',
    fieldMap ? fieldMap.split('\n').map((l) => '   ' + l).join('\n') : '   (no field map available — discover from scratch)',
    `3. Save what you captured to ${outDir}/captured.json as {"engine":"${engine}","subqueries":[...],"citations":[...],"foundAt":"<where the fields live now>"}.`,
    `4. Write your updated recipe as a PROPOSAL to ${outDir}/proposed-recipe.md: the new field names/paths, the endpoint, extraction steps, and (if useful) a suggested patch for src/measure/fanout-capture.mjs as a fenced diff INSIDE that markdown file.`,
    '',
    'HARD RULES — violating any of these makes the run a failure:',
    '- NEVER edit any file under src/, bin/, or test/. Your writes go ONLY inside ' + outDir + '.',
    '- NEVER run git commit, git push, or open PRs. You PROPOSE; humans apply.',
    '- NEVER log in to any account or handle credentials; if the page demands auth you do not have, report it honestly.',
    '- If you cannot find the sub-queries, say so — an honest "not-found" beats a fabricated recipe.',
    '',
    `When done, print EXACTLY ONE JSON object on stdout: {"status":"healed"|"not-found"|"auth-required","subqueriesFound":<n>,"foundAt":"<summary>","notes":"<1-2 sentences>"} and nothing after it.`,
  ].join('\n');
}

/** Read the current field-map section out of the research doc (best-effort, pure-ish). */
export function loadFieldMap(root = ROOT) {
  try {
    const doc = readFileSync(join(root, 'research', 'fanout-extraction-2026.md'), 'utf8');
    const m = doc.match(/## 2 · The 5\.3\/5\.4 relocation[\s\S]*?(?=\n## )/);
    return m ? m[0].slice(0, 2400) : doc.slice(0, 2400);
  } catch { return ''; }
}

/** Build the Playwright MCP config file the claude CLI will load. */
export function writeMcpConfig(dir) {
  const cfg = { mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--headless'] } } };
  const p = join(dir, 'mcp-playwright.json');
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

/**
 * Run one heal session. FAIL-CLOSED shell around `claude -p` + Playwright MCP.
 * `exec` is injectable for tests (never spawn the real CLI in the suite).
 * @returns {{status:'healed'|'not-found'|'auth-required'|'failed'|'skipped-no-llm'|'timeout', report?:string}}
 */
export function runHeal(cfg, { engine = 'chatgpt', samplePrompt = 'best med spa near me 2026', nowMs = Date.now() } = {}, { exec = null, log = () => {} } = {}) {
  if (!llmAvailable()) {
    log('  heal: no claude CLI / no LLM — skipped (fail-closed; capture stays marked broken)');
    return { status: 'skipped-no-llm' };
  }
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-');
  const outDir = join(ROOT, 'reports', cfg.name, 'heal', stamp);
  mkdirSync(outDir, { recursive: true });
  const mcpConfig = writeMcpConfig(outDir);
  const prompt = buildHealPrompt({ client: cfg.name, engine, samplePrompt, fieldMap: loadFieldMap(), outDir });
  const args = ['-p', prompt, '--output-format', 'json', '--mcp-config', mcpConfig, '--allowedTools', 'mcp__playwright__*,Write,Read'];

  let raw = null;
  const run = exec || ((bin, a) => execFileSync(bin, a, { cwd: ROOT, encoding: 'utf8', timeout: HEAL_TIMEOUT_MS, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'] }));
  try {
    raw = run(CLAUDE, args);
  } catch (e) {
    const killed = e?.signal === 'SIGKILL' || e?.code === 'ETIMEDOUT';
    const status = killed ? 'timeout' : 'failed';
    writeFileSync(join(outDir, 'heal-result.json'), JSON.stringify({ status, error: String(e?.message || e).slice(0, 300), at: new Date(nowMs).toISOString() }, null, 2));
    log(`  heal: ${status}${killed ? ' (20m watchdog killed a hung session)' : ''}`);
    return { status, report: outDir };
  }

  // The claude CLI wraps the agent's final text in its own JSON envelope; the agent's last
  // line is OUR contract object. Parse both layers fail-closed — anything unparseable is
  // 'failed', never a fake 'healed'.
  let verdict = null;
  try {
    const envelope = JSON.parse(raw);
    const text = typeof envelope === 'string' ? envelope : (envelope.result ?? envelope.text ?? '');
    const m = String(text).match(/\{[^{}]*"status"[^{}]*\}(?!.*\{[^{}]*"status"[^{}]*\})/s);
    if (m) verdict = JSON.parse(m[0]);
  } catch { /* fall through fail-closed */ }
  const ok = verdict && ['healed', 'not-found', 'auth-required'].includes(verdict.status);
  const result = ok
    ? { status: verdict.status, subqueriesFound: verdict.subqueriesFound ?? 0, foundAt: verdict.foundAt || '', notes: verdict.notes || '', report: outDir }
    : { status: 'failed', error: 'agent output did not match the contract (fail-closed)', report: outDir };
  writeFileSync(join(outDir, 'heal-result.json'), JSON.stringify({ ...result, at: new Date(nowMs).toISOString(), engine }, null, 2));
  log(`  heal: ${result.status}${result.foundAt ? ' — ' + result.foundAt : ''}`);
  return result;
}

/**
 * The scheduled-path hook: given the fresh capture and the previously saved one, decide and
 * (only with the strict opt-in) run the heal. Without opt-in it records the suggestion so
 * the report/dashboard surfaces "capture broke — run `seo-bot heal <client>`".
 */
export function maybeHeal(cfg, current, previous, opts = {}, deps = {}) {
  const gate = shouldEscalate(current, previous);
  if (!gate.escalate) return { ran: false, ...gate };
  if (cfg?.heal?.enabled !== true) {
    return { ran: false, escalate: true, reason: gate.reason, hint: `capture went dark — run \`seo-bot heal ${cfg?.name || '<client>'}\` (auto-heal off; set heal.enabled=true to allow scheduled healing)` };
  }
  return { ran: true, escalate: true, reason: gate.reason, result: runHeal(cfg, opts, deps) };
}
