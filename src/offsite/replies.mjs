// seo-bot · offsite/replies — DRAFT review replies for a HUMAN to post. The bot never
// posts a reply anywhere; it drafts, compliance-checks, and queues each reply as one
// worksheet row (action=paste). Hard compliance gate (deterministic, always-on):
//   • no incentives language (discounts/free/gift for reviews) — FTC 16 CFR 465
//   • no sentiment-gating / review-solicitation language (asking for stars, asking to
//     change/remove a review, diverting only unhappy reviewers away from public review)
//   • no patient-hood / treatment confirmation (HIPAA: a reply must not confirm the
//     reviewer was a patient or name their treatment)
// Fail closed: empty/unparseable text or a gate hit → the draft is REJECTED (never
// emitted as postable). LLM drafting is deliberately NOT used — templates are
// deterministic, so this path can never fail open on a model outage.
//
// Evidence/source: research/medspa-seo-framework.md + memory medspa-aeo-vertical-playbook
// (FTC/HIPAA gates); src/listings/targets.mjs compliance note.

// --- banned-language patterns (each { re, why }) ---
export const REPLY_BANNED = [
  { re: /\b(discount|coupon|% ?off|percent off|free (session|treatment|unit|gift)|gift ?card|refund|credit toward|on your next visit|comp(?:limentary)? (?:session|treatment))\b/i, why: 'incentive language (FTC 16 CFR 465 — no compensation tied to reviews)' },
  { re: /\b(leave (us )?a|give (us )?a|post a|write a|drop a) ?(5[- ]?star|five[- ]?star|review|rating)\b/i, why: 'review solicitation in a reply (never automate solicitation)' },
  { re: /\b(change|update|edit|remove|delete|take down) (your|the) (review|rating|star)/i, why: 'asking to alter/remove a review (gating/manipulation)' },
  { re: /\bif you (enjoyed|loved|had a (great|good) (visit|experience)).{0,40}review\b/i, why: 'sentiment-gating (only-happy-people-review funnels are gated solicitation)' },
  { re: /\byour (botox|filler|laser|morpheus8|hydrafacial|glp-?1|semaglutide|tirzepatide|weight[- ]loss|injection|procedure|treatment|appointment) (?:on|with|at|session|results?)\b/i, why: 'confirms patient-hood / names a treatment (HIPAA — replies must not reveal PHI)' },
  { re: /\b(as your (provider|nurse|doctor)|when you (came|visited) (in|us))\b/i, why: 'confirms the reviewer was a patient (HIPAA)' },
];

/**
 * Gate a reply draft. Fail closed: empty/non-string → not ok.
 * @returns { ok, violations: [{ why, match }] }
 */
export function checkReplyCompliance(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, violations: [{ why: 'empty/unparseable draft — fail closed', match: null }] };
  const violations = [];
  for (const { re, why } of REPLY_BANNED) {
    const m = text.match(re);
    if (m) violations.push({ why, match: m[0] });
  }
  return { ok: violations.length === 0, violations };
}

const first = (s = '') => String(s).trim().split(/\s+/)[0] || 'there';

/** Deterministic reply templates by star band. No treatment names, no patient-hood confirmation. */
export function draftReply(review, cfg) {
  const stars = Number(review?.stars === 'FIVE' ? 5 : review?.stars === 'FOUR' ? 4 : review?.stars === 'THREE' ? 3 : review?.stars === 'TWO' ? 2 : review?.stars === 'ONE' ? 1 : review?.stars);
  const name = first(review?.reviewer);
  const brand = cfg?.brand || 'our team';
  const phone = cfg?.listings?.canonicalNap?.phone || '';
  if (!Number.isFinite(stars)) return { text: null, rejected: true, reason: 'unparseable star rating — fail closed (no generic reply)' };
  if (stars >= 4) return { text: `Thank you, ${name} — we really appreciate you taking the time to share this. The whole team at ${brand} works hard to make every visit a great one, and feedback like yours means a lot.`, band: 'positive' };
  if (stars === 3) return { text: `Thank you for the honest feedback, ${name}. We take every comment seriously and would like to learn more about what we could have done better${phone ? ` — please call us at ${phone}` : ' — please contact us directly'} so we can make it right.`, band: 'neutral' };
  return { text: `${name}, we're sorry to hear this fell short of what you expected. We'd like the chance to understand what happened and make it right${phone ? ` — please call us directly at ${phone}` : ' — please reach out to us directly'} and ask for the manager.`, band: 'negative' };
}

/**
 * Draft + gate replies for unanswered reviews. Every draft is compliance-checked;
 * a gate hit → status 'REJECTED-COMPLIANCE' with the violation (never postable).
 * Output rows are worksheet-ready (action=paste; the HUMAN posts them).
 */
export function draftReviewReplies(reviews = [], cfg = {}) {
  const rows = [];
  for (const rv of reviews) {
    if (rv?.replied) continue;
    const d = draftReply(rv, cfg);
    if (d.rejected || !d.text) { rows.push({ reviewer: rv?.reviewer || '?', stars: rv?.stars ?? null, status: 'REJECTED-COMPLIANCE', violations: [{ why: d.reason || 'no draft produced' }], draft: null }); continue; }
    const gate = checkReplyCompliance(d.text);
    rows.push(gate.ok
      ? { reviewer: rv?.reviewer || '?', stars: rv?.stars ?? null, status: 'DRAFTED', band: d.band, draft: d.text, gate: { checked: true, ok: true } }
      : { reviewer: rv?.reviewer || '?', stars: rv?.stars ?? null, status: 'REJECTED-COMPLIANCE', violations: gate.violations, draft: null });
  }
  return { rows, drafted: rows.filter((r) => r.status === 'DRAFTED').length, rejected: rows.filter((r) => r.status === 'REJECTED-COMPLIANCE').length };
}
