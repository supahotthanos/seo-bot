// seo-bot · worksheet — the one repeatable "bring on a client" sheet. Composes
// onboarding (DNS/stack/baseline), connection status, the citations worklist, the
// content plan, the tactics posture, and the recurring cadence into a single doc +
// a machine-readable JSON. This is what you generate every time a client is added.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';
import { onboard } from './onboard/index.mjs';
import { citations } from './listings/index.mjs';
import { connectionStatus } from './connect/google.mjs';
import { actionable } from './tactics/registry.mjs';
import { CITATION_TARGETS, TIER_LABELS } from './listings/targets.mjs';

const CONTENT_PLAN = [
  ['Home', 'MedicalBusiness schema, NAP, answer capsule, top services, reviews, map'],
  ['Per-service pages', 'one per treatment: Service+Offer(price), MedicalProcedure, medical reviewer, FAQ, 40-60w answer capsule'],
  ['Per-location pages', 'one per location/neighborhood: LocalBusiness, NAP, geo, embedded map, local proof'],
  ['Cost guides', '/cost/{service} from REAL local prices — answer-box bait, dated, sourced'],
  ['Treatment explainers (blog)', 'data-grounded, cited, named medical reviewer — NOT generic AI copy; YMYL = human-approved'],
  ['Comparison pages', '"{service} vs {alt}" with genuine differentiation — never self-rank #1'],
];

export async function worksheet(cfg, { log = () => {} } = {}) {
  log(`\n▶ Building onboarding worksheet for ${cfg.brand}\n`);

  const onb = await onboard(cfg.domain, { log: () => {} }).catch(() => null);
  const cites = citations(cfg, { log: () => {} });
  const conn = connectionStatus(cfg.name);
  const act = actionable(cfg).map((t) => t.id);

  const citeCounts = { auto: cites.filter((r) => r.automatable === 'auto').length, flag: cites.filter((r) => r.automatable === 'flag-track').length, manual: cites.filter((r) => r.automatable === 'manual').length };

  const L = [`# Client onboarding worksheet — ${cfg.brand}`, `${cfg.baseUrl} · ${new Date().toUTCString()}`, ''];

  L.push('## 1. Connections (one-click)');
  L.push(`- Google (GA4 + GSC + Business Profile): ${conn.connected ? `✅ connected (${conn.scopes})` : '☐ run `node seo-bot/bin/seo-bot.mjs connect ' + cfg.name + '`'}`);
  L.push(`- GA4 property id: ${cfg.ga4?.propertyId ? '✅ ' + cfg.ga4.propertyId : '☐ set ga4.propertyId in config'}`);
  if (onb) for (const v of onb.dns.derived.verifications) L.push(`- DNS-verified: ${v.provider}`);
  L.push('');

  L.push('## 2. Site snapshot');
  if (onb) {
    L.push(`- DNS host: ${onb.dns.derived.dnsHost || '—'} · Email: ${onb.dns.derived.hasEmail ? onb.dns.derived.emailProvider : 'none'} · SPF/DMARC: ${onb.dns.derived.spf ? 'spf' : 'NO-spf'}/${onb.dns.derived.dmarc ? 'dmarc' : 'NO-dmarc'}`);
    L.push(`- Stack: ${onb.stack?.primaryFramework || '—'} · CDN: ${onb.stack?.cdn || '—'} · adapter: \`${onb.stack?.suggestedCms || 'dryrun'}\``);
    L.push(`- Booking: ${onb.stack?.booking?.join(', ') || 'NONE — wire Boulevard/Vagaro + Reserve-with-Google'}`);
    L.push(`- Baseline audit: ${onb.audit ? onb.audit.score + '/100' : 'n/a'}`);
  } else L.push('- (onboard unavailable — run `onboard ' + cfg.domain + '`)');
  L.push('');

  L.push('## 3. Local citations (full worklist → reports/' + cfg.name + '/citations.md)');
  L.push(`- ${cites.length} targets · ${citeCounts.auto} auto · ${citeCounts.flag} flag-track · ${citeCounts.manual} manual`);
  for (const tier of [1, 2]) L.push(`- ${TIER_LABELS[tier]}: ${CITATION_TARGETS.filter((t) => t.tier === tier).map((t) => t.name).join(', ')}`);
  L.push('');

  L.push('## 4. Content plan (data-grounded, anti-slop — see `content`)');
  for (const [k, v] of CONTENT_PLAN) L.push(`- **${k}** — ${v}`);
  L.push('');

  L.push('## 5. Tactics posture');
  L.push(`- Auto (bot applies): ${act.join(', ')}`);
  L.push(`- Grey levers available to opt in (set \`tacticsOptIn[]\`): own-comparison-pages, programmatic-seo, stats-quotes-citations`);
  L.push(`- Black/illegal: knowledge-only, never auto-applied (see \`tactics\`).`);
  L.push('');

  L.push('## 6. Recurring cadence');
  L.push('- Per-new-site: this worksheet + `citations`. Daily: research. Weekly: `run` + `stats` (decide at locked horizons). Monthly: `citations` NAP re-check.');
  L.push('');

  L.push('## 7. Go-live checklist');
  L.push('- [ ] `connect` Google (GA4/GSC/GBP)  - [ ] set ga4.propertyId + vertical:medspa + service/location path regexes');
  L.push('- [ ] claim GBP + Apple Business Connect + Bing Places  - [ ] wire booking + Reserve-with-Google');
  L.push('- [ ] `run --apply` the auto on-site fixes  - [ ] approve the content plan  - [ ] confirm canonical NAP');

  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'worksheet.md'), L.join('\n'));
  writeFileSync(join(dir, 'worksheet.json'), JSON.stringify({ client: cfg.name, generatedAt: nowIso(), connected: conn.connected, baseline: onb?.audit?.score ?? null, citations: citeCounts, autoTactics: act }, null, 2));
  log(`  Worksheet → ${join(dir, 'worksheet.md')}\n`);
  return { onb, cites, conn };
}
