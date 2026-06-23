// seo-bot · onboard — deep-research a new client domain before recurring SEO starts.
// Pulls DNS, detects the stack/booking platform, runs a baseline audit, derives
// recommendations + the right CMS adapter, and (optionally) writes a starter config.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, buildConfig } from '../config.mjs';
import { fetchPage, slugify, nowIso } from '../util.mjs';
import { lookupDns, summarizeDns } from './dns.mjs';
import { detectStack } from './stack.mjs';
import { runAudit } from '../audit.mjs';

export async function onboard(domain, { log = () => {}, writeConfig = false } = {}) {
  const d = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const slug = slugify(d.replace(/\./g, '-'));
  const baseUrl = `https://${d}`;
  log(`\n▶ Onboarding ${d}\n`);

  log('① DNS records …');
  const dns = await lookupDns(d);
  summarizeDns(dns).forEach((l) => log(`   ${l}`));

  log('② homepage + tech stack …');
  const home = await fetchPage(baseUrl, { timeoutMs: 15000 });
  const stack = home.ok ? detectStack(home.text, home.headers) : null;
  if (stack) log(`   framework: ${stack.primaryFramework || '—'} · cdn: ${stack.cdn || '—'} · booking: ${stack.booking.join(', ') || 'NONE'} · adapter: ${stack.suggestedCms}`);
  else log(`   homepage fetch failed (HTTP ${home.status})`);

  log('③ baseline audit (10 pages) …');
  let audit = null;
  if (home.ok) {
    const cfg = buildConfig({ name: slug, brand: d, domain: d, baseUrl, schemaTypesExpected: ['MedicalBusiness', 'LocalBusiness', 'WebSite'], audit: { maxPages: 10 } });
    audit = await runAudit(cfg, { log: () => {} });
    log(`   score ${audit.score}/100 · 🔴 ${audit.bySeverity.critical} 🟠 ${audit.bySeverity.high} 🟡 ${audit.bySeverity.medium}`);
  }

  // ---- recommendations ----
  const recs = [];
  const gscVerified = dns.derived.verifications.some((v) => v.provider === 'Google Search Console');
  const bingVerified = dns.derived.verifications.some((v) => v.provider === 'Microsoft/Bing');
  recs.push(gscVerified ? '✓ Google Search Console DNS-verified — enable gsc in the config to pull query/opportunity data.' : '☐ Verify the domain in Google Search Console (free; unlocks the bot\'s GSC pull).');
  recs.push(bingVerified ? '✓ Bing/Microsoft verification present.' : '☐ Verify in Bing Webmaster Tools + claim Bing Places for Business.');
  if (!dns.derived.spf || !dns.derived.dmarc) recs.push('☐ Add SPF + DMARC TXT records (domain trust / anti-spoofing; cheap E-E-A-T hygiene).');
  if (stack && !stack.hasBooking) recs.push('☐ No booking platform detected — wire Boulevard (or Vagaro/Mindbody) booking + a "Book now"/Reserve action.');
  else if (stack?.hasBooking) recs.push(`✓ Booking platform detected: ${stack.booking.join(', ')} — ensure it emits a booking/Reserve action + review capture.`);
  if (stack && stack.suggestedCms === 'dryrun') recs.push('⚠ Stack not auto-identified — set cms.type manually (nextjs/wordpress) before recurring apply.');
  if (audit) for (const ru of audit.byRule.filter((r) => r.severity === 'critical' || r.severity === 'high').slice(0, 5)) recs.push(`☐ Fix [${ru.severity}] ${ru.rule} (${ru.count} pages): ${ru.recommendation}`);
  recs.push('☐ Build local citations — see `node seo-bot/bin/seo-bot.mjs citations ' + slug + '` (after writing the config).');

  // ---- report ----
  const report = {
    domain: d, slug, baseUrl, ranAt: nowIso(),
    dns, stack, audit: audit && { score: audit.score, bySeverity: audit.bySeverity, topRules: audit.byRule.slice(0, 8) },
    suggestedConfig: { name: slug, brand: d, domain: d, baseUrl, cms: { type: stack?.suggestedCms || 'dryrun' }, gsc: { enabled: gscVerified, siteUrl: `${baseUrl}/` }, schemaTypesExpected: ['MedicalBusiness', 'LocalBusiness', 'WebSite'] },
    recommendations: recs,
  };
  const dir = join(ROOT, 'seo-bot', 'reports', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'onboard.json'), JSON.stringify(report, null, 2));
  const md = renderOnboard(report);
  writeFileSync(join(dir, 'onboard.md'), md);

  if (writeConfig) {
    const cfgPath = join(ROOT, 'seo-bot', 'config', `${slug}.json`);
    if (existsSync(cfgPath)) log(`   (config ${slug}.json already exists — not overwritten)`);
    else { writeFileSync(cfgPath, JSON.stringify({ ...report.suggestedConfig, competitors: [], promptPanel: [`best med spa in ${d}`, `${d} reviews`] }, null, 2)); log(`   wrote starter config → seo-bot/config/${slug}.json`); }
  }

  log(`\n  Recommendations:`);
  recs.forEach((r) => log(`   ${r}`));
  log(`\n  Onboarding report → ${join(dir, 'onboard.md')}\n`);
  return report;
}

function renderOnboard(r) {
  const L = [`# Onboarding — ${r.domain}`, `${r.baseUrl} · ${new Date(r.ranAt).toUTCString()}`, ''];
  L.push('## DNS');
  for (const l of summarizeDns(r.dns)) L.push(`- ${l}`);
  L.push('', '## Tech stack');
  if (r.stack) {
    L.push(`- Framework: ${r.stack.primaryFramework || '—'} (${r.stack.frameworks.join(', ') || 'n/a'})`);
    L.push(`- CDN: ${r.stack.cdn || '—'} · Server: ${r.stack.server || '—'}`);
    L.push(`- Booking: ${r.stack.booking.join(', ') || 'NONE detected'} · Reserve action: ${r.stack.hasReserveAction ? 'yes' : 'no'}`);
    L.push(`- Analytics: ${r.stack.analytics.join(', ') || '—'}`);
    L.push(`- Suggested apply-adapter: \`${r.stack.suggestedCms}\``);
  } else L.push('- (homepage unreachable)');
  L.push('', '## Baseline audit');
  if (r.audit) { L.push(`- Score: ${r.audit.score}/100 (🔴 ${r.audit.bySeverity.critical} 🟠 ${r.audit.bySeverity.high} 🟡 ${r.audit.bySeverity.medium})`); for (const ru of r.audit.topRules) L.push(`- [${ru.severity}] \`${ru.rule}\` ×${ru.count} — ${ru.recommendation}`); }
  else L.push('- (skipped — homepage unreachable)');
  L.push('', '## Recommendations');
  for (const rec of r.recommendations) L.push(`- ${rec}`);
  L.push('', '## Suggested config (seo-bot/config/<slug>.json)', '```json', JSON.stringify(r.suggestedConfig, null, 2), '```');
  return L.join('\n');
}
