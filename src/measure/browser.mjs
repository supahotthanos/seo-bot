// seo-bot · measure/browser — pick a working browser on this machine.
//
// Windows ARM64 has NO bundled Playwright/Patchright Chromium build, so we drive the
// SYSTEM browser via the `channel` option (Edge ships native arm64 on every Win-ARM64
// box; Chrome too). Order: env override → msedge → chrome → bundled (works on x64/mac).
// Prefers Patchright (stealth, beats the Runtime.enable/navigator.webdriver leaks) then
// Playwright. Returns { browser, driver, channel } or { status:'no-driver'|'no-channel' }.
//
// SEO_BOT_CDP_ENDPOINT (e.g. http://localhost:9222): attach to an ALREADY-RUNNING real Chrome
// over CDP instead of launching a throwaway. This is the strongest anti-bot-detection posture —
// a genuine long-lived browser with a genuine fingerprint (and, in the persistent profile, real
// logged-in sessions). It also avoids spawning a fresh window per run. Fail-soft: if the endpoint
// is down we fall through to launching, so nothing hard-breaks.

const CHANNELS = (process.env.SEO_BOT_BROWSER_CHANNEL || 'msedge,chrome')
  .split(',').map(s => s.trim()).filter(Boolean);

export async function launchBrowser({ headless = true, stealth = true, proxy = undefined, userDataDir = null, ignoreCdp = false } = {}) {
  let mod = null, driver = null;
  const order = stealth ? ['patchright', 'playwright'] : ['playwright', 'patchright'];
  for (const name of order) { try { mod = await import(name); driver = name; break; } catch { /* */ } }
  if (!mod) return { status: 'no-driver' };
  // ignoreCdp: the Google lane must NOT attach to the ChatGPT CDP Chrome (they collide — resource
  // starvation + session cross-contamination). It launches its own instance instead.
  const cdp = ignoreCdp ? null : process.env.SEO_BOT_CDP_ENDPOINT;
  if (cdp) {
    try {
      const browser = await mod.chromium.connectOverCDP(cdp);
      return { browser, driver, channel: 'cdp', cdp: true };
    } catch { /* endpoint down — fall through to a normal launch */ }
  }
  const base = { headless, ...(proxy ? { proxy } : {}) };
  // userDataDir → a PERSISTENT context (real cookies, accepted consent, browsing history). This is
  // the single biggest anti-/sorry/ lever for Google on a residential IP: a warm cookied session
  // sails through where a cold one gets the "unusual traffic" wall. Returns { context } not { browser }.
  if (userDataDir) {
    for (const opt of [...CHANNELS.map(c => ({ channel: c })), {}]) {
      try {
        const context = await mod.chromium.launchPersistentContext(userDataDir, { ...opt, ...base, viewport: { width: 1366, height: 900 }, locale: 'en-US' });
        return { context, driver, channel: opt.channel || 'bundled', persistent: true };
      } catch { /* try next channel */ }
    }
    return { status: 'no-channel' };
  }
  const tries = [...CHANNELS.map(c => ({ channel: c })), {}]; // trailing {} = bundled chromium
  for (const opt of tries) {
    try {
      const browser = await mod.chromium.launch({ ...opt, ...base });
      return { browser, driver, channel: opt.channel || 'bundled' };
    } catch { /* try next channel */ }
  }
  return { status: 'no-channel' };
}
