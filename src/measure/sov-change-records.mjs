// seo-bot · measure/sov-change-records — adapter that turns AI-visibility deltas into the
// change-record shape the statistics controller already speaks, so AEO progress is judged
// by the SAME significance machinery as on-page CTR (z-test + FDR + DiD + locked horizons).
//
// Two signals become before/after change records:
//   1. AI Share-of-Voice / Visibility — a proportion (our mentions ÷ answered prompts).
//      Maps onto { clicks→our-mentions, impressions→answered } so twoProportionZTest applies.
//   2. GA4 AI-referral conversions — { conversions ÷ sessions } from AI engines, used as the
//      GUARDRAIL KPI (a vanity SOV bump that doesn't move AI-referred bookings is not a win).
//
// The controller record shape (stats/controller.mjs):
//   { id, page, before:{clicks,impressions}, after:{clicks,impressions},
//     control?:{before,after}, days, guardrail?:{before:{conversions,sessions},after}, lockedHorizonDate? }
//
// Pure. Feed the resulting records straight into runController(client, records, …).

import { computeSov } from './sov.mjs';

/** Coerce an sov-engine block (or computeSov result) into {mentions, answered} counts.
 *
 * We use shareOfVoice.ourMentions (the raw integer stored by computeSov) rather than
 * round-tripping through the already-rounded visibility.pct percentage, which introduces
 * off-by-one drift: pct is stored to 1 decimal place so Math.round(pct/100 * answered)
 * can differ from the true count by ±1.  ourMentions is the exact integer source.
 */
export function countsFromSov(sovOrEngines, engine) {
  // Accept either a full computeSov() result or its `.engines` map.
  const engines = sovOrEngines?.engines || sovOrEngines;
  if (engine) {
    const e = engines?.[engine];
    if (!e) return { mentions: 0, answered: 0 };
    // Prefer the raw integer count; fall back to pct round-trip only when missing (legacy data).
    const mentions = (e.shareOfVoice?.ourMentions != null)
      ? e.shareOfVoice.ourMentions
      : Math.round((e.visibility.pct / 100) * e.answered);
    return { mentions, answered: e.answered };
  }
  // pooled across engines
  let mentions = 0, answered = 0;
  for (const e of Object.values(engines || {})) {
    answered += e.answered;
    mentions += (e.shareOfVoice?.ourMentions != null)
      ? e.shareOfVoice.ourMentions
      : Math.round((e.visibility.pct / 100) * e.answered);
  }
  return { mentions, answered };
}

/**
 * Build change-records comparing a BEFORE capture/sov to an AFTER capture/sov.
 *
 * @param {object} o
 * @param {object} o.cfg loaded client config
 * @param {object} o.before a prior capture (raw, from measure.mjs) OR a prior computeSov result
 * @param {object} o.after  the latest capture OR computeSov result
 * @param {object} [o.beforeGa4] prior ga4Report() result (for the AI-referral guardrail)
 * @param {object} [o.afterGa4]  latest ga4Report() result
 * @param {number} [o.days=28] elapsed days in the window (gates "enough data")
 * @param {string} [o.lockedHorizonDate] ISO date before which judgement is withheld (no peeking)
 * @param {boolean} [o.perEngine=false] emit one record per engine instead of one pooled record
 * @returns {Array<object>} change-records ready for runController()
 */
export function sovChangeRecords({ cfg, before, after, beforeGa4 = null, afterGa4 = null, days = 28, lockedHorizonDate = null, perEngine = false, log = () => {} } = {}) {
  // Normalize each side to a computeSov result (so callers can pass raw captures).
  const sovBefore = before?.engines ? before : computeSov(before, { cfg });
  const sovAfter = after?.engines ? after : computeSov(after, { cfg });

  // AI-referral conversion guardrail (pooled across AI engines), if GA4 supplied.
  const guardrail = ga4Guardrail(beforeGa4, afterGa4);

  const records = [];
  const engines = perEngine ? [...new Set([...Object.keys(sovBefore.engines || {}), ...Object.keys(sovAfter.engines || {})])] : [null];
  for (const engine of engines) {
    const b = countsFromSov(sovBefore, engine);
    const a = countsFromSov(sovAfter, engine);
    if (!a.answered && !b.answered) continue; // nothing measured
    records.push({
      id: `ai-sov-${cfg.name}-${engine || 'all'}`,
      page: engine ? `AI Share-of-Voice · ${engine}` : 'AI Share-of-Voice (all engines)',
      before: { clicks: b.mentions, impressions: b.answered },
      after: { clicks: a.mentions, impressions: a.answered },
      days,
      lockedHorizonDate,
      // SOV "win" must not tank AI-referred conversions → guardrail (only on the pooled record).
      ...(engine ? {} : (guardrail ? { guardrail } : {})),
      meta: { kind: 'ai-sov', engine: engine || 'all' },
    });
  }

  // A standalone AI-referral conversion change-record (the money axis), if GA4 supplied.
  if (guardrail) {
    records.push({
      id: `ai-referral-conv-${cfg.name}`,
      page: 'GA4 AI-referral conversions',
      before: { clicks: guardrail.before.conversions, impressions: guardrail.before.sessions },
      after: { clicks: guardrail.after.conversions, impressions: guardrail.after.sessions },
      days,
      lockedHorizonDate,
      meta: { kind: 'ai-referral-conversion' },
    });
  }

  log(`  sov-change-records: ${records.length} change-record(s) for the stats controller${guardrail ? ' (incl. GA4 AI-referral guardrail)' : ''}`);
  return records;
}

/** Pool GA4 AI-referral rows into a {conversions, sessions} guardrail before/after. */
function ga4Guardrail(beforeGa4, afterGa4) {
  if (!beforeGa4?.aiReferrals || !afterGa4?.aiReferrals) return null;
  const sum = (rows) => rows.reduce((m, r) => { m.sessions += r.sessions || 0; m.conversions += r.conversions || 0; return m; }, { sessions: 0, conversions: 0 });
  const before = sum(beforeGa4.aiReferrals);
  const after = sum(afterGa4.aiReferrals);
  if (!before.sessions && !after.sessions) return null;
  return { before, after };
}
