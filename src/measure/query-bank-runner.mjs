// seo-bot · measure/query-bank-runner — drive the query bank into the panel, safely + resumably.
//
// Expands the bank (queries × spelling variants × engines × tiers × cities) into observation specs,
// captures a capped SLICE this run (multi-tab concurrent on the logged-in ChatGPT CDP session),
// stamps every answer with all panel dimensions, appends to observations.ndjson, advances a wrap-
// around cursor for coverage over time, and rebuilds the Peec-style report. Fail-closed: only ok
// captures are persisted; a ChatGPT message-cap / challenge pauses the run (never forced, never solved).

import { captureFanoutBatch, selectEffortTier } from './fanout-capture.mjs';
import { expandQueryBank, answerHash, MEDSPA_QUERY_BANK } from './query-bank.mjs';
import { buildQueryBankReport } from './query-bank-analytics.mjs';
import { isChallenge, isRateLimit, inCooldown, SAFE_DEFAULTS } from './capture-governor.mjs';

/** PURE: stamp a raw capture rec with the observation's panel dimensions (the spec) + derived day
 *  fields. capturedAt comes from the capture; nowIso is a fallback. Everything the analytics slices
 *  on lives here, so a row is self-describing. */
export function stampObservation(rec = {}, spec = {}, { nowIso = '' } = {}) {
  const capturedAt = rec.capturedAt || nowIso;
  let dow = null; try { dow = new Date(capturedAt).getUTCDay(); } catch { /* leave null */ }
  return {
    status: rec.status || 'empty',
    queryId: spec.queryId, intent: spec.intent, variantId: spec.variantId, template: spec.template,
    promptText: spec.promptText ?? rec.prompt, engine: spec.engine || rec.engine || 'chatgpt', tier: spec.tier || 'default', city: spec.city,
    capturedAt, dow, day: String(capturedAt).slice(0, 10),
    model: rec.model || null,
    answerHash: answerHash(rec.answer || ''),
    ranked: rec.ranked || [], subqueries: rec.subqueries || [], citations: rec.citations || { urls: [] },
    answerExcerpt: rec.answerExcerpt || '', answer: (rec.answer || '').slice(0, 4000),
  };
}

/** Run one capped, resumable slice of the query bank into the panel.
 *  deps: { fs, dir, log, capture, nowIso } — capture defaults to captureFanoutBatch (injectable for tests). */
export async function runQueryBank(cfg = {}, {
  bank = MEDSPA_QUERY_BANK, overrides = {}, concurrency = 3, maxPerRun = null,
  fs = null, dir = null, log = () => {}, capture = captureFanoutBatch, nowIso = new Date().toISOString(),
} = {}) {
  if (!fs || !dir) throw new Error('runQueryBank needs { fs, dir } from the caller');
  const { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } = fs;
  mkdirSync(dir, { recursive: true });
  const ndjson = `${dir}/observations.ndjson`;
  const cursorFile = `${dir}/.cursor`;
  const cooldownFile = `${dir}/.cooldown`; // epoch-ms of the last halt — persists ACROSS processes

  // COOLDOWN GATE (IP/account safety): after any halt (HTTP throttle / message cap / challenge /
  // error storm) we refuse to touch the browser again until the window passes — a run script,
  // an eager operator, and the schedule all hit this same gate, so nobody can re-hammer a
  // throttled session. Fail-open only on an unreadable file (never brick measurement forever).
  const nowMs = Date.parse(nowIso) || Date.now();
  if (existsSync(cooldownFile)) {
    const lastHalt = Number(readFileSync(cooldownFile, 'utf8').trim()) || 0;
    const cd = inCooldown(lastHalt, nowMs, SAFE_DEFAULTS.cooldownMs);
    if (cd.cooling) {
      const mins = Math.ceil(cd.remainingMs / 60000);
      log(`  🧊 query-bank in COOLDOWN after a prior halt — ${mins} min remaining. Not touching the browser (IP/account safety). Resumes automatically.`);
      return { captured: 0, halted: false, cooling: true, remainingMs: cd.remainingMs, accrued: 0, totalCells: 0, docPath: `${dir}/report.md` };
    }
  }

  const specs = expandQueryBank(bank, overrides);
  if (!specs.length) { log('  query-bank: no specs (empty bank/overrides)'); return { captured: 0, halted: false, accrued: 0, totalCells: 0, docPath: `${dir}/report.md` }; }
  let cursor = existsSync(cursorFile) ? (Number(readFileSync(cursorFile, 'utf8').trim()) || 0) : 0;
  if (cursor >= specs.length) cursor = 0; // wrap → refresh coverage
  const budget = Math.max(1, Number(maxPerRun) || SAFE_DEFAULTS.maxPerRun);
  const slice = specs.slice(cursor, cursor + budget);
  log(`  query-bank: ${specs.length} cells · resuming at #${cursor} · ${slice.length} this run · concurrency ${concurrency} (multi-tab)`);

  // haltReason distinguishes a REAL cap/challenge (→ long cooldown, the account is spent) from
  // TRANSIENT capture errors (a few tabs timed out under multi-tab/RAM contention — NOT a cap;
  // halt this run to stop hammering, but do NOT stamp the multi-hour cooldown, so the next loop
  // pass ~20 min later just retries). Conflating them idled the whole lane for 3h off 3 tab errors.
  let captured = 0, halted = false, haltReason = null, consecutiveErrors = 0;
  const ERROR_HALT_STREAK = Math.max(3, (Number(concurrency) || 1) + 3); // concurrency-aware: interleaved tab errors shouldn't trip it
  const onResult = (rec, spec, i) => {
    // A ChatGPT account message-cap or an anti-bot challenge → pause (NOT a ban, NOT forced/solved).
    if (!halted && (isRateLimit(rec.answerExcerpt || '') || isChallenge(rec.answerExcerpt || '') || isChallenge(rec.answer || ''))) {
      halted = true; haltReason = 'cap'; log(`  ⏸  ChatGPT limit/challenge at "${spec.promptText}" — pausing + cooldown (resume after reset).`); return;
    }
    if (halted) return;
    if (rec.status === 'ok') {
      consecutiveErrors = 0;
      const row = stampObservation(rec, spec, { nowIso });
      appendFileSync(ndjson, JSON.stringify(row) + '\n'); captured += 1;
      log(`  [${cursor + i + 1}/${specs.length}] ${spec.city} · ${spec.variantId} · ${spec.engine}: ${(row.ranked || []).length} ranked · ${(row.subqueries || []).length} subq · ${(row.citations?.urls || []).length} cites`);
    } else {
      if (rec.status === 'error') consecutiveErrors += 1; else consecutiveErrors = 0;
      log(`  [${cursor + i + 1}/${specs.length}] ${spec.city} · ${spec.variantId} · ${spec.engine}: ${rec.status} (excluded)`);
      // Circuit breaker: a long streak of consecutive errors → stop this run. Marked as 'errors'
      // (transient) not 'cap' — so we retry next pass without burning a multi-hour cooldown.
      if (consecutiveErrors >= ERROR_HALT_STREAK) { halted = true; haltReason = 'errors'; log(`  ⏸  ${consecutiveErrors} consecutive capture errors — ending this run (transient; retry next pass, no cooldown).`); }
    }
  };

  // captureFanoutBatch captures spec.prompt; our specs carry promptText — enrich so both the capture
  // and the (dimension-rich) spec handed to onResult are correct. Each ChatGPT spec also gets a
  // beforeSend that FORCES its reasoning tier (low=Instant / Medium / High) and a tier-aware answer-
  // wait floor (low answers finish fast; high stream a ~50s search first).
  const TIER_MIN_MS = { low: 5000, medium: 15000, high: 25000, default: 8000 };
  const captureSpecs = slice.map((s) => ({
    ...s, prompt: s.promptText,
    beforeSend: s.engine === 'chatgpt' ? (page) => selectEffortTier(page, s.tier) : null,
    minAnswerMs: TIER_MIN_MS[s.tier] || 8000,
  }));
  await capture(captureSpecs, { concurrency, headful: true, onResult, shouldStop: () => halted });

  // Always advance (wrap-around coverage): a message-cap halt means further captures THIS day fail
  // too, so move on next run rather than re-hammering the same slice.
  writeFileSync(cursorFile, String((cursor + slice.length) >= specs.length ? 0 : cursor + slice.length));
  // Cooldown-stamp policy (learned live — chatgpt.com HTTP-throttles navigation, ERR_HTTP_RESPONSE_
  // CODE_FAILURE, when hit too hard; it clears with time):
  //   • 'cap'            → real message cap/challenge → stamp (back off).
  //   • 'errors' & 0 cap → EVERY capture failed = a throttle wall (not transient) → stamp (back off).
  //   • 'errors' & some  → a few tabs hiccuped among successes = transient → DON'T stamp (retry soon).
  const throttled = haltReason === 'cap' || (haltReason === 'errors' && captured === 0);
  if (throttled) writeFileSync(cooldownFile, String(nowMs));

  const allRows = existsSync(ndjson) ? readFileSync(ndjson, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const report = buildQueryBankReport(allRows, { generatedAt: nowIso, clientBrand: cfg.brand || '' });
  writeFileSync(`${dir}/report.md`, report);
  return { captured, halted, haltReason, accrued: allRows.length, totalCells: specs.length, cursorAt: (cursor + slice.length) % specs.length, docPath: `${dir}/report.md` };
}
