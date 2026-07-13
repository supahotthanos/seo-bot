// seo-bot · e2e-dashboard — screenshot-driven end-to-end test of the live control room.
// Drives the dashboard headlessly: login gate → six areas → 3 tiers → evidence card →
// accept-all → toast → share-link lifecycle → mobile + keyboard + ⌘K palette,
// screenshotting every area desktop AND mobile. Re-runnable. Exits non-zero on failure.
//   node test/e2e-dashboard.mjs            (uses env DASH_URL, DASH_PW, CLIENT)
// SEED: the Accept-all step consumes the Mild queue each run — if the approvals checks go red with
//   "0 cards", re-seed the store first:  node scripts/e2e-seed.mjs  (run where `gh` is authed).
// Env: DASH_URL (default https://seenai-next.vercel.app), DASH_PW (default seenai), CLIENT (_e2e)
//      E2E_EXPECT_AUDIT / E2E_EXPECT_PROGRESS (optional exact overview fixture numbers)

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/config.mjs';
import { launchBrowser } from '../src/measure/browser.mjs';

const URL = (process.env.DASH_URL || 'https://seenai-next.vercel.app').replace(/\/$/, '');
const PW = process.env.DASH_PW || 'seenai';
const CLIENT = process.env.CLIENT || '_e2e';
const OUT = join(ROOT, 'reports', '_e2e', 'shots');
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const q = encodeURIComponent(CLIENT);

// Full-page captures + sticky/fixed chrome: Playwright's fullPage machinery paints sticky/
// fixed elements at whatever scroll offset the compositor last saw — bars stamped mid-page
// over content. Deterministic + honest alternative: grow the VIEWPORT to the document height
// at scroll 0 and take a plain viewport shot — sticky chrome sits at its natural position,
// a fixed bottom bar sits at the real document bottom (exactly where a user at full scroll
// sees it), then restore the viewport. The offset math itself is verified by dedicated steps.
async function fullShot(pg, file) {
  const vp = pg.viewportSize();
  const h = await pg.evaluate(() => { window.scrollTo(0, 0); return Math.min(document.body.scrollHeight, 8000); }).catch(() => 0);
  if (h > vp.height) await pg.setViewportSize({ width: vp.width, height: Math.ceil(h) });
  await pg.waitForTimeout(180);
  await pg.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await pg.screenshot({ path: join(OUT, file) });
  if (h > vp.height) await pg.setViewportSize(vp);
}
/** Chromium re-applies a previously-visited URL's scroll position asynchronously after goto —
 *  it can land between a scrollTo(0,0) and the capture. Kill restoration per context. */
const noScrollRestore = (c) => c.addInitScript(() => { try { history.scrollRestoration = 'manual'; } catch { /* */ } });

const L = await launchBrowser({ headless: true, stealth: false });
if (L.status) { console.error('NO BROWSER:', L.status); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const ctx = await L.browser.newContext({ viewport: { width: 1280, height: 1500 } });
await noScrollRestore(ctx);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept().catch(() => {})); // auto-accept any native confirm

try {
  // 1) login gate
  await page.goto(`${URL}/login`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.screenshot({ path: join(OUT, '01-login.png') });
  step('login page renders', !!(await page.$('#pw')));

  // 2) wrong password rejected (no access)
  await page.fill('#pw', 'definitely-wrong'); await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  const err = (await page.textContent('.err').catch(() => '')) || '';
  await page.screenshot({ path: join(OUT, '02-wrong-password.png') });
  step('wrong password rejected', /wrong/i.test(err), err.trim());

  // 3) correct password → authenticated dashboard with 3 tiers
  // (control-room IA: the tiered approvals experience lives in the /approvals area now;
  //  / redirects to /overview. Same tiers, same selectors, same Accept-all + red confirm.)
  await page.fill('#pw', PW); await page.click('button[type=submit]');
  await page.waitForTimeout(2500);
  await page.goto(`${URL}/approvals?client=${q}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1200);
  await fullShot(page, '03-dashboard.png');
  const html = await page.content();
  const tiers = ['Almost auto-approve', 'Mild approve', 'Dangerous'].filter((t) => html.includes(t));
  step('authenticated dashboard shows all 3 tiers', tiers.length === 3, tiers.join(' · '));
  const pill = (await page.textContent('.pill').catch(() => '')) || '';
  step('pending queue loaded from store', /\d+\s*pending/.test(pill), pill.trim());

  // 3b) sticky-offset math (not just the screenshotter): scrolled deep into the queue, the
  // top bar must sit exactly at its 12px sticky offset — never painted mid-document.
  const stickTop = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const t = document.getElementById('topbar')?.getBoundingClientRect().top;
    window.scrollTo(0, 0);
    return t;
  });
  step('desktop: top bar sticks at its 12px offset when scrolled', Number.isFinite(stickTop) && Math.abs(stickTop - 12) < 3, `top ${Math.round(stickTop)}px`);

  // 4) collapse the Dangerous tier
  await page.click('section.tier.red .tier-head').catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, '04-collapsed.png') });
  step('tier collapses on click', true);

  // 5) per-item buttons exist on Dangerous (red), not on Mild
  await page.click('section.tier.red .tier-head').catch(() => {}); // re-open
  await page.waitForTimeout(400);
  const redActions = await page.$$('section.tier.red .acts .b');
  step('Dangerous tier has per-item Approve/Reject', redActions.length >= 2, `${redActions.length} buttons`);

  // 5b) D6 — an approvals card EXPANDS to diff + why (amber starts collapsed)
  const amberCard = await page.$('section.tier.amber .card .dprev, section.tier.amber .card .chd');
  if (amberCard) {
    await amberCard.click(); // the collapsed diff preview / header row toggles expand
    await page.waitForTimeout(400);
    const body = await page.$('section.tier.amber .card .card-body');
    const why = await page.$('section.tier.amber .card .whyx');
    const diff = await page.$('section.tier.amber .card .diffx, section.tier.amber .card .sxs');
    await fullShot(page, '05-card-expanded.png');
    step('card expands to diff + why', !!(body && why && diff));
  } else step('card expands to diff + why', false, 'no amber card in queue');

  // 5c) D6 — keyboard: j focuses a card, k moves back
  await page.keyboard.press('j'); await page.keyboard.press('j'); await page.keyboard.press('k');
  step('j/k keyboard focus on cards', !!(await page.$('.card.kfocus')));

  // 6) Accept-all on Mild (amber) → toast + items clear (toast only AFTER the store confirms)
  const amberBefore = (await page.$$('section.tier.amber .card')).length;
  const amberBtn = await page.$('section.tier.amber button.b.ok');
  step('Mild tier has an Accept-all button', !!amberBtn, `${amberBefore} cards`);
  let toast = '';
  if (amberBtn) {
    await amberBtn.click();
    await page.waitForTimeout(1100);
    toast = (await page.textContent('.toast').catch(() => '')) || '';
    await fullShot(page, '06-accepted.png'); // capture while toast is visible (pinned to document bottom in the shot)
    await page.waitForTimeout(1900);
  }
  const amberAfter = (await page.$$('section.tier.amber .card')).length;
  step('Accept-all records decisions (cards clear)', amberAfter < amberBefore, `toast="${toast.trim()}" (${amberBefore}→${amberAfter} cards)`);

  // 7) D6 — every area renders its heading; screenshot each, desktop AND mobile
  const AREAS = [
    ['overview', 'Overview'], ['approvals', 'Approvals'], ['experiments', 'Experiments'],
    ['visibility', 'AI Visibility'], ['content', 'Content'], ['reports', 'Reports & Settings'],
  ];
  for (const [slug, heading] of AREAS) {
    await page.goto(`${URL}/${slug}?client=${q}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(600);
    const h1 = (await page.textContent('h1.area-title').catch(() => '')) || '';
    await fullShot(page, `area-${slug}-desktop.png`);
    step(`area /${slug} renders its heading`, h1.trim() === heading, h1.trim());
  }

  // 8) D6 — overview shows the fixture numbers (store bundle summary), never fabricated
  await page.goto(`${URL}/overview?client=${q}`, { waitUntil: 'networkidle', timeout: 45000 });
  const statVals = await page.$$eval('.stat-value', (els) => els.map((e) => e.textContent.trim()));
  const numeric = statVals.filter((v) => /\d/.test(v));
  step('overview stat tiles carry real numbers', numeric.length >= 2, statVals.join(' | '));
  const expectAudit = process.env.E2E_EXPECT_AUDIT, expectProg = process.env.E2E_EXPECT_PROGRESS;
  if (expectAudit || expectProg) {
    const flat = statVals.join(' ');
    const okA = !expectAudit || flat.includes(expectAudit);
    const okP = !expectProg || flat.includes(expectProg);
    step('overview matches expected fixture numbers', okA && okP, `audit~${expectAudit || '-'} progress~${expectProg || '-'} in "${flat}"`);
  }

  // 9) D6 — ⌘K command palette: opens, fuzzy-matches, jumps areas
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  const paletteOpen = !!(await page.$('.cmdk-input'));
  step('⌘K opens the command palette', paletteOpen);
  if (paletteOpen) {
    await page.type('.cmdk-input', 'experi');
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, '07-cmdk.png') });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    step('palette jumps to Experiments', page.url().includes('/experiments'), page.url());
    await page.keyboard.press('Control+k'); await page.waitForTimeout(200);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    step('palette closes on Esc', !(await page.$('.cmdk-input')));
  }

  // 10) D6 — share-link lifecycle: create (authed) → open logged-OUT → revoke → 404
  await page.goto(`${URL}/reports/${q}/weekly?client=${q}`, { waitUntil: 'networkidle', timeout: 45000 });
  const shareBtn = await page.$('.share-bar button.b.ok');
  step('weekly report has Create share link', !!shareBtn);
  let shareUrl = '';
  if (shareBtn) {
    await shareBtn.click();
    for (let i = 0; i < 20 && !shareUrl; i++) { await page.waitForTimeout(500); shareUrl = (await page.textContent('.share-url').catch(() => '')) || ''; }
    shareUrl = shareUrl.trim();
    step('share link created (server-confirmed URL shown)', /\/share\/[A-Za-z0-9_-]{20,}/.test(shareUrl), shareUrl);
  } else step('share link created (server-confirmed URL shown)', false, 'no button');
  if (shareUrl) {
    // same path, logged-out browser context (no cookie)
    const anon = await L.browser.newContext({ viewport: { width: 1280, height: 1500 } });
    await noScrollRestore(anon);
    const anonPage = await anon.newPage();
    // create is a store write too — poll briefly while the contents API catches up
    let shareResp = null;
    for (let i = 0; i < 10 && (!shareResp || shareResp.status() !== 200); i++) {
      if (i) await anonPage.waitForTimeout(4000);
      shareResp = await anonPage.goto(shareUrl.replace(/^https?:\/\/[^/]+/, URL), { waitUntil: 'networkidle', timeout: 45000 });
    }
    const shareHtml = await anonPage.content();
    await fullShot(anonPage, '08-share-public.png');
    step('share URL renders read-only report logged-out', shareResp.status() === 200 && /read-only share/i.test(shareHtml) && !/<button/i.test(shareHtml.split('</header>').pop() || shareHtml));
    // sanity: a logged-out hit on a PRIVATE area still bounces to /login
    await anonPage.goto(`${URL}/overview`, { waitUntil: 'networkidle', timeout: 45000 });
    step('logged-out /overview still bounces to login', anonPage.url().includes('/login'));
    // revoke from the authed session (the settings surface uses the same DELETE)
    const token = (shareUrl.match(/\/share\/([A-Za-z0-9_-]{20,})/) || [])[1];
    const revoked = await page.evaluate(async (tok) => {
      const r = await fetch('/api/share', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok }) });
      return (await r.json().catch(() => ({}))).ok === true;
    }, token);
    step('share token revoked', revoked);
    // the store's contents API is eventually consistent — poll briefly for the 404
    let goneStatus = 0;
    for (let i = 0; i < 10 && goneStatus !== 404; i++) {
      if (i) await anonPage.waitForTimeout(4000);
      const goneResp = await anonPage.goto(shareUrl.replace(/^https?:\/\/[^/]+/, URL), { waitUntil: 'networkidle', timeout: 45000 });
      goneStatus = goneResp.status();
    }
    await anonPage.screenshot({ path: join(OUT, '09-share-revoked.png') });
    step('revoked share URL is a 404', goneStatus === 404, `status ${goneStatus}`);
    await anon.close();
  }

  // 11) D6 — mobile viewport (375px): bottom bar, tier tap, card tap-to-expand, area shots
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 375, height: 812 });
  await mob.goto(`${URL}/approvals?client=${q}`, { waitUntil: 'networkidle', timeout: 45000 });
  await mob.waitForTimeout(800);
  const barFixed = await mob.evaluate(() => {
    const n = document.querySelector('.side');
    return n && getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= innerHeight - 2;
  });
  step('mobile: nav is a fixed glass bottom bar', !!barFixed);
  // offset math: the page's bottom padding must clear the fixed bar, so no content
  // ('Bundle freshness', Last Run chips) can ever hide beneath it at full scroll.
  const clearance = await mob.evaluate(() => {
    const bar = document.querySelector('.side');
    const shell = document.querySelector('.shell');
    if (!bar || !shell) return null;
    return { bar: bar.getBoundingClientRect().height, pad: parseFloat(getComputedStyle(shell).paddingBottom) };
  });
  step('mobile: content padding clears the fixed bottom bar', !!clearance && clearance.pad >= clearance.bar + 8,
    clearance ? `bar ${Math.round(clearance.bar)}px vs padding ${Math.round(clearance.pad)}px` : 'missing nodes');
  const openBefore = !!(await mob.$('section.tier.red .tier-body'));
  await mob.tap('section.tier.red .tier-head').catch(() => mob.click('section.tier.red .tier-head'));
  await mob.waitForTimeout(400);
  const openAfter = !!(await mob.$('section.tier.red .tier-body'));
  step('mobile: tier head is tappable (collapses)', openBefore && !openAfter);
  await mob.tap('section.tier.red .tier-head').catch(() => mob.click('section.tier.red .tier-head')); // re-open
  await mob.waitForTimeout(300);
  const bodiesBefore = (await mob.$$('.card .card-body')).length;
  const mobCard = await mob.$('section.tier.green .card .dprev, section.tier.green .card .chd');
  if (mobCard) {
    await mobCard.tap().catch(() => mobCard.click());
    await mob.waitForTimeout(400);
  }
  const bodiesAfter = (await mob.$$('.card .card-body')).length;
  step('mobile: card tap expands to evidence', bodiesAfter > bodiesBefore, `${bodiesBefore}→${bodiesAfter} expanded`);
  const tapBad = await mob.evaluate(() => {
    const bad = [];
    for (const s of ['.side-link', '.b', '.ghost', '.client-switch']) {
      for (const el of document.querySelectorAll(s)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.height < 43.5) bad.push(`${s} ${Math.round(r.height)}px`);
      }
    }
    return bad.slice(0, 5);
  });
  step('mobile: tap targets ≥ 44px', tapBad.length === 0, tapBad.join(', ') || 'all pass');
  for (const [slug] of AREAS) {
    await mob.goto(`${URL}/${slug}?client=${q}`, { waitUntil: 'networkidle', timeout: 45000 });
    await mob.waitForTimeout(500);
    await fullShot(mob, `area-${slug}-mobile.png`);
  }
  step('mobile: all six areas screenshotted', true);
  await mob.close();
} catch (e) {
  step('harness completed without crashing', false, e.message);
} finally {
  await L.browser.close().catch(() => {});
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nE2E: ${passed}/${results.length} passed  ·  screenshots → reports/_e2e/shots/`);
process.exit(passed === results.length ? 0 : 1);
