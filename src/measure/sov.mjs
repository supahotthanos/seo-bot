// seo-bot · measure/sov — turn raw AI-answer captures (from measure.mjs → track.mjs on
// the Mac) into the real KPIs: per-engine Visibility, Share-of-Voice, Average Position,
// and the two-axis mention-vs-citation split, each with a bootstrap CI and a noise-floor
// suppression so a single noisy run is never reported as signal.
//
// Why these four:
//   • Visibility   = answers that mention us / answers that engine produced.   (are we in the room?)
//   • Share-of-Voice = our mentions / (our + competitors' mentions).            (how much of the room is us?)
//   • Avg Position = mean rank of our brand among brands named in the answer.   (are we named first or last?)
//   • Mention-vs-Citation = being *recommended* (named) ≠ being *cited* (linked). Track BOTH axes;
//     "mentioned but never cited" and "cited but never recommended" are different work orders.
//
// Sampling: AI answers are non-deterministic (~5-7pp run-to-run noise). We aggregate the R
// repeats a capture already contains per (prompt, engine) and bootstrap a CI (reusing
// stats/significance.mjs). Readings whose CI half-width exceeds the engine noise floor are
// flagged belowNoiseFloor so the report can suppress them.
//
// Pure functions. No scraping, no API. Consumes the capture object produced on the Mac.

import { bootstrapCI, wilsonCI } from '../stats/significance.mjs';
import { ENGINE_SAMPLE_TARGETS } from './prompts.mjs';
import { hostOf } from '../util.mjs';

/** A capture result row is { engine, prompt, mentioned, position, cited, citedDomains,
 *  competitorsMentioned, note?, error? }. A non-answer (note set, e.g. "No AI Overview")
 *  is excluded from denominators — it is "engine didn't answer," not "we lost." */
const isAnswer = (r) => r && !r.error && !r.note;

/** Fixed-rubric sentiment label for a mention. Heuristic by default; pass an llmLabeler to
 *  upgrade. Rubric is intentionally coarse + auditable: positive / neutral / negative. */
const POS = /\b(best|top|excellent|highly rated|recommended|trusted|leading|great|popular|reputable|award|five[- ]star|loved)\b/i;
const NEG = /\b(avoid|worst|bad|complaint|scam|lawsuit|warning|poor|disappointing|overpriced|unsafe|risky)\b/i;
export function sentimentLabel(text, { llmLabeler = null } = {}) {
  const t = String(text || '');
  if (llmLabeler) { try { const l = llmLabeler(t); if (l) return l; } catch { /* fall through to rubric */ } }
  const pos = POS.test(t), neg = NEG.test(t);
  if (pos && !neg) return 'positive';
  if (neg && !pos) return 'negative';
  return 'neutral';
}

/** Mean of 0/1 flags with a bootstrap CI; falls back to a Wilson CI for tiny n. */
function rateWithCI(flags, { reps = 2000 } = {}) {
  const n = flags.length;
  if (!n) return { rate: 0, lo: 0, hi: 0, n: 0 };
  const successes = flags.reduce((a, b) => a + (b ? 1 : 0), 0);
  if (n < 10) { const [lo, hi] = wilsonCI(successes, n); return { rate: successes / n, lo, hi, n }; }
  const b = bootstrapCI(flags.map((f) => (f ? 1 : 0)), { reps });
  return { rate: b.mean, lo: b.lo, hi: b.hi, n };
}

/** Half-width of a CI in percentage points (the precision of the reading). */
const halfWidthPct = (ci) => Math.round(((ci.hi - ci.lo) / 2) * 1000) / 10;

/**
 * Compute per-engine SOV metrics from a capture.
 *
 * @param {object|object[]} captures a single capture { results, ... } or an array of them
 *        (e.g. R repeats run on the Mac). Their `results` rows are pooled per engine.
 * @param {object} o
 * @param {object} o.cfg loaded client config (brand, competitors, domain)
 * @param {function} [o.llmLabeler] optional (text)=>'positive'|'neutral'|'negative'
 * @returns {{ client, brand, ranAt, engines, overall }} per-engine + overall metrics with CIs
 */
export function computeSov(captures, { cfg, llmLabeler = null, log = () => {} } = {}) {
  const list = Array.isArray(captures) ? captures : [captures];
  const results = list.flatMap((c) => (c?.results || []).map((r) => ({ ...r })));
  const ranAt = list.map((c) => c?.ranAt).filter(Boolean).sort().pop() || new Date().toISOString();
  const domain = (cfg.domain || '').replace(/^www\./, '');

  // group rows by engine
  const byEngine = new Map();
  for (const r of results) { if (!r?.engine) continue; if (!byEngine.has(r.engine)) byEngine.set(r.engine, []); byEngine.get(r.engine).push(r); }

  const engines = {};
  for (const [engine, rows] of byEngine) {
    const answers = rows.filter(isAnswer);
    const floor = (ENGINE_SAMPLE_TARGETS[engine] || ENGINE_SAMPLE_TARGETS.default).noiseFloorPct;

    // Visibility = mentioned / answered — exclude rows where mentioned is not a boolean
    // (malformed/partial captures have mentioned:undefined, which would silently count as 0
    // and dilute the denominator; they are not real "not mentioned" observations).
    const visRows = answers.filter((r) => typeof r.mentioned === 'boolean');
    const vis = rateWithCI(visRows.map((r) => r.mentioned));
    // Citation rate = cited / answered (the OTHER axis). Same boolean-guard.
    const citeRows = answers.filter((r) => typeof r.cited === 'boolean');
    const cite = rateWithCI(citeRows.map((r) => r.cited));

    // Share-of-Voice = our mentions / (our mentions + competitor mentions), pooled across answers.
    let ourMentions = 0, compMentions = 0;
    for (const r of answers) {
      if (r.mentioned) ourMentions++;
      compMentions += (r.competitorsMentioned || []).length;
    }
    const sovDenom = ourMentions + compMentions;
    const sovFlags = []; // 1 if a given "mention slot" is ours — per answer, one flag per named brand
    for (const r of answers) {
      if (r.mentioned) sovFlags.push(1);
      for (let i = 0; i < (r.competitorsMentioned || []).length; i++) sovFlags.push(0);
    }
    const sov = rateWithCI(sovFlags);

    // Average Position among named brands (only answers where we appear with a rank).
    const positions = answers.filter((r) => r.mentioned && r.position).map((r) => r.position);
    const avgPosition = positions.length ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null;

    // WHERE in the answer (answer-position.mjs fields on newer captures). Additive +
    // back-compat: old rows without the fields contribute nothing (Number.isFinite guard),
    // so a pre-upgrade capture yields { avg: null, n: 0 } and no reader breaks.
    const apRows = answers.filter((r) => Number.isFinite(r.answerPosition));
    const ratioRows = answers.filter((r) => typeof r.firstMentionCharRatio === 'number' && Number.isFinite(r.firstMentionCharRatio));
    const answerPosition = {
      avg: apRows.length ? round1(apRows.reduce((a, r) => a + r.answerPosition, 0) / apRows.length) : null,
      n: apRows.length,
      avgFirstMentionRatio: ratioRows.length ? Math.round((ratioRows.reduce((a, r) => a + r.firstMentionCharRatio, 0) / ratioRows.length) * 1000) / 1000 : null,
    };

    // mention-vs-citation split: four quadrants over answered prompts.
    const split = { recommendedAndCited: 0, recommendedNotCited: 0, citedNotRecommended: 0, neither: 0 };
    for (const r of answers) {
      if (r.mentioned && r.cited) split.recommendedAndCited++;
      else if (r.mentioned && !r.cited) split.recommendedNotCited++;
      else if (!r.mentioned && r.cited) split.citedNotRecommended++;
      else split.neither++;
    }

    // Sentiment of our mentions (rubric over the answer excerpt).
    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    for (const r of answers) {
      if (!r.mentioned) continue;
      sentiment[sentimentLabel(r.answerExcerpt || '', { llmLabeler })]++;
    }

    const vHalf = halfWidthPct(vis);
    const cHalf = halfWidthPct(cite);
    // A thin sample must always be flagged even if CI arithmetic happens to be narrow
    // (e.g. all 0s gives a tight Wilson CI that looks precise but is meaningless).
    // Use the effective sample sizes (boolean-valued rows) for the threshold check so
    // that a batch of malformed rows does not mask a thin real sample.
    const thinSample = visRows.length < 5 || citeRows.length < 5;
    const belowNoiseFloor = thinSample || vHalf > floor || cHalf > floor;
    engines[engine] = {
      answered: answers.length,
      prompts: rows.length,
      noiseFloorPct: floor,
      sampleTarget: (ENGINE_SAMPLE_TARGETS[engine] || ENGINE_SAMPLE_TARGETS.default).samples,
      visibility: { pct: round1(vis.rate * 100), ci: [round1(vis.lo * 100), round1(vis.hi * 100)], halfWidthPct: vHalf, n: visRows.length },
      shareOfVoice: { pct: round1(sov.rate * 100), ci: [round1(sov.lo * 100), round1(sov.hi * 100)], ourMentions, competitorMentions: compMentions, denom: sovDenom },
      citationRate: { pct: round1(cite.rate * 100), ci: [round1(cite.lo * 100), round1(cite.hi * 100)], halfWidthPct: cHalf, n: citeRows.length },
      avgPosition,
      answerPosition,
      mentionVsCitation: split,
      sentiment,
      // Suppress as signal when: sample is thin (< 5 boolean rows on either axis), OR
      // visibility CI half-width exceeds the engine noise floor, OR citation CI does too.
      belowNoiseFloor,
    };
    if (belowNoiseFloor) log(`  sov: ${engine} below noise floor (nVis=${visRows.length}, nCite=${citeRows.length}, ±${vHalf}pp vis / ±${cHalf}pp cite, floor=${floor}pp) — reading suppressed as signal.`);
  }

  // overall (pooled across engines, for the one-number rollup)
  const allAnswers = results.filter(isAnswer);
  const overallVisRows = allAnswers.filter((r) => typeof r.mentioned === 'boolean');
  const overallVis = rateWithCI(overallVisRows.map((r) => r.mentioned));
  const overallCiteRows = allAnswers.filter((r) => typeof r.cited === 'boolean');
  const overallCite = rateWithCI(overallCiteRows.map((r) => r.cited));
  const overall = {
    answered: allAnswers.length,
    visibilityPct: round1(overallVis.rate * 100),
    citationRatePct: round1(overallCite.rate * 100),
    engines: [...byEngine.keys()],
    domain,
  };

  log(`  sov: ${overall.answered} answers across ${overall.engines.length} engines · visibility ${overall.visibilityPct}% · cited ${overall.citationRatePct}%`);
  return { client: cfg.name, brand: cfg.brand, domain, ranAt, engines, overall };
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Per-PROMPT × per-ENGINE ranking matrix for a client — the dashboard view of
 * "what prompts is this med spa ranking for, on which engines, and where it's NOT".
 * @param {object|object[]} captures same shape computeSov consumes (rows: {engine,prompt,mentioned,position,cited,status,note,error})
 * @returns {{engines:string[], prompts:Array<{prompt, byEngine, rankedOn, notRankedOn, blockedOn, citedOn}>}}
 */
export function promptMatrix(captures) {
  const list = Array.isArray(captures) ? captures : [captures];
  const rows = list.flatMap((c) => (c?.results || []));
  const engines = [...new Set(rows.map((r) => r && r.engine).filter(Boolean))].sort();
  const byPrompt = new Map();
  for (const r of rows) {
    if (!r || !r.prompt || !r.engine) continue;
    if (!byPrompt.has(r.prompt)) byPrompt.set(r.prompt, {});
    const status = r.status || (r.error ? 'error' : r.note ? 'absent' : 'answered');
    byPrompt.get(r.prompt)[r.engine] = {
      status,
      mentioned: r.mentioned === true,
      position: Number.isFinite(r.position) ? r.position : null,
      cited: r.cited === true,
      // WHERE in the answer (additive; null on pre-upgrade rows — no reader breaks)
      answerPosition: Number.isFinite(r.answerPosition) ? r.answerPosition : null,
      listSize: Number.isFinite(r.listSize) ? r.listSize : null,
    };
  }
  const prompts = [...byPrompt.entries()].map(([prompt, byEngine]) => ({
    prompt,
    byEngine,
    rankedOn: engines.filter((e) => byEngine[e] && byEngine[e].mentioned),
    notRankedOn: engines.filter((e) => byEngine[e] && !byEngine[e].mentioned && byEngine[e].status === 'answered'),
    blockedOn: engines.filter((e) => byEngine[e] && (byEngine[e].status === 'blocked' || byEngine[e].status === 'error')),
    citedOn: engines.filter((e) => byEngine[e] && byEngine[e].cited),
  }));
  return { engines, prompts };
}
