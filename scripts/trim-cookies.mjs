// seo-bot · scripts/trim-cookies — keep the ChatGPT CDP profile's cookies UNDER the header-size
// limit that triggers HTTP 431 on new-tab navigation (root-caused live 2026-07-12: 97 cookies /
// ~16KB for chatgpt.com → every capture's new tab got 431 → near-zero captures for a whole day,
// masked as "throttling"). Drops the analytics/tracking bloat, KEEPS the auth session, so the
// login survives. Idempotent + fail-open: run it before every capture attempt.
//
//   SEO_BOT_CDP_ENDPOINT=http://localhost:9222 node scripts/trim-cookies.mjs [--force]
//
// Exits 0 always (never breaks the accrual loop). Threshold: trims when chatgpt.com-applicable
// cookies exceed ~8000 bytes (the ~8KB header limit) unless --force.

const CDP = process.env.SEO_BOT_CDP_ENDPOINT || 'http://localhost:9222';
const THRESHOLD = Number(process.env.COOKIE_TRIM_THRESHOLD || 8000);
// Auth-critical cookie names to KEEP (everything else on openai/chatgpt is droppable bloat).
const KEEP = /session-token|__Secure-oai|oai-is|__Host|oai-did|client-auth|cf_clearance|__cf_bm|_uasid|_umsid|oai-sc|authjs|oai-hlib|oai-gn/i;
const isOai = (d) => /openai|chatgpt/i.test(d);
const applicableBytes = (cs) => cs.filter((c) => /(^|\.)chatgpt\.com$/.test(c.domain)).reduce((n, c) => n + c.name.length + String(c.value).length + 4, 0);

async function main() {
  let chromium;
  try { ({ chromium } = await import('patchright')); } catch { try { ({ chromium } = await import('playwright')); } catch { console.log('trim-cookies: no browser driver'); return; } }
  let b;
  try { b = await chromium.connectOverCDP(CDP); } catch (e) { console.log(`trim-cookies: CDP not reachable (${String(e.message || e).slice(0, 80)}) — skipping`); return; }
  try {
    const ctx = b.contexts()[0];
    if (!ctx) { console.log('trim-cookies: no browser context'); return; }
    const before = await ctx.cookies();
    const sizeBefore = applicableBytes(before);
    const force = process.argv.includes('--force');
    if (sizeBefore <= THRESHOLD && !force) { console.log(`trim-cookies: chatgpt.com cookies ~${sizeBefore}B ≤ ${THRESHOLD}B — no trim needed`); return; }
    const keepers = before.filter((c) => !isOai(c.domain) || KEEP.test(c.name));
    const dropped = before.length - keepers.length;
    await ctx.clearCookies();
    await ctx.addCookies(keepers.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })));
    const sizeAfter = applicableBytes(await ctx.cookies());
    console.log(`trim-cookies: dropped ${dropped} non-auth oai cookies · chatgpt.com ~${sizeBefore}B → ~${sizeAfter}B (login preserved)`);
  } catch (e) {
    console.log(`trim-cookies: ${String(e.message || e).slice(0, 120)}`);
  } finally { await b.close().catch(() => {}); }
}
await main();
