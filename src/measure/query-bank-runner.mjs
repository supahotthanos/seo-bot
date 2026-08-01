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
export function stampObservation(rec = {}, spec = {}, { nowIso = '', vantage = null, authState = null } = {}) {
  const capturedAt = rec.capturedAt || nowIso;
  let dow = null; try { dow = new Date(capturedAt).getUTCDay(); } catch { /* leave null */ }
  return {
    status: rec.status || 'empty',
    queryId: spec.queryId, intent: spec.intent, variantId: spec.variantId, template: spec.template,
    promptText: spec.promptText ?? rec.prompt, engine: spec.engine || rec.engine || 'chatgpt', tier: spec.tier || 'default', city: spec.city,
    capturedAt, dow, day: String(capturedAt).slice(0, 10),
    model: rec.model || null,
    // vantage = WHICH SEAT captured this (mini | laptop-ca | …). Two capture machines on two
    // networks are a variance factor a quant must be able to hold fixed — unstamped rows would
    // silently mix vantages and pollute the day/spelling/engine decomposition.
    vantage: rec.vantage ?? vantage,
    // authState = logged-in | logged-out (Shubh 2026-07-20: "an unbiased opinion based off of
    // area"). Temporary chat STILL applies the account's custom instructions; only a logged-out
    // session is personalization-free. Same prompt across both states = the personalization
    // delta, measured. null = legacy rows captured before the label existed.
    authState: rec.authState ?? authState,
    answerHash: answerHash(rec.answer || ''),
    ranked: rec.ranked || [], subqueries: rec.subqueries || [], citations: rec.citations || { urls: [] },
    answerExcerpt: rec.answerExcerpt || '', answer: (rec.answer || '').slice(0, 4000),
    // Source-level fields (Edward Sturm's July-2026 method): what the payload actually reveals —
    // the fan-out sub-queries, the {url,title,resultSource} sources cited, the "runner-up"
    // supporting_websites, the trace lines shown mid-stream, the final answer's <a> chips.
    // Historically written by the capture layer but DROPPED here (3,932 rows had sturm=undefined).
    sturm: rec.sturm || null,
    searchTrace: rec.searchTrace || [],
    fetchedUrls: rec.fetchedUrls || [],
  };
}

/** Run one capped, resumable slice of the query bank into the panel.
 *  deps: { fs, dir, log, capture, nowIso } — capture defaults to captureFanoutBatch (injectable for tests). */
export async function runQueryBank(cfg = {}, {
  bank = MEDSPA_QUERY_BANK, overrides = {}, concurrency = 3, maxPerRun = null,
  fs = null, dir = null, log = () => {}, capture = captureFanoutBatch, nowIso = new Date().toISOString(),
  vantage = process.env.SEO_BOT_VANTAGE || null, // which capture seat (env-set per machine)
  authState = process.env.SEO_BOT_AUTH_STATE || null, // logged-in | logged-out (env-set per lane)
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
  let captured = 0, halted = false, haltReason = null, consecutiveMisses = 0;
  const MISS_HALT_STREAK = Math.max(3, (Number(concurrency) || 1) + 3); // concurrency-aware: interleaved tab misses shouldn't trip it
  const onResult = (rec, spec, i) => {
    // A ChatGPT account message-cap, an anti-bot challenge, or a page-level WALL (capture layer
    // saw "unusual activity"/throttle text → status 'blocked' + blockText) → pause. NOT forced,
    // NOT solved — and always a cooldown, because a walled session stays walled if re-hammered.
    if (!halted && (rec.status === 'blocked'
      || isRateLimit(rec.answerExcerpt || '') || isChallenge(rec.answerExcerpt || '')
      || isChallenge(rec.answer || '') || isRateLimit(rec.blockText || '') || isChallenge(rec.blockText || ''))) {
      halted = true; haltReason = 'cap';
      log(`  ⏸  ChatGPT limit/challenge/wall at "${spec.promptText}"${rec.blockText ? ` — "${String(rec.blockText).slice(0, 90)}"` : ''} — pausing + cooldown (resume after reset).`);
      return;
    }
    if (halted) return;
    if (rec.status === 'ok') {
      consecutiveMisses = 0;
      const row = stampObservation(rec, spec, { nowIso, vantage, authState });
      appendFileSync(ndjson, JSON.stringify(row) + '\n'); captured += 1;
      log(`  [${cursor + i + 1}/${specs.length}] ${spec.city} · ${spec.variantId} · ${spec.engine}: ${(row.ranked || []).length} ranked · ${(row.subqueries || []).length} subq · ${(row.citations?.urls || []).length} cites`);
    } else {
      // EVERY non-ok result counts toward the breaker. The old version only counted 'error' —
      // an unrecognized throttle wall surfaces as EMPTY, so an all-empty run sailed through the
      // whole slice, never halted, never cooled down, and re-hammered every loop pass (the
      // "keeps wasting into the wall" failure Shubh caught live on the Mini, 2026-07-14).
      consecutiveMisses += 1;
      log(`  [${cursor + i + 1}/${specs.length}] ${spec.city} · ${spec.variantId} · ${spec.engine}: ${rec.status} (excluded)`);
      if (consecutiveMisses >= MISS_HALT_STREAK) { halted = true; haltReason = 'errors'; log(`  ⏸  ${consecutiveMisses} consecutive missed captures (empty/error) — ending this run.`); }
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
