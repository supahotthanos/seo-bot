// seo-bot · offsite/worksheet — the ONE consolidated human worksheet for everything
// off-page that is NOT mechanically executable. Each row is a SINGLE human action
// (send / submit / paste / pay) with the content pre-drafted and compliance-checked.
// The bot drafts; the human executes. Sending outreach, submitting listings, posting
// review replies, and paying for placements stay human FOREVER (see AGENTS.md gates +
// FTC 16 CFR 465). Rows are designed to absorb rows from other offsite modules
// (mention-gap / newsroom / listicle-radar) via the same shape when those are wired.
//
// Row shape: { id, action: 'send'|'submit'|'paste'|'pay', target, url, content,
//              compliance: { checked, ok, violations[] }, why, tier }

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';

export const HUMAN_ACTIONS = new Set(['send', 'submit', 'paste', 'pay']);

// Dashboard-contract-style tier stamp: paying is always 'red' (money, irreversible);
// sending/submitting/pasting pre-checked content is 'amber' (mild approve, human executes).
export function tierForAction(action) { return action === 'pay' ? 'red' : 'amber'; }

/**
 * The honest "no gate applies" compliance status. ONLY for rows whose content is derived
 * deterministically from operator-owned config (canonical NAP, registry URLs — no free
 * text, nothing scraped or generated). checked stays FALSE — no gate ran — and the row is
 * actionable because there is genuinely nothing to gate. Anything with free-text, scraped,
 * or model-generated content must run a REAL gate and carry that gate's checked:true result;
 * stamping checked:true without a gate is fabricating a pass.
 */
export function complianceNotApplicable(why) {
  return { checked: false, ok: false, notApplicable: String(why || 'deterministic config-derived payload — no free-text content to gate'), violations: [] };
}

/** Is this compliance object actionable? Either a REAL gate ran and passed, or the row is
 *  explicitly declared not-applicable (config-derived). Everything else — including a
 *  fabricated {checked:false, ok:true} — is rejected (fail closed). */
export function complianceActionable(comp) {
  if (!comp || typeof comp !== 'object') return false;
  if (comp.checked === true && comp.ok === true) return true; // a gate actually ran and passed
  if (comp.checked === false && typeof comp.notApplicable === 'string' && comp.notApplicable.trim()) return true;
  return false;
}

/**
 * Gate content SCRAPED FROM EXTERNAL PAGES (NAP-drift observations etc.) before it may
 * land on the human worksheet. Deterministic sanitize-or-refuse: control characters
 * stripped, HTML tags removed, whitespace collapsed, length clamped; active-content
 * patterns (script / js-URIs / inline handlers) or empty/non-string input REFUSE
 * (fail closed — external pages are untrusted input).
 * @returns {{ok:boolean, sanitized:string, violations:Array<{why:string}>}}
 */
export function gateScrapedContent(text, { maxLen = 600 } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, sanitized: '', violations: [{ why: 'empty/non-string scraped content — fail closed' }] };
  }
  const violations = [];
  const ACTIVE = /<\s*script|javascript\s*:|vbscript\s*:|data:text\/html|on\w+\s*=\s*["']/i;
  if (ACTIVE.test(text)) {
    violations.push({ why: 'active-content pattern in scraped text (script / js-URI / inline handler) — refused' });
  }
  // Strip to a FIXPOINT: control-char removal DELETES characters (markup becomes a space,
  // which can never glue a pattern together) — so a NUL-split js-URI that passes the raw
  // check above REASSEMBLES here and must be re-checked on the stripped output.
  let s = text;
  for (let prev = null, i = 0; s !== prev && i < 10; i++) {
    prev = s;
    s = s
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')  // control chars
      .replace(/<[^>]*>/g, ' ');                                     // strip any markup
  }
  // Re-check AFTER stripping: the sanitized output must itself pass the gate (fail closed).
  if (!violations.length && ACTIVE.test(s)) {
    violations.push({ why: 'active-content pattern reassembled after sanitization (control-char-split js-URI / handler) — refused' });
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + '…';
  if (!s) violations.push({ why: 'nothing left after sanitization — fail closed' });
  return { ok: violations.length === 0, sanitized: violations.length ? '' : s, violations };
}

/** Normalize + validate one worksheet row. Fail closed: invalid action/empty content → null (dropped LOUDLY by caller). */
export function makeRow({ id, action, target, url = null, content = '', compliance = null, why = '' }) {
  if (!HUMAN_ACTIONS.has(action)) return null;
  if (!target) return null;
  const comp = compliance && typeof compliance === 'object'
    ? compliance
    : { checked: false, ok: false, violations: [{ why: 'compliance not checked — fail closed' }] };
  return { id, action, target, url, content, compliance: comp, why, tier: tierForAction(action) };
}

/**
 * Consolidate all human-action rows into ONE worksheet (md + json).
 * Non-compliant rows are listed in a separate REJECTED section — never as actionable.
 */
export function consolidateWorksheet(cfg, rowsIn = [], { rejected = [], writeFiles = true, log = () => {} } = {}) {
  const rows = [];
  const dropped = [];
  let n = 0;
  for (const r of rowsIn) {
    const row = makeRow({ id: r.id || `offsite-${++n}`, ...r });
    if (!row) { dropped.push({ input: r, reason: 'invalid row (action/target) — dropped, shown here so it is never silent' }); continue; }
    // Actionable ONLY when a REAL gate ran and passed (checked:true && ok:true) or the row
    // is explicitly declared not-applicable (deterministic config-derived content). A row
    // that merely CLAIMS ok without a gate — e.g. {checked:false, ok:true} — is rejected.
    if (!complianceActionable(row.compliance)) { dropped.push({ input: { id: row.id, target: row.target }, reason: 'failed compliance (or no gate ran) — moved to REJECTED', violations: row.compliance.violations }); continue; }
    rows.push(row);
  }

  const L = [`# Off-page worksheet — ${cfg.brand}`, `${cfg.baseUrl} · ${new Date().toUTCString()}`, '', `Every row = ONE human action. Content is pre-drafted + compliance-checked. The bot never sends/submits/posts/pays.`, ''];
  for (const action of ['submit', 'paste', 'send', 'pay']) {
    const g = rows.filter((r) => r.action === action);
    if (!g.length) continue;
    L.push(`## ${action.toUpperCase()} (${g.length})${action === 'pay' ? ' — owner approval required (tier: red)' : ''}`, '');
    for (const r of g) {
      L.push(`- [ ] **${r.target}**${r.url ? ` — ${r.url}` : ''} _(tier: ${r.tier})_`);
      if (r.why) L.push(`    - why: ${r.why}`);
      if (r.content) L.push(`    - content: ${String(r.content).split('\n').join(' ⏎ ').slice(0, 500)}`);
    }
    L.push('');
  }
  const allRejected = [...rejected, ...dropped];
  if (allRejected.length) {
    L.push(`## REJECTED — not actionable (${allRejected.length})`, '');
    for (const r of allRejected) L.push(`- ⛔ ${r.input?.target || r.target || '?'} — ${r.reason || 'failed compliance'}${r.violations?.length ? ` (${r.violations.map((v) => v.why).join('; ')})` : ''}`);
    L.push('');
  }
  L.push('---', '_Stays human: sending outreach, review solicitation (NEVER automated), wire submissions, paying, posting replies, YMYL approval._');

  let mdPath = null;
  if (writeFiles) {
    const dir = join(ROOT, 'reports', cfg.name);
    mkdirSync(dir, { recursive: true });
    // DISTINCT FILE, cross-referenced: E2's `offsite` command writes its own
    // offsite-mentions-worksheet.{md,json} (mention-gap / listicle / newsroom targets).
    // The two worksheets coexist — running either command never clobbers the other's
    // pending human actions; each file points at its companion.
    const hasMentions = existsSync(join(dir, 'offsite-mentions-worksheet.md'));
    if (hasMentions) L.push('', '_Companion worksheet: [offsite-mentions-worksheet.md](offsite-mentions-worksheet.md) — off-domain mention/listicle/newsroom targets from the `offsite` command (separate file, nothing merged or overwritten)._');
    mdPath = join(dir, 'offsite-worksheet.md');
    writeFileSync(mdPath, L.join('\n'));
    writeFileSync(join(dir, 'offsite-worksheet.json'), JSON.stringify({ client: cfg.name, generatedAt: nowIso(), companion: hasMentions ? 'offsite-mentions-worksheet.json' : null, rows, rejected: allRejected }, null, 2));
  }
  log(`  Worksheet: ${rows.length} human actions (${rows.filter((r) => r.action === 'pay').length} pay/red) · ${allRejected.length} rejected${mdPath ? ` → ${mdPath}` : ''}`);
  return { rows, rejected: allRejected, mdPath };
}
