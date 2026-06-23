// seo-bot · apply/dryrun — the safe default. Writes an "intended changes" file
// and changes nothing. Use this for any site before you trust the write path.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';

export async function applyDryrun(cfg, data, { log = () => {} } = {}) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'intended-changes.md');
  const L = [`# Intended changes (DRY RUN) — ${cfg.brand}`, `${data.proposals.length} proposals · nothing was modified.`, ''];
  for (const p of data.proposals) {
    L.push(`- [${p.autoApplicable ? 'auto' : 'manual'}] **${p.type}** on ${p.page}`);
    L.push(`    now: ${String(p.current).slice(0, 120)}`);
    L.push(`    -> ${String(p.proposed).slice(0, 200)}`);
  }
  writeFileSync(file, L.join('\n'));
  log(`  Dry run — intended changes written to ${file}`);
  return { applied: [], dryrun: true, file };
}
