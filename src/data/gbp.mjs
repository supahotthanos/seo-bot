// seo-bot · data/gbp — Google Business Profile deeper (uses the business.manage scope the
// OAuth connect already grants). Pulls Performance metrics (calls, website clicks,
// bookings, direction requests — conversion-proximate signals GA4/GSC lack) and reviews
// (read + draft-reply scaffold). NB: new GCP projects have GBP quota 0 until Google
// approves the manual access-request form — so accounts.list 429s even though OAuth
// "works". We surface that explicitly. FTC guardrail: never sentiment-gate review
// requests (16 CFR 465); AI-drafted replies are human-approve only.

import { getAccessToken } from '../connect/google.mjs';

const ACCT = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const REVIEWS = (acc, loc) => `https://mybusiness.googleapis.com/v4/${acc}/${loc}/reviews`;

async function gbpGet(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

/** Probe: are we connected AND has Google granted GBP API quota? */
export async function gbpStatus(cfg, { log = () => {} } = {}) {
  const token = await getAccessToken(cfg.name);
  if (!token) return { enabled: false, note: 'not connected — run `connect ' + cfg.name + '` (needs business.manage scope)' };
  const { ok, status, j } = await gbpGet(token, ACCT);
  if (status === 429 || /quota/i.test(j.error?.message || '')) return { enabled: false, quotaZero: true, note: 'GBP API quota 0 — submit Google\'s Business Profile API access-request form (one-time per project).' };
  if (!ok) return { enabled: false, note: j.error?.message || `status ${status}` };
  log(`  GBP: ${(j.accounts || []).length} account(s) accessible.`);
  return { enabled: true, accounts: (j.accounts || []).map((a) => ({ name: a.name, accountName: a.accountName, type: a.type })) };
}

export async function gbpReviews(cfg, { account = null, location = null, log = () => {} } = {}) {
  const token = await getAccessToken(cfg.name);
  if (!token) return { enabled: false, note: 'not connected' };
  const acc = account || cfg.gbp?.account, loc = location || cfg.gbp?.location;
  if (!acc || !loc) return { enabled: false, note: 'set cfg.gbp.account + cfg.gbp.location (run gbp status to list)' };
  const { ok, status, j } = await gbpGet(token, REVIEWS(acc, loc));
  if (!ok) return { enabled: false, note: j.error?.message || `status ${status}`, quotaZero: status === 429 };
  const reviews = (j.reviews || []).map((rv) => ({ reviewer: rv.reviewer?.displayName, stars: rv.starRating, comment: rv.comment, time: rv.createTime, replied: !!rv.reviewReply, name: rv.name }));
  const unanswered = reviews.filter((r) => !r.replied);
  log(`  GBP reviews: ${reviews.length} · ${unanswered.length} unanswered · avg ${j.averageRating ?? '?'}`);
  return { enabled: true, total: j.totalReviewCount ?? reviews.length, averageRating: j.averageRating, reviews, unanswered };
}
