// seo-bot · integrity — the hard guards that make the bot-only SILENT-FAILURE modes
// impossible (from the 56-agent bot-vs-human analysis). Each function turns a "looks fine,
// is actually wrong" failure into a loud, blocking signal:
//   • fabricated authority  → verifyReviewer(): a byline must match a real, configured reviewer
//   • silent small-n numbers → confidenceGate(): suppress client-facing numbers below min sample
//   • irreversible mistakes  → guardIrreversible(): 301 / disavow / IA / delete need explicit confirm
//   • confident "all green"   → coverageHonesty(): never assert "no issues" beyond what was actually checked
// These are deterministic and always-on (no LLM, no key) so they can't fail open.

// ---- Fabricated-authority guard ---------------------------------------------------------
const CREDS = /\b(MD|DO|NP|PA|RN|RD|FNP|PA-C|DNP|DMSc|MBBS|MSN)\b/i;

export function parseReviewer(text = '') {
  const m = text.match(/medically reviewed by\s+([^\n]{2,80})/i);
  if (!m) return null;
  // Strip a leading title (its period would otherwise look like a sentence end).
  let chunk = m[1].replace(/^\s*(dr|mr|mrs|ms|prof)\.?\s+/i, '').trim();
  let name, credentials = '';
  const comma = chunk.indexOf(',');
  if (comma >= 0) { name = chunk.slice(0, comma).trim(); credentials = chunk.slice(comma + 1).split(/[.\n]/)[0].trim(); }
  else { name = chunk.split(/[.\n]/)[0].trim(); }
  name = name.replace(/\s+(MD|DO|NP|PA|RN|RD|FNP|DNP|PA-C)\b.*$/i, '').replace(/\s+/g, ' ').trim();
  return { name, credentials };
}

const normName = (s = '') => s.toLowerCase()
  .replace(/\b(dr|mr|mrs|ms|prof)\.?\b/g, '')
  .replace(CREDS, '')
  .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

// A medical reviewer must be a named INDIVIDUAL — never a team/clinic/editorial entity.
const NON_PERSON = /\b(team|staff|editorial|content|aesthetics|clinic|group|associates|center|spa|institute|practice)\b/i;
// Multi-letter name tokens only (drop single-letter middle initials like "Q").
const nameTokens = (s = '') => new Set(normName(s).split(' ').filter((w) => w.length > 1));

/**
 * Verify a content byline against the agency's registry of REAL reviewers (cfg.reviewers).
 * Returns { present, verified: true|false|null, name, issue }.
 *  - verified:true  → byline matches a configured, credentialed reviewer
 *  - verified:false → byline names someone NOT in the registry → likely fabricated authority (BLOCK)
 *  - verified:null  → no registry configured → cannot verify (warn, don't block — back-compat)
 */
export function verifyReviewer(text = '', reviewers = []) {
  const parsed = parseReviewer(text);
  if (!parsed) return { present: false, verified: false, issue: 'no "medically reviewed by <Name>, <Credential>" byline found' };
  // A non-person "reviewer" (team/clinic/editorial) is never valid, registry or not.
  if (NON_PERSON.test(parsed.name)) return { present: true, verified: false, name: parsed.name, issue: `byline names a non-person ("${parsed.name}") — a medical reviewer must be a named individual` };
  const T = nameTokens(parsed.name);
  if (!T.size) return { present: true, verified: false, name: parsed.name, issue: `could not parse a real reviewer name from "${parsed.name}"` };
  if (!reviewers?.length) return { present: true, verified: null, name: parsed.name, issue: 'no reviewer registry (cfg.reviewers) — byline is UNVERIFIED; configure real reviewers to enforce' };
  // Token-SET equality (modulo middle initials): rejects substring/superset impostors like
  // registry "Lee" vs byline "Charlie Leeson", or "Jane Doe" vs "Jane Doe Aesthetics".
  const match = (reviewers || []).find((r) => {
    const R = nameTokens(r.name || '');
    if (!R.size) return false;
    return [...R].every((t) => T.has(t)) && [...T].every((t) => R.has(t));
  });
  if (!match) return { present: true, verified: false, name: parsed.name, issue: `byline "${parsed.name}" is NOT in the verified-reviewer registry — fabricated-authority risk; refuse to publish` };
  return { present: true, verified: true, name: parsed.name, matched: match.name, credentials: match.credentials || parsed.credentials };
}

// ---- Silent small-n guard ---------------------------------------------------------------
/**
 * Gate a client-facing number behind a minimum sample size. A P50 forecast or conversion
 * rate computed on n<minN noisy days looks authoritative and is usually wrong — suppress it.
 */
export function confidenceGate(value, n, { minN = 14, label = 'metric' } = {}) {
  const sample = Number.isFinite(Number(n)) ? Number(n) : 0; // Infinity/NaN must fail closed
  if (sample < minN) return { show: false, value, n: sample, label, caveat: `not enough data (n=${sample} < ${minN}) — withheld from client to avoid a confident-but-wrong number` };
  return { show: true, value, n: sample, label };
}

// ---- Irreversible-action guard ----------------------------------------------------------
export const IRREVERSIBLE = new Set(['301-redirect', 'disavow', 'ia-restructure', 'delete-page', 'canonical-merge', 'noindex']);

/**
 * Gate an irreversible action: it may only proceed with explicit confirmation, and the
 * caller must have recorded a reversible snapshot + an impact note first.
 */
export function guardIrreversible(kind, { confirm = false, hasSnapshot = false, impact = '' } = {}) {
  const irreversible = IRREVERSIBLE.has(kind);
  const allowed = !irreversible || (confirm && hasSnapshot);
  const reasons = [];
  if (irreversible && !confirm) reasons.push('needs explicit confirmation (--yes)');
  if (irreversible && !hasSnapshot) reasons.push('needs a reversible snapshot in the change-ledger first');
  return { kind, irreversible, allowed, blocked: irreversible && !allowed, reasons, note: irreversible ? `IRREVERSIBLE (${kind}): ${impact || 'review impact before proceeding'}` : '' };
}

// ---- Anti-"all green" honesty guard -----------------------------------------------------
/**
 * Never let the bot assert "no issues" beyond what it actually inspected. Given what was
 * checked vs the full surface, returns an honest coverage statement (the confident clean
 * report that masks a novel bug is the most dangerous false negative).
 */
export function coverageHonesty({ checked = 0, total = 0, rendered = false, surfaces = [] } = {}) {
  const c = total ? Math.min(checked, total) : checked; // never claim >100% coverage
  const pct = total ? Math.round((c / total) * 100) : 0;
  const complete = total > 0 && c >= total && rendered;
  return {
    complete,
    coveragePct: pct,
    statement: complete
      ? `Checked all ${total} known surfaces (incl. rendered DOM).`
      : `Checked ${checked}/${total || '?'} surfaces${rendered ? '' : ' (raw HTML only — JS-rendered + novel issues NOT covered)'}. "No issues found" means "none in what was inspected", not "the site is healthy".`,
    notCovered: surfaces.filter((s) => !s.checked).map((s) => s.name),
  };
}
