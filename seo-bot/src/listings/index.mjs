// seo-bot · listings — generate a prioritized local-citation worklist per client and
// track status. Most listings are human/creds-gated, so this is a checklist + state
// tracker: the bot auto-does only the truly automatable (on-site embed/schema + NAP
// audit), and queues everything else as flag-track / manual with the exact URL + rule.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';
import { CITATION_TARGETS, TIER_LABELS } from './targets.mjs';

/** Canonicalize a NAP record for consistency diffing across listings. */
export function normalizeNap(nap) {
  if (!nap) return null;
  const phone = (nap.phone || '').replace(/[^\d+]/g, '').replace(/^1(\d{10})$/, '+1$1');
  const address = (nap.address || '').toLowerCase()
    .replace(/\b(ste|suite|unit|#)\b\.?/g, 'suite').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  return { name: (nap.name || '').trim(), phone, address, url: (nap.url || '').replace(/\/+$/, '').toLowerCase() };
}

const STATUS_ICON = { done: '✅', 'in-progress': '🟡', open: '☐', 'n/a': '➖', blocked: '⛔' };

/** Generate the citation checklist for a client. Writes citations.md + citations.json. */
export function citations(cfg, { log = () => {} } = {}) {
  const canonical = cfg.listings?.canonicalNap ? normalizeNap(cfg.listings.canonicalNap) : null;
  const statusMap = new Map((cfg.listings?.targets || []).map((t) => [t.id, t.status]));
  const rows = CITATION_TARGETS.map((t) => ({ ...t, status: statusMap.get(t.id) || 'open' }));

  const counts = { auto: rows.filter((r) => r.automatable === 'auto').length, flag: rows.filter((r) => r.automatable === 'flag-track').length, manual: rows.filter((r) => r.automatable === 'manual').length };

  // ---- markdown worklist ----
  const L = [`# Local citations worklist — ${cfg.brand}`, `${cfg.baseUrl} · ${new Date().toUTCString()}`, ''];
  if (!canonical) L.push(`> ⚠ **Tier 0 missing:** no canonical NAP set. Capture it (run \`onboard ${cfg.domain}\`), confirm it, and add \`listings.canonicalNap\` to the config. Everything below diffs against it.`, '');
  else L.push(`**Canonical NAP** — name: ${canonical.name || '?'} · phone: ${canonical.phone || '?'} · ${canonical.address || '?'} · ${canonical.url || cfg.baseUrl}`, '');
  L.push(`**Automation:** ${counts.auto} auto (bot) · ${counts.flag} flag-track (bot queues, human submits) · ${counts.manual} manual (human claims, bot monitors)`, '');
  L.push(`> ⛔ **Compliance guardrail:** the bot never automates incentivized / gated / in-lobby review solicitation (Google early-2026 suspension risk; FTC $4.2M gating fine). It may track review count/recency only.`, '');

  for (const tier of [1, 2, 3, 4, 5]) {
    const group = rows.filter((r) => r.tier === tier);
    if (!group.length) continue;
    L.push(`## ${TIER_LABELS[tier]}`, '');
    for (const r of group) {
      L.push(`- ${STATUS_ICON[r.status] || '☐'} **${r.name}** _(${r.free ? 'free' : 'paid'} · ${r.automatable})_`);
      if (r.url) L.push(`    - ${r.url}`);
      L.push(`    - NAP: ${r.napRule}`);
      L.push(`    - ${r.note}`);
    }
    L.push('');
  }
  L.push('---', '_Auto items (booking embed, on-site schema, NAP audit) are applied by the bot via the med-spa rule pack + apply adapters. Update `listings.targets[].status` in the config as you complete the manual/flag-track rows._');

  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'citations.md'), L.join('\n'));
  writeFileSync(join(dir, 'citations.json'), JSON.stringify({ client: cfg.name, baseUrl: cfg.baseUrl, generatedAt: nowIso(), canonicalNap: canonical, rows }, null, 2));

  log(`\n  Citations worklist — ${cfg.brand}`);
  log(`  ${rows.length} targets · ${counts.auto} auto · ${counts.flag} flag-track · ${counts.manual} manual`);
  if (!canonical) log(`  ⚠ No canonical NAP set — run \`onboard ${cfg.domain}\` and add listings.canonicalNap.`);
  for (const tier of [1, 2, 3, 4, 5]) {
    const g = rows.filter((r) => r.tier === tier);
    if (g.length) log(`    ${TIER_LABELS[tier]}: ${g.map((r) => `${STATUS_ICON[r.status] || '☐'}${r.name}`).join(', ')}`);
  }
  log(`\n  Worklist → ${join(dir, 'citations.md')}\n`);
  return rows;
}
