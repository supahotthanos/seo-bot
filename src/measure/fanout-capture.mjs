// seo-bot · measure/fanout-capture — the "Edward Sturm" fan-out capture.
//
// Drives the REAL consumer AI apps with a stealth browser and records the ACTUAL
// sub-queries each engine issues: ChatGPT's web-search calls (read off the network
// layer, the way you'd watch the Network tab) and Perplexity's displayed searches.
// This is the empirical complement to src/fanout.mjs, which PREDICTS fan-out — here we
// capture what the engine truly ran, so we optimize for real sub-queries.
//
// Runs on the Mac Mini (residential IP), same stealth posture as
// scripts/ai-visibility/track.mjs. Fail-closed: a blocked/empty capture returns
// status !== 'ok' and is excluded from analysis (never a false "no sub-queries").

import { launchBrowser } from './browser.mjs';

const SEARCH_HINTS = [/search/i, /query/i, /grounding/i, /web.?search/i, /backend-api\/conversation/i];

// Where ChatGPT keeps fan-out queries in the /backend-api/conversation JSON — the locations
// MOVED across 5.3/5.4 (hidden from the old console spot) but remain in the conversation
// payload under these nested fields (Yacoub bookmarklet field map + Sturm's original recipe,
// research/fanout-extraction-2026.md). Recursive traversal is deliberate: regex on nested JSON
// is brittle, and the exact nesting shifts release to release.
const QUERY_ARRAY_KEYS = new Set(['search_model_queries', 'search_queries', 'queries']);
const QUERY_STRING_KEYS = new Set(['search_query', 'request_query', 'query', 'q']);
const plausibleQuery = (s) => typeof s === 'string' && s.trim().length >= 3 && s.trim().length <= 120;

/** Recursively collect fan-out query strings from a parsed conversation object. */
function walkForQueries(node, out, depth = 0) {
  if (!node || depth > 24) return;
  if (Array.isArray(node)) { for (const v of node) walkForQueries(v, out, depth + 1); return; }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (QUERY_ARRAY_KEYS.has(k) && Array.isArray(v)) {
      for (const q of v) {
        if (plausibleQuery(q)) out.push(q);
        else if (q && typeof q === 'object' && plausibleQuery(q.q ?? q.query)) out.push(q.q ?? q.query);
      }
    } else if (QUERY_STRING_KEYS.has(k) && plausibleQuery(v)) {
      out.push(v);
    } else if (v && typeof v === 'object') {
      walkForQueries(v, out, depth + 1);
    }
  }
}

/** PURE + testable: pull candidate sub-queries out of intercepted network bodies.
 *  entries: [{ url, postData, body }] collected from requests/responses.
 *  Two passes: (1) JSON.parse + recursive field walk (robust to the 5.3/5.4 relocation),
 *  (2) the legacy regex sweep as a fallback for fragments/non-JSON bodies. */
export function extractFromNetwork(entries = []) {
  const out = [];
  for (const e of entries) {
    for (const b of [e.postData, e.body].filter(Boolean)) {
      const s = typeof b === 'string' ? b : JSON.stringify(b);
      let parsed = null;
      try { parsed = JSON.parse(s); } catch { /* not JSON — regex pass below still runs */ }
      if (parsed) walkForQueries(parsed, out);
      for (const m of s.matchAll(/"(?:search_query|request_query|query|q|text|term)"\s*:\s*"([^"]{3,120})"/g)) out.push(m[1]);
      for (const m of s.matchAll(/"(?:queries|search_queries|search_model_queries)"\s*:\s*\[([^\]]+)\]/g))
        for (const q of m[1].matchAll(/"([^"]{3,120})"/g)) out.push(q[1]);
    }
  }
  // Drop code/JSON fragments the greedy regex can catch (e.g. `search(\`, escaped bits, URLs, keys) —
  // real fan-out sub-queries are natural language, never contain backslashes/braces or start with a verb-call.
  const clean = out.filter((q) => q && !/[\\{}]/.test(q) && !/^\s*(search|fetch|function|const|var|return|https?:|www\.)\b/i.test(q) && /[a-z]/i.test(q));
  return dedupe(clean);
}

/** PURE + testable: pull the CITED sources out of the same conversation payloads —
 *  content_references.items[].url, safe_urls[], and search_result_group entries
 *  ({title,url,snippet}). Additive companion to extractFromNetwork; a capture that
 *  carries citations lets SoV/sources join fan-out → cited-source without a second fetch. */
export function extractCitationsFromNetwork(entries = []) {
  const urls = [], results = [];
  const walk = (node, depth = 0) => {
    if (!node || depth > 24) return;
    if (Array.isArray(node)) { for (const v of node) walk(v, depth + 1); return; }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'safe_urls' && Array.isArray(v)) { for (const u of v) if (typeof u === 'string' && /^https?:\/\//.test(u)) urls.push(u); }
      else if (k === 'content_references' && Array.isArray(v)) {
        for (const ref of v) for (const item of (ref?.items || [])) if (typeof item?.url === 'string' && /^https?:\/\//.test(item.url)) urls.push(item.url);
      } else if (k === 'search_result_group' || k === 'search_result_groups') {
        const groups = Array.isArray(v) ? v : [v];
        for (const g of groups) for (const r of (g?.entries || g?.results || [])) {
          if (typeof r?.url === 'string' && /^https?:\/\//.test(r.url)) { urls.push(r.url); results.push({ title: r.title || '', url: r.url, snippet: r.snippet || '' }); }
        }
      } else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  for (const e of entries) {
    for (const b of [e.postData, e.body].filter(Boolean)) {
      try { walk(JSON.parse(typeof b === 'string' ? b : JSON.stringify(b))); } catch { /* non-JSON body carries no citation structures */ }
    }
  }
  const seen = new Set(), dedupedUrls = [];
  for (const u of urls) if (!seen.has(u)) { seen.add(u); dedupedUrls.push(u); }
  return { urls: dedupedUrls, results };
}

/** PURE + testable: Edward-Sturm SOURCE-LEVEL extraction from the conversation JSON — the exact fields
 *  his method reads off the network: the fan-out (search_model_queries / search_queries / queries), the
 *  cited sources (content_references items, WITH titles), and safe_urls. Honest: everything is empty when
 *  the model didn't search (e.g. a low/Instant answer from memory). Complements the DOM trace with the
 *  authoritative raw payload — "what he says to do", from the source, not screen-scraped. */
export function extractSturm(entries = []) {
  const searchModelQueries = extractFromNetwork(entries); // reuse the robust, relocation-proof query walk
  const refs = [], safe = [];
  const walk = (node, depth = 0) => {
    if (!node || depth > 24) return;
    if (Array.isArray(node)) { for (const v of node) walk(v, depth + 1); return; }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'safe_urls' && Array.isArray(v)) { for (const u of v) if (typeof u === 'string' && /^https?:\/\//.test(u)) safe.push(u); }
      else if (k === 'content_references' && Array.isArray(v)) {
        for (const ref of v) {
          const items = ref?.items || (typeof ref?.url === 'string' ? [ref] : []);
          for (const it of items) if (typeof it?.url === 'string' && /^https?:\/\//.test(it.url)) refs.push({ url: it.url, title: it.title || it.attribution || '' });
        }
      } else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  for (const e of entries) for (const b of [e.postData, e.body].filter(Boolean)) { try { walk(JSON.parse(typeof b === 'string' ? b : JSON.stringify(b))); } catch { /* non-JSON carries no structures */ } }
  const seen = new Set(), contentReferences = [];
  for (const r of refs) if (!seen.has(r.url)) { seen.add(r.url); contentReferences.push(r); }
  return { searchModelQueries, contentReferences, safeUrls: [...new Set(safe)] };
}

/** PURE + testable: pull Perplexity's displayed searches out of region text lines. */
export function extractFromDom(lines = []) {
  return dedupe(lines.map(t => (t || '').trim()).filter(t => t.length >= 3 && t.length <= 120 && /\s/.test(t)));
}

function dedupe(arr) {
  const seen = new Set(), out = [];
  for (const s of arr.map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  }
  return out;
}

// ChatGPT's reasoning "search trace" mixes two different things: the natural-language fan-out
// sub-queries ("Searched best med spa miami") and the SOURCES it visits ("Searching www.realself.com",
// or a bare "nypost.com"). PURE + testable: split them so sub-queries stay clean and every
// domain-looking line — with OR without a www./https:// prefix — is counted as a source, not a query.
const TRACE_VERB = /^(Searched|Searching|Reading|Evaluated|Browsing|Looking)\s*/i;
const isBareDomain = (s) => !/\s/.test(s) && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?$/i.test(s);
export function splitTrace(searchTrace = []) {
  const queries = [], domains = [];
  for (const raw of searchTrace) {
    const line = String(raw || '');
    const stripped = line.replace(TRACE_VERB, '').trim();
    const m = line.match(/(?:www\.|https?:\/\/)([a-z0-9.-]+\.[a-z]{2,})/i);
    if (m) { domains.push('https://' + m[1].replace(/^www\./, '')); continue; }
    if (isBareDomain(stripped)) { domains.push('https://' + stripped.replace(/^www\./, '').split('/')[0]); continue; }
    if (stripped.length >= 4 && !/^www\.|^https?:/i.test(stripped)) queries.push(stripped);
  }
  return { queries: dedupe(queries), domains: dedupe(domains) };
}

/** PURE + testable: parse the RANKED business list out of a ChatGPT "best med spas in {city}" answer.
 *  This is the core tracking signal — WHO ChatGPT ranks #1..N for a city, so we watch movement over
 *  time. Handles the FOUR layouts ChatGPT actually uses across tiers:
 *    1) numbered ("1. Name — ...")
 *    2) markdown / rendered TABLE (tab- OR pipe-separated; first column = business) — the common
 *       low/Instant layout, e.g. "Med Spa\tBest For\tHighlights"
 *    3) Google-Maps LOCAL PACK / rating list (a name line adjacent to a "4.9"/"5.0" rating line)
 *    4) bolded-header ("**Name** — ...") blocks
 *  Returns [{ rank, name }] in order; empty if no ranked entities found (never fabricates). */
const RANK_BAD = /^(best|top|these|here|options?|based|note|summary|overall|why|how|what|if|for|med spa|medical spa|rank|name|business|address|rating|highlights|neighborhood|price|closed|open|expand|give feedback|use two)\b/i;
const isRatingLine = (s) => /^(?:★\s*)?[0-5](?:\.\d{1,2})?\s*(?:★|stars?|\/5)?$/.test(String(s).trim());
export function parseRankedAnswer(text = '') {
  const t = String(text || '').replace(/\r/g, '').replace(/^\s*worked for [^\n]*\n?/i, '');
  const clean = (s) => String(s).replace(/\*\*/g, '').replace(/^[#>\-\s•]+/, '').replace(/\s+/g, ' ').trim();
  const nameOk = (n) => n && n.length >= 3 && n.length <= 74 && /[A-Za-z]/.test(n) && /[a-z]/.test(n) && !RANK_BAD.test(n) && !isRatingLine(n);

  // 1) explicit numbered list: "1. Name", "2) Name"
  const numbered = [];
  for (const m of t.matchAll(/(?:^|\n)\s*(\d{1,2})[.)]\s+(\*\*)?([^\n—–|\t*]{3,80})/g)) {
    const name = clean(m[3]).split(/\s[—–|-]\s/)[0].trim();
    if (nameOk(name)) numbered.push({ rank: Number(m[1]), name });
  }
  if (numbered.length >= 2) return dedupeRanked(numbered);

  // 2) TABLE rows — tab- or pipe-separated; first cell is the business. Skip header + separator rows.
  const table = [];
  for (const line of t.split('\n')) {
    if (!/\t|\|/.test(line)) continue;
    const cells = line.split(/\t|\s*\|\s*/).map(clean).filter((c) => c !== '');
    if (cells.length < 2) continue;
    if (/^[-:\s]+$/.test(cells[0])) continue;                 // markdown separator row
    const name = cells[0].replace(/^\d{1,2}[.)]\s*/, '').trim();
    if (nameOk(name)) table.push({ rank: table.length + 1, name });
  }
  if (table.length >= 2) return dedupeRanked(table);

  // 3) LOCAL PACK / rating list — a name line adjacent (before or after) to a standalone rating line.
  const lines = t.split('\n').map(clean);
  const ratingList = [];
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    if (!nameOk(name)) continue;
    const near = isRatingLine(lines[i - 1] || '') || isRatingLine(lines[i + 1] || '');
    if (near) ratingList.push({ rank: ratingList.length + 1, name });
  }
  if (ratingList.length >= 2) return dedupeRanked(ratingList);

  // 4) bolded headers or "Name — location — descriptor" blocks
  const items = [];
  let rank = 0;
  for (const b of t.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
    const m = b.match(/^(?:\*\*)?([A-Z][A-Za-z0-9'&.,\s]{3,70}?)(?:\*\*)?\s*[—–]\s+/); // Name — ...
    if (m) { const name = clean(m[1]); if (nameOk(name)) { rank += 1; items.push({ rank, name }); } }
  }
  return dedupeRanked(items);
}

function dedupeRanked(items) {
  const seen = new Set(), out = [];
  for (const it of items) { const k = it.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ rank: out.length + 1, name: it.name }); } }
  return out.slice(0, 10);
}

async function looksBlocked(page) {
  const t = (await page.content().catch(() => '')).toLowerCase();
  return /verify you are human|unusual traffic|just a moment|enable javascript|captcha|consent\.google/.test(t);
}

// The 2026 ChatGPT composer has a REASONING-EFFORT chip (a button[aria-haspopup="menu"] showing the
// current level). Its menu offers Instant (=low / fast, no extended thinking), Medium, High. We drive
// it so the panel's `tier` is REAL, not just a label. Best-effort + honest: returns the level actually
// showing after the attempt (or null), so a row never claims a tier we couldn't set.
const TIER_TO_OPTION = { low: /instant/i, medium: /^medium$/i, high: /^high$/i };
const EFFORT_CHIP = `Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).find((b) => { const t=(b.textContent||'').replace(/\\s+/g,' ').trim(); return /^(instant|instant 5\\.5|low|medium|high)$/i.test(t) && t.length < 20; })`;
export async function selectEffortTier(page, tier = 'low') {
  const want = TIER_TO_OPTION[String(tier).toLowerCase()];
  const readChip = () => page.evaluate(`(() => { const el = ${EFFORT_CHIP}; return el ? el.textContent.replace(/\\s+/g,' ').trim() : null; })()`).catch(() => null);
  try {
    // Poll for the chip to render (it lags the composer by ~1s).
    let ready = false;
    for (let i = 0; i < 24 && !ready; i++) { if (await readChip()) ready = true; else await page.waitForTimeout(500); }
    if (!ready) return null;
    const before = await readChip();
    if (!want) return before; // unknown tier → leave as-is, report what it is
    if (before && want.test(before)) return before; // already on the wanted level
    const chip = (await page.evaluateHandle(`(() => ${EFFORT_CHIP})()`)).asElement();
    if (!chip) return before;
    await chip.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1000);
    // Options render as Radix items (NOT role=menuitem) — locate by own-text, click by geometry.
    const opts = await page.evaluate(() => {
      const scope = document.querySelector('[data-radix-menu-content],[role="menu"]') || document.body;
      const seen = new Map();
      for (const e of Array.from(scope.querySelectorAll('*'))) {
        const own = Array.from(e.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').replace(/\s+/g, ' ').trim();
        if (/^(instant 5\.5|instant|medium|high)$/i.test(own)) { const r = e.getBoundingClientRect(); if (r.width > 0 && !seen.has(own)) seen.set(own, { text: own, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) }); }
      }
      return [...seen.values()];
    }).catch(() => []);
    const pick = opts.find((o) => want.test(o.text));
    if (pick) { await page.mouse.click(pick.cx, pick.cy).catch(() => {}); await page.waitForTimeout(900); }
    else await page.keyboard.press('Escape').catch(() => {});
    return (await readChip()) || before;
  } catch { return null; }
}
async function typeAndSend(page, prompt, sel) {
  // state:'visible' skips ChatGPT's HIDDEN <textarea> and lands on the visible contenteditable
  // composer (#prompt-textarea is a ProseMirror <div> in the 2026 UI).
  const el = await page.waitForSelector(sel, { state: 'visible', timeout: 20000 }).catch(() => null);
  if (!el) return false;
  await el.click().catch(() => {});
  await el.type(prompt, { delay: 15 }).catch(async () => { await page.keyboard.type(prompt, { delay: 15 }); });
  await page.keyboard.press('Enter');
  // Fallback: Enter in a ProseMirror div sometimes inserts a newline instead of sending — if the
  // composer still holds the text, click the send button.
  await page.waitForTimeout(900);
  const stillText = await el.textContent().catch(() => '');
  if (stillText && stillText.trim().length > 3) {
    const sendBtn = await page.$('[data-testid="send-button"], button[aria-label*="Send" i]').catch(() => null);
    if (sendBtn) await sendBtn.click().catch(() => {});
  }
  return true;
}

// A ChatGPT reasoning answer streams in two phases: (1) a live SEARCH TRACE ("Searched X",
// "Searching www.Y") — that's the fan-out + sources — then (2) the collapsed "Worked for Ns" + the
// final RANKED answer. We must wait past the ~50s search phase for the final answer, while harvesting
// the trace lines as they appear (they vanish on collapse). Returns { answer, searchTrace }.
const TRACE_RE = /(?:^|\n)\s*(Searched|Searching|Reading|Evaluated|Browsing|Looking)\b([^\n]{2,130})/gi;
// The last visible line being a search action ("Searching X" / "Reading Y") means ChatGPT is still
// mid-fan-out — the real answer hasn't streamed yet. Accepting here captures a preamble, not an answer.
const MID_SEARCH_TAIL = /\b(searching|searched|reading|browsing|looking|evaluated)\b[^\n]{0,80}$/i;

async function waitForAnswer(page, maxMs = 150000, minMs = 8000) {
  const start = Date.now();
  let last = '', stable = 0; const trace = new Set(); const links = new Set();
  while (Date.now() - start < maxMs) {
    await page.waitForTimeout(4000);
    const snap = await page.evaluate(() => {
      const turns = [...document.querySelectorAll('[data-testid^="conversation-turn"]')];
      const lastTurn = turns.length ? turns[turns.length - 1] : null;
      // ChatGPT shows a Stop control WHILE streaming; it flips back to Send when generation is done.
      const streaming = !!document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop" i]');
      const hrefs = lastTurn ? [...lastTurn.querySelectorAll('a[href^="http"]')].map((a) => a.href) : [];
      return { count: turns.length, txt: lastTurn ? (lastTurn.innerText || '') : '', streaming, hrefs };
    }).catch(() => ({ count: 0, txt: '', streaming: false, hrefs: [] }));
    if (snap.count < 2) continue; // assistant turn not rendered yet
    for (const m of snap.txt.matchAll(TRACE_RE)) trace.add((m[1] + m[2]).replace(/\s+/g, ' ').trim());
    for (const h of snap.hrefs) links.add(h); // the answer's REAL citation chips (clean, not trace noise)
    const clean = snap.txt.replace(/^worked for [^\n]*\n?/i, '').trim();
    const elapsed = Date.now() - start;
    const midSearch = MID_SEARCH_TAIL.test(clean);
    // Freshest REAL answer text (post-trace-collapse): not mid-search, substantial. On timeout we
    // return this — never the mid-search preamble, which is shorter and ends in "Searching …".
    if (!midSearch && clean.length > 120) last = clean;
    // Accept as final only once: past the (tier-aware) floor, NOT streaming, NOT mid-search, stable.
    // Instant/low answers finish in ~10s (no search); high answers stream a ~50s search first — the
    // streaming/mid-search guards handle high regardless, so the floor can be small for low.
    const looksComplete = !snap.streaming && !midSearch && clean.length > 200;
    if (elapsed > minMs && looksComplete && clean === last) { stable += 1; if (stable >= 2) return { answer: clean, searchTrace: [...trace], answerLinks: [...links] }; }
    else stable = 0;
  }
  return { answer: last, searchTrace: [...trace], answerLinks: [...links] };
}

/** Drive ONE engine for ONE prompt and capture its fan-out. Browser deps are optional.
 *  On SEO_BOT_CDP_ENDPOINT we attach to the PERSISTENT context (the logged-in ChatGPT session),
 *  so the authenticated /backend-api/conversation fan-out + citations are actually readable.
 *  `beforeSend(page)` is an optional hook (e.g. select the reasoning tier); it returns the model
 *  label actually used, recorded on the row for an honest per-tier atlas. */
export async function captureFanout(prompt, { engine = 'chatgpt', timeoutMs = 45000, headful = false, settleMs = 8000, beforeSend = null, minAnswerMs = 8000 } = {}) {
  const L = await launchBrowser({ headless: !headful, stealth: true });
  if (L.status) return { status: L.status, prompt, engine, subqueries: [] };
  const browser = L.browser;
  let page = null;
  try {
    const context = L.cdp
      ? (browser.contexts()[0] || await browser.newContext({ viewport: { width: 1366, height: 900 } })) // logged-in session
      : await browser.newContext({ viewport: { width: 1366, height: 900 } });
    page = await context.newPage();
    return await captureOnPage(page, { engine, prompt, timeoutMs, settleMs, beforeSend, minAnswerMs });
  } finally {
    try { if (page) await page.close().catch(() => {}); } catch { /* */ }
    // On CDP, browser.close() only DISCONNECTS — the persistent logged-in Chrome keeps running.
    await browser.close().catch(() => {});
  }
}

/** Capture MANY prompts concurrently across multiple tabs in ONE browser/context — the fast path for
 *  the logged-in ChatGPT CDP session (authenticated tabs share cookies; the only real ceiling is the
 *  account message cap, which the CALLER/governor enforces). `concurrency` caps simultaneous tabs.
 *  specs: [{ prompt, engine?, beforeSend?, ...meta }]. onResult(rec, spec, i) fires as each finishes
 *  (stream results to disk). Returns recs in spec order; a tab that throws yields status:'error'. */
export async function captureFanoutBatch(specs = [], { concurrency = 3, headful = false, timeoutMs = 45000, settleMs = 8000, beforeSend = null, onResult = null, minAnswerMs = 8000, shouldStop = null } = {}) {
  if (!specs.length) return [];
  const L = await launchBrowser({ headless: !headful, stealth: true });
  if (L.status) return specs.map((s) => ({ status: L.status, prompt: s.prompt, engine: s.engine || 'chatgpt', subqueries: [] }));
  const browser = L.browser;
  const results = new Array(specs.length);
  try {
    const context = L.cdp
      ? (browser.contexts()[0] || await browser.newContext({ viewport: { width: 1366, height: 900 } }))
      : await browser.newContext({ viewport: { width: 1366, height: 900 } });
    let next = 0;
    const worker = async () => {
      for (;;) {
        if (shouldStop && shouldStop()) break; // circuit breaker — caller aborted (rate-limit / error storm)
        const i = next++; if (i >= specs.length) break;
        const spec = specs[i];
        let page = null;
        try {
          page = await context.newPage();
          results[i] = await captureOnPage(page, { engine: spec.engine || 'chatgpt', prompt: spec.prompt, timeoutMs, settleMs, beforeSend: spec.beforeSend || beforeSend, minAnswerMs: spec.minAnswerMs || minAnswerMs });
        } catch (e) {
          results[i] = { status: 'error', prompt: spec.prompt, engine: spec.engine || 'chatgpt', subqueries: [], error: String((e && e.message) || e) };
        } finally {
          try { if (page) await page.close().catch(() => {}); } catch { /* */ }
        }
        try { if (onResult) await onResult(results[i], spec, i); } catch { /* persistence is best-effort */ }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, specs.length)) }, () => worker()));
    return results;
  } finally {
    await browser.close().catch(() => {}); // CDP: disconnect only — the logged-in Chrome keeps running
  }
}

/** Per-PAGE capture core — everything EXCEPT browser/context/page lifecycle, so it can run in one tab
 *  (captureFanout) or many concurrent tabs (captureFanoutBatch). The page must already exist; the
 *  caller owns closing it. Network taps + CDP session are per-page, so concurrent tabs never cross-talk. */
async function captureOnPage(page, { engine = 'chatgpt', prompt, timeoutMs = 45000, settleMs = 8000, beforeSend = null, minAnswerMs = 8000 }) {
  const net = [];
  const bodyPromises = [];
  page.on('request', r => { try { if (SEARCH_HINTS.some(h => h.test(r.url()))) net.push({ url: r.url(), postData: r.postData() || '' }); } catch { /* */ } });
  page.on('response', r => { try { if (SEARCH_HINTS.some(h => h.test(r.url()))) { const p = r.text().catch(() => '').then(body => { if (body) net.push({ url: r.url(), body }); }); bodyPromises.push(p); } } catch { /* */ } });
  // ChatGPT (2026) streams the conversation with fetch + ReadableStream (NOT EventSource), so
  // response.text() only sees a partial buffer. Tap the FULL streamed body via CDP: remember the
  // conversation request ids, then Network.getResponseBody on loadingFinished — that payload
  // carries search_model_queries + content_references. (eventSourceMessageReceived kept as a belt-
  // and-suspenders for any engine that does use real SSE.)
  const cdpBodyPromises = [];
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const convReqIds = new Set();
    cdp.on('Network.responseReceived', (e) => { try { if (/backend-api\/(f\/)?conversation|\/search/.test(e.response?.url || '')) convReqIds.add(e.requestId); } catch { /* */ } });
    cdp.on('Network.loadingFinished', (e) => {
      if (!convReqIds.has(e.requestId)) return;
      cdpBodyPromises.push(cdp.send('Network.getResponseBody', { requestId: e.requestId })
        .then((res) => { if (res?.body) net.push({ url: 'cdp', body: res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body }); })
        .catch(() => {}));
    });
    cdp.on('Network.eventSourceMessageReceived', (e) => { try { if (e && e.data) net.push({ url: 'sse', body: e.data }); } catch { /* */ } });
  } catch { /* CDP tap is optional — the response/DOM fallbacks still run */ }

  const target = engine.startsWith('chatgpt')
    ? 'https://chatgpt.com/?temporary-chat=true'
    : 'https://www.perplexity.ai/';
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  if (await looksBlocked(page)) return { status: 'blocked', prompt, engine, subqueries: [] };
  let modelUsed = null;
  if (beforeSend) { try { modelUsed = await beforeSend(page); } catch { /* tier/model select is best-effort */ } }
  const sent = await typeAndSend(page, prompt, engine === 'perplexity' ? 'textarea' : '#prompt-textarea');
  if (!sent) return { status: 'no-input', prompt, engine, subqueries: [] };

  // ChatGPT: WAIT for generation to finish (searches take ~50s), harvesting the search trace.
  let answer = '', searchTrace = [], answerLinks = [];
  if (engine.startsWith('chatgpt')) { const w = await waitForAnswer(page, 150000, minAnswerMs); answer = w.answer; searchTrace = w.searchTrace; answerLinks = w.answerLinks || []; }
  else await page.waitForTimeout(settleMs);
  await Promise.allSettled(bodyPromises);    // drain response.text() reads
  await Promise.allSettled(cdpBodyPromises); // drain the CDP full-body fetches (the streamed conversation)

  let subs = extractFromNetwork(net);
  if (engine === 'perplexity') {
    const lines = await page.evaluate(
      () => Array.from(document.querySelectorAll('[class*="search" i] *, [data-testid*="search" i]'))
        .map(n => n.textContent || '')
    ).catch(() => []);
    subs = dedupe([...subs, ...extractFromDom(lines)]);
  }
  // ChatGPT reasoning trace: "Searched <query>" lines ARE the fan-out; "Searching www.X" (and bare
  // "nypost.com") are sources. splitTrace keeps queries clean and routes every domain to citations.
  const { queries: traceQueries, domains: traceDomains } = splitTrace(searchTrace);
  subs = dedupe([...subs, ...traceQueries]);
  const cites = extractCitationsFromNetwork(net);
  // Prefer the answer's REAL citation chips (<a href> in the final turn) — they're what ChatGPT
  // actually cited. The search trace also lists sites it merely *explored* ("Searching arxiv.org")
  // and never cited; use those only as a fallback when no chips rendered.
  const SELF_HOSTS = /(^|\.)(chatgpt\.com|openai\.com|oaiusercontent\.com|bing\.com|google\.com)$/i;
  const linkDomains = answerLinks
    .map((u) => { try { const h = new URL(u).hostname.replace(/^www\./, ''); return SELF_HOSTS.test(h) ? '' : 'https://' + h; } catch { return ''; } })
    .filter(Boolean);
  const chipCites = dedupe([...(cites.urls || []), ...linkDomains]);
  const citeUrls = chipCites.length ? chipCites : dedupe(traceDomains);
  const ranked = engine.startsWith('chatgpt') ? parseRankedAnswer(answer) : [];
  const sturm = extractSturm(net); // Edward-Sturm SOURCE-LEVEL pull from the conversation JSON
  // ok when we got a real answer (ChatGPT) or real sub-queries (Perplexity) — never a false empty.
  const ok = engine.startsWith('chatgpt') ? answer.length > 40 : subs.length > 0;
  const rec = {
    status: ok ? 'ok' : 'empty', prompt, engine, model: modelUsed,
    subqueries: subs, ranked,
    answer: answer.slice(0, 16000), answerExcerpt: answer.slice(0, 280),
    searchTrace,               // the live "Searched/Searching X" trace lines, verbatim (fan-out + sources)
    sturm,                     // source-level: { searchModelQueries, contentReferences:[{url,title}], safeUrls }
    fetchedUrls: answerLinks,  // every URL the final answer linked (the sites it actually fetched)
    capturedAt: new Date().toISOString(),
  };
  if (citeUrls.length) rec.citations = { urls: citeUrls, results: cites.results || [] }; // fan-out → cited-source join
  return rec;
}

/**
 * BRAND-IN-FANOUT visibility — the new KPI from the Seer/ChatGPT-5.5 finding: fan-out
 * sub-queries increasingly contain BRAND NAMES; a brand inside the fan-out is "not in the
 * result — it IS the result" (the model hardwired it as synonymous with the topic).
 * HONESTY GUARD: fan-outs are wildly non-deterministic run to run (Seer measured ~0.1%
 * overlap across Gemini-3 runs) — a single capture is an anecdote, so below minRuns this
 * returns status 'insufficient-runs' and NO shares (never a false hardwiring signal).
 * PURE: captures = [{status, subqueries[]}], brand/competitors resolved from cfg.
 */
export function brandFanoutVisibility(captures = [], cfg = {}, { minRuns = 5 } = {}) {
  const ok = (captures || []).filter((c) => c && c.status === 'ok' && Array.isArray(c.subqueries));
  const brandTokens = [cfg.brand, ...(cfg.brandAliases || [])].filter((s) => typeof s === 'string' && s.trim().length >= 3).map((s) => s.toLowerCase());
  const compTokens = (cfg.competitors || []).map((c) => (typeof c === 'string' ? c : c?.name) || '').filter((s) => s.trim().length >= 5).map((s) => s.toLowerCase());
  if (ok.length < minRuns) return { status: 'insufficient-runs', runs: ok.length, minRuns, note: `fan-outs are ~non-deterministic run to run (Seer: ~0.1% overlap) — need ≥${minRuns} usable captures before claiming a hardwiring signal` };
  let brandRuns = 0, compRuns = 0;
  const compHits = new Map();
  for (const c of ok) {
    const subs = c.subqueries.map((s) => (s || '').toLowerCase());
    if (brandTokens.length && subs.some((s) => brandTokens.some((b) => s.includes(b)))) brandRuns++;
    for (const t of compTokens) if (subs.some((s) => s.includes(t))) { compRuns++; compHits.set(t, (compHits.get(t) || 0) + 1); break; }
  }
  return {
    status: 'ok', runs: ok.length,
    brandShare: brandTokens.length ? brandRuns / ok.length : null, // null = no brand configured, not zero
    competitorShare: compTokens.length ? compRuns / ok.length : null,
    hardwiredCompetitors: [...compHits.entries()].filter(([, n]) => n / ok.length >= 0.5).map(([name, n]) => ({ name, share: n / ok.length })),
  };
}

/** Capture fan-out for a whole prompt panel across engines; skips blocked rows (fail-closed). */
export async function capturePanel(prompts = [], { engines = ['chatgpt', 'perplexity'], ...opts } = {}) {
  const rows = [];
  for (const prompt of prompts) for (const engine of engines) {
    const r = await captureFanout(prompt, { engine, ...opts });
    rows.push(r);
  }
  return { capturedAt: new Date().toISOString(), rows, usable: rows.filter(r => r.status === 'ok') };
}
