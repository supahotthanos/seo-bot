// seo-bot · measure/capture-governor — HARD safety rails so automated captures never get the
// residential IP banned. This is a POLITE-CITIZEN throttle, not an evasion tool.
//
// Two rules, both fail-safe:
//   1) NEVER exceed a small per-run query cap, with randomized human-paced delays between queries.
//   2) The instant an engine shows a human-verification / CAPTCHA / rate-limit challenge, HALT the
//      whole run and enter a cooldown. We NEVER attempt to solve or bypass a challenge — that would
//      be a ban-magnet AND against policy. We back off exactly like a careful human would.
//
// A CHALLENGE (stop everything, cool down) is categorically different from an absent/blocked answer
// (record it as blocked, keep going) — conflating them is how you both hammer the IP and fake data.

// Verification / rate-limit / anti-bot interstitials → STOP. (Not "no answer" — those are handled
// by the existing block-aware path.)
const CHALLENGE_RE = new RegExp([
  'unusual traffic', 'automated queries', "are you a robot", 'verify.{0,20}human',
  'complete a (captcha|security check|puzzle)', 'recaptcha/api', 'hcaptcha', 'cf-challenge',
  'access denied', 'rate.?limit(ed)?', 'too many requests', '\\b429\\b', 'try again later',
  'verify your identity', 'confirm you are human', 'suspicious activity',
].join('|'), 'i');

/** PURE: is this page/answer text a human-verification/anti-bot CHALLENGE (→ halt + cooldown)?
 *  This is the Google/Perplexity IP-danger signal — NOT ChatGPT's soft message cap (see isRateLimit). */
export function isChallenge(text = '') { return CHALLENGE_RE.test(String(text || '')); }

// ChatGPT's per-ACCOUNT message cap ("you've reached your GPT-x limit, try again at ...") — a SOFT
// quota, not an IP-ban risk. Response: stop that engine, resume after the reset. Never scary.
const RATE_LIMIT_RE = /reached (the|your)[^.]*\blimit\b|message limit|you.?ve hit your (limit|cap)|limit (will )?reset|try again (later|after|in|at|when)|upgrade to (chatgpt )?(plus|pro|go)|come back (later|tomorrow)/i;

/** PURE: is this ChatGPT's account message-cap (soft limit → pause + resume, not a ban)? */
export function isRateLimit(text = '') { return RATE_LIMIT_RE.test(String(text || '')); }

/** PURE: randomized, human-paced delay in ms. Never faster than a hard floor. */
export function humanDelayMs(min = 20000, max = 55000, rnd = Math.random) {
  const lo = Math.max(8000, Number(min) || 0);
  const hi = Math.max(lo + 1, Number(max) || 0);
  return Math.round(lo + (hi - lo) * rnd());
}

/** PURE: are we still inside the post-challenge cooldown window? */
export function inCooldown(lastChallengeAt, now, cooldownMs = 6 * 3600 * 1000) {
  if (!lastChallengeAt) return { cooling: false, remainingMs: 0 };
  const remaining = (Number(lastChallengeAt) + Number(cooldownMs)) - Number(now);
  return { cooling: remaining > 0, remainingMs: Math.max(0, remaining) };
}

/** Per-run governor: a hard cap on how many queries one session may make. Stateful, tiny. */
export function makeGovernor({ maxPerRun = 20, maxPerDay = 60, spentToday = 0 } = {}) {
  let count = 0;
  const dayFloor = Math.max(0, Number(maxPerDay) - Number(spentToday)); // remaining daily budget
  const hardCap = Math.max(0, Math.min(Number(maxPerRun) || 0, dayFloor));
  return {
    /** call BEFORE a query; false → cap hit, stop querying (not an error, a safety stop). */
    allow() { return count < hardCap; },
    spend() { count += 1; return count; },
    count: () => count,
    remaining: () => Math.max(0, hardCap - count),
    hardCap: () => hardCap,
  };
}

// Conservative defaults, overridable by env/config. Tuned so a scheduled run is inherently safe
// on a single residential IP: a handful of queries, minutes apart, halt on the first challenge.
export const SAFE_DEFAULTS = Object.freeze({
  maxPerRun: Number(process.env.SEO_BOT_MAX_QUERIES_PER_RUN) || 15,
  maxPerDay: Number(process.env.SEO_BOT_MAX_QUERIES_PER_DAY) || 40,
  minDelayMs: Number(process.env.SEO_BOT_MIN_DELAY_MS) || 20000,
  maxDelayMs: Number(process.env.SEO_BOT_MAX_DELAY_MS) || 55000,
  cooldownMs: Number(process.env.SEO_BOT_CAPTURE_COOLDOWN_MS) || 6 * 3600 * 1000,
});
