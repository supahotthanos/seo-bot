// seo-bot · stats/controller — the batch decision runner. Evaluates many applied
// changes at once, applies Benjamini-Hochberg FDR across the batch (testing N pages
// at alpha=0.05 manufactures ~N*0.05 false winners), then renders a four-way verdict
// per change and persists it to decisions.ndjson (the agency's own growing evidence base).
//
// Each change record: { id, page, before:{clicks,impressions}, after:{...},
//   control?:{before,after}, days, guardrail?:{before,after}, lockedHorizonDate? }

import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';
import { twoProportionZTest, differenceInDifferences, bhReject } from './significance.mjs';
import { decideChange } from './feedback.mjs';

/** p-value for a single change (DiD if a control is supplied, else two-proportion). */
function pValueFor(c, alpha) {
  if (!c.before || !c.after) return 1;
  if (c.control?.before && c.control?.after) return differenceInDifferences(c.before, c.after, c.control.before, c.control.after).pValue;
  const t = twoProportionZTest(c.before.clicks, c.before.impressions, c.after.clicks, c.after.impressions, alpha);
  return t.ok ? t.pValue : 1;
}

/** Evaluate a batch with FDR control. Returns a verdict per change. */
export function evaluateBatch(changes, { opts = {} } = {}) {
  const alpha = opts.alpha || 0.05;
  const pvals = changes.map((c) => pValueFor(c, alpha));
  const reject = bhReject(pvals, opts.fdrQ || 0.05);
  return changes.map((c, i) => {
    // measure/geogridSeries pass through so map-pack-tagged changes (src/local/factors.mjs)
    // are refused a keep/revert from organic data inside decideChange (wrong metric source).
    const d = decideChange({ before: c.before, after: c.after, control: c.control, days: c.days || 0, guardrail: c.guardrail, measure: c.measure || null, geogridSeries: c.geogridSeries || null, opts: { ...opts, fdrPassed: reject[i], lockedHorizonDate: c.lockedHorizonDate, nowMs: opts.nowMs } });
    // the measure tag rides into decisions.ndjson so downstream consumers (buildPriors,
    // canAutoPromote) can also recognize and exclude map-pack rows (defense in depth).
    return { id: c.id, page: c.page, ...d, pValue: pvals[i], passedFDR: reject[i], ...(c.measure ? { measure: c.measure } : {}) };
  });
}

/** Run + persist verdicts. */
export function runController(client, changes, { log = () => {}, opts = {} } = {}) {
  const verdicts = evaluateBatch(changes, { opts });
  const dir = join(ROOT, 'reports', client);
  mkdirSync(dir, { recursive: true });
  for (const v of verdicts) appendFileSync(join(dir, 'decisions.ndjson'), JSON.stringify({ ...v, at: nowIso() }) + '\n');
  const tally = verdicts.reduce((m, v) => { m[v.decision] = (m[v.decision] || 0) + 1; return m; }, {});
  log(`  controller: ${verdicts.length} changes (BH-FDR q=${opts.fdrQ || 0.05}) → ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  for (const v of verdicts) log(`    [${v.decision}] ${v.page || v.id}: ${v.reason}`);
  return verdicts;
}
