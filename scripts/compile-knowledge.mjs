#!/usr/bin/env node
// seo-bot · scripts/compile-knowledge — the knowledge→rules compiler (E8).
//
// Turns every research session into engine capability WITHOUT ever touching the engine:
//   1. scanClaims(dir)      — parse research/*.md for tagged lines (CLAIM: / EVIDENCE: / TIER:,
//                             tolerating **bold**, list-marker and inline one-line variants).
//                             A separate heuristic pass surfaces strong UNTAGGED candidates
//                             (effect size + a named source) — reported separately and
//                             NEVER auto-promoted into the claim pipeline.
//   2. buildEngineIndex()   — index what the engine ALREADY encodes: rules.mjs rule ids +
//                             messages, the tactics registry, the content hard gates, and
//                             guard functions (plan-cap / publish-throttle / fake-refresh /
//                             local-value …).
//   3. diffAgainstEngine()  — conservative token matching: a claim is only proposed as NEW
//                             when no existing rule/tactic/gate/guard shares the core concept.
//                             Deliberately prefers the false-negative "already covered" over
//                             duplicate proposals; unparseable claims and an incomplete engine
//                             index FAIL CLOSED (skipped, never proposed).
//   4. emitWorksheet()      — reports/knowledge-compile.md: proposed rule STUBS for HUMAN review.
//
// THE COMPILER NEVER WRITES src/rules.mjs OR src/tactics/registry.mjs ITSELF. A human approves
// each stub, then the rule lands BY HAND with a unit test + an evidence tier + a source pointer
// into research/ (no folklore rules).
//
//   node seo-bot/bin/seo-bot.mjs compile-knowledge [--dir research/] [--out reports/knowledge-compile.md]

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TACTICS } from '../src/tactics/registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// ---------------------------------------------------------------------------
// 1. Tag parsing
// ---------------------------------------------------------------------------
export const VALID_TIERS = ['high', 'medium', 'low'];

// Tolerates: `CLAIM: x`, `**CLAIM:** x`, `**CLAIM**: x`, `- CLAIM: x`, `> *CLAIM:* x` …
// Anchored so prose like "the claim: …" never matches (tag must lead the line, uppercase).
const TAG_RE = /^[\s>*+-]*(?:\*\*|__|\*|_)?(CLAIM|EVIDENCE|TIER)(?:\*\*|__|\*|_)?\s*:\s*(?:\*\*|__|\*|_)?\s*(.*)$/;

/** Split inline `… EVIDENCE: … TIER: …` segments out of a one-line CLAIM body. */
function splitInlineTags(body) {
  const parts = String(body).split(/\b(EVIDENCE|TIER)\s*:\s*/);
  const out = { claim: parts[0].trim().replace(/[—–:;,-]+\s*$/, '').trim(), evidence: null, tier: null };
  for (let i = 1; i < parts.length - 1; i += 2) {
    const val = (parts[i + 1] || '').trim();
    if (parts[i] === 'EVIDENCE') out.evidence = val.replace(/[—–:;,-]+\s*$/, '').trim();
    else out.tier = (val.split(/\s+/)[0] || '').trim();
  }
  return out;
}

// Heuristic untagged pass: a strong claim ≈ an effect size + a named source on one line.
const EFFECT_RE = /([+\-~]?\d+(?:\.\d+)?\s*%)|(\br\s*=\s*-?\s*(?:0?\.)?\d)|(\b\d+(?:\.\d+)?\s*[x×]\b)|(×\s*\d)/i;
const SOURCE_RE = /\(([^()]*[A-Z][A-Za-z]{2,}[^()]*)\)|according to\s+[A-Z]|\b(?:study by|found by|reported by|per)\s+[A-Z]/;
function untaggedSignals(line) {
  const s = String(line);
  if (s.trim().length < 30) return null; // too short to be a load-bearing claim
  if (!EFFECT_RE.test(s) || !SOURCE_RE.test(s)) return null;
  const sig = [];
  if (/%/.test(s)) sig.push('percentage');
  if (/\br\s*=/.test(s)) sig.push('correlation');
  if (/\b\d+(?:\.\d+)?\s*[x×]\b|×\s*\d/i.test(s)) sig.push('multiplier');
  sig.push('named-source');
  return sig;
}

/** Parse one markdown document. Pure. Returns { claims, malformed, untagged }.
 *  Malformed tags (empty CLAIM, invalid TIER value, orphan EVIDENCE/TIER) are
 *  SKIPPED + COUNTED — they never become claims (fail closed). */
export function parseClaimLines(text = '', file = '') {
  const claims = [], malformed = [], untagged = [];
  const lines = String(text).split(/\r?\n/);
  let lastClaim = null, lastClaimLine = -100, inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], n = i + 1;
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = raw.match(TAG_RE);
    if (!m) {
      const sig = untaggedSignals(raw);
      if (sig) untagged.push({ text: raw.trim(), file, line: n, signals: sig });
      continue;
    }
    const tag = m[1];
    const body = m[2].replace(/\*\*|__/g, '').trim().replace(/[*_]+\s*$/, '').trim();
    if (tag === 'CLAIM') {
      if (!body) { malformed.push({ file, line: n, tag, reason: 'empty-claim', raw: raw.trim() }); lastClaim = null; continue; }
      const inline = splitInlineTags(body);
      if (!inline.claim) { malformed.push({ file, line: n, tag, reason: 'empty-claim', raw: raw.trim() }); lastClaim = null; continue; }
      const claim = { claim: inline.claim, evidence: inline.evidence || '', tier: null, file, line: n };
      if (inline.tier != null) {
        const t = inline.tier.toLowerCase();
        if (VALID_TIERS.includes(t)) claim.tier = t;
        else malformed.push({ file, line: n, tag: 'TIER', reason: 'invalid-tier', raw: inline.tier });
      }
      claims.push(claim); lastClaim = claim; lastClaimLine = n;
      continue;
    }
    // EVIDENCE / TIER attach to the most recent CLAIM within a 6-line window; else orphan.
    if (!lastClaim || n - lastClaimLine > 6) { malformed.push({ file, line: n, tag, reason: 'orphan-tag', raw: raw.trim() }); continue; }
    if (tag === 'EVIDENCE') {
      if (!body) { malformed.push({ file, line: n, tag, reason: 'empty-evidence', raw: raw.trim() }); continue; }
      lastClaim.evidence = lastClaim.evidence ? `${lastClaim.evidence}; ${body}` : body;
      lastClaimLine = n;
    } else { // TIER
      const t = body.toLowerCase();
      if (!VALID_TIERS.includes(t)) { malformed.push({ file, line: n, tag, reason: 'invalid-tier', raw: raw.trim() }); continue; }
      lastClaim.tier = t; lastClaimLine = n;
    }
  }
  return { claims, malformed, untagged };
}

/** Recursively scan a directory of *.md files. Unreadable files/dirs are recorded
 *  in `errors` — never a crash, never silently dropped. */
export function scanClaims(dir) {
  const scanRoot = resolve(String(dir || join(ROOT, 'research')));
  const files = [], errors = [], claims = [], malformed = [], untagged = [];
  const rel = (p) => relative(ROOT, p).split(sep).join('/');
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch (e) { errors.push({ path: d, error: e.message }); return; }
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && /\.md$/i.test(ent.name)) {
        try {
          const r = parseClaimLines(readFileSync(p, 'utf-8'), rel(p));
          files.push(rel(p));
          claims.push(...r.claims);
          malformed.push(...r.malformed);
          untagged.push(...r.untagged.slice(0, 40)); // per-file cap keeps the worksheet sane
        } catch (e) { errors.push({ path: p, error: e.message }); }
      }
    }
  };
  walk(scanRoot);
  return { dir: scanRoot, files, claims, malformed, untagged, errors };
}

// ---------------------------------------------------------------------------
// 2. Engine index — what the engine already encodes
// ---------------------------------------------------------------------------
const STOPWORDS = new Set(('the a an and or of in on to for with without is are was were be been being it its this that these those not never only over under from by as at into out per our your their they them you we he she do does did done can could should would may might must will shall than then when where which who whom what how why all any each more most other some such own same just also but if so too very via i one two three new use used using page pages content').split(/\s+/));

/** Lowercase, split, drop stopwords/bare numbers, light plural stem. Returns a Set. */
export function tokenize(s) {
  const out = new Set();
  for (let w of String(s).toLowerCase().split(/[^a-z0-9]+/)) {
    if (!w || w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

const kebab = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function precedingComments(lines, i, max = 8) {
  const acc = [];
  for (let j = i - 1; j >= 0 && acc.length < max; j--) {
    const t = (lines[j] || '').trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) acc.unshift(t);
    else break;
  }
  return acc.join(' ');
}

/** Index the engine's existing capabilities: audit rule ids/messages (src/rules.mjs),
 *  tactics registry entries, content hard gates, and guard functions across src/.
 *  If a core source can't be read the index is marked `incomplete` → the differ
 *  FAILS CLOSED and proposes nothing (an incomplete index would mint duplicates). */
export function buildEngineIndex({ root = ROOT } = {}) {
  const byKey = new Map(), errors = [];
  const add = (id, kind, source, contextText) => {
    const key = `${kind}:${id}`;
    const toks = tokenize(`${String(id).replace(/-/g, ' ')} ${contextText || ''}`);
    if (byKey.has(key)) { for (const t of toks) byKey.get(key).tokens.add(t); return; }
    byKey.set(key, { id, kind, source, idTokens: [...tokenize(String(id).replace(/-/g, ' '))], tokens: toks });
  };
  const readSafe = (p) => { try { return readFileSync(p, 'utf-8'); } catch (e) { errors.push({ path: p, error: e.message }); return null; } };

  // 1. audit rules — every f('<id>', …) call in src/rules.mjs (id + same/next line as message context)
  const rulesPath = join(root, 'src', 'rules.mjs');
  const rulesSrc = readSafe(rulesPath);
  if (rulesSrc) {
    const lines = rulesSrc.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const re = /\bf\(\s*'([^']+)'/g; let m;
      while ((m = re.exec(lines[i]))) add(m[1], 'rule', `src/rules.mjs:${i + 1}`, `${lines[i]} ${lines[i + 1] || ''}`);
    }
  }

  // 2. tactics registry (static import of the pure module)
  for (const t of TACTICS) add(t.id, 'tactic', 'src/tactics/registry.mjs', `${t.name || ''} ${t.note || ''} ${t.feature || ''} ${t.effect || ''}`);

  // 3. content hard gates — hard['<id>'] in src/content/gates.mjs (+ preceding comment lines)
  const gatesPath = join(root, 'src', 'content', 'gates.mjs');
  const gatesSrc = readSafe(gatesPath);
  if (gatesSrc) {
    const lines = gatesSrc.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const re = /hard\['([^']+)'\]/g; let m;
      while ((m = re.exec(lines[i]))) add(m[1], 'gate', `src/content/gates.mjs:${i + 1}`, `${precedingComments(lines, i)} ${lines[i]}`);
    }
  }

  // 4. guard functions — exported functions anywhere in src/ whose doc comment reads like a guard
  //    (catches capProgrammatic / throttlePublish / isFakeRefresh and friends).
  const GUARD_HINT = /\bguards?\b|\bthrottl|\bcap\b|\bspam\b|\bveto|\bgate\b|\bjitter/i;
  const walkSrc = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch (e) { errors.push({ path: d, error: e.message }); return; }
    for (const ent of entries) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walkSrc(p);
      else if (ent.isFile() && ent.name.endsWith('.mjs')) {
        const src = readSafe(p);
        if (!src) continue;
        const rel = relative(root, p).split(sep).join('/');
        const lines = src.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/^export (?:async )?function ([A-Za-z_$][\w$]*)/);
          if (!m) continue;
          const comments = precedingComments(lines, i);
          if (comments && GUARD_HINT.test(comments)) add(kebab(m[1]), 'guard', `${rel}:${i + 1}`, comments);
        }
      }
    }
  };
  walkSrc(join(root, 'src'));

  const incomplete = !rulesSrc || !gatesSrc || !Array.isArray(TACTICS) || TACTICS.length === 0;
  return { concepts: [...byKey.values()], errors, incomplete };
}

// ---------------------------------------------------------------------------
// 3. Differ — conservative: prefer "already covered" over duplicate proposals
// ---------------------------------------------------------------------------
const SEVERITY_BY_TIER = { high: 'medium', medium: 'low', low: 'low' };

function stubFor(c) {
  const toks = [...tokenize(c.claim)];
  return {
    suggestedId: 'kb-' + toks.slice(0, 4).join('-'),
    severity: SEVERITY_BY_TIER[c.tier] || 'low', // suggestion only — a human sets the final severity
    evidenceTier: c.tier || 'unspecified',
    source: `${c.file || '(unknown)'}:${c.line ?? 0}`,
    draftMessage: c.claim,
    draftRecommendation: c.evidence
      ? `Encode after human review. Evidence: ${c.evidence}`
      : 'Encode after human review — attach an evidence tier + a source pointer into research/ first (no folklore rules).',
    claim: c,
  };
}

/** Diff claims against the engine index. A claim is COVERED when any existing concept's
 *  id tokens all appear in the claim (id-match) or ≥3 significant tokens overlap.
 *  Only unmatched claims become proposals. Fail-closed: empty/unparseable claims and an
 *  incomplete engine index are SKIPPED — never proposed. */
export function diffAgainstEngine(claims = [], engine = { concepts: [] }) {
  const covered = [], proposed = [], skipped = [];
  const concepts = Array.isArray(engine?.concepts) ? engine.concepts : [];
  const incomplete = !!engine?.incomplete || concepts.length === 0;
  for (const c of claims || []) {
    const text = c && typeof c.claim === 'string' ? c.claim : '';
    const ct = tokenize(text);
    if (!ct.size) { skipped.push({ claim: c, reason: 'unparseable-claim (fail closed: never proposed)' }); continue; }
    if (incomplete) { skipped.push({ claim: c, reason: 'engine-index-incomplete (fail closed: no proposals without a full engine index)' }); continue; }
    const matches = [];
    for (const k of concepts) {
      let overlap = 0;
      for (const t of k.tokens) if (ct.has(t)) overlap++;
      const idMatch = k.idTokens.length > 0 && k.idTokens.every((t) => ct.has(t)) && (k.idTokens.length >= 2 || overlap >= 2);
      if (idMatch || overlap >= 3) matches.push({ id: k.id, kind: k.kind, via: idMatch ? 'id-match' : `token-overlap:${overlap}`, overlap });
    }
    if (matches.length) {
      matches.sort((a, b) => ((b.via === 'id-match') - (a.via === 'id-match')) || (b.overlap - a.overlap));
      covered.push({ claim: c, matchedBy: matches.slice(0, 8) });
    } else proposed.push(stubFor(c));
  }
  return { covered, proposed, skipped };
}

// ---------------------------------------------------------------------------
// 4. Worksheet — for HUMAN review; the compiler never writes the engine
// ---------------------------------------------------------------------------
export function emitWorksheet({ scan = {}, diff = {}, untagged = [], engine = {}, outPath }) {
  const out = outPath || join(ROOT, 'reports', 'knowledge-compile.md');
  const claims = scan.claims || [], malformed = scan.malformed || [];
  const covered = diff.covered || [], proposed = diff.proposed || [], skipped = diff.skipped || [];
  const L = [];
  L.push('# Knowledge → rules compile worksheet');
  L.push('');
  L.push('> **HUMAN REVIEW REQUIRED — THE COMPILER NEVER WRITES `src/rules.mjs` OR `src/tactics/registry.mjs` ITSELF.**');
  L.push('> A human approves each proposed stub below; approved rules then land BY HAND with a unit test,');
  L.push('> an evidence tier, and a source pointer into `research/` (no folklore rules). Nothing in this file');
  L.push('> is ever applied automatically.');
  L.push('');
  L.push(`Generated ${new Date().toUTCString()} · scanned \`${scan.dir || '(unknown)'}\``);
  L.push('');
  L.push('## Summary');
  L.push(`- research files scanned: ${(scan.files || []).length}`);
  L.push(`- tagged claims: ${claims.length}`);
  L.push(`- already covered by the engine: ${covered.length}`);
  L.push(`- proposed NEW rule stubs: ${proposed.length}`);
  L.push(`- skipped (fail-closed): ${skipped.length}`);
  L.push(`- malformed tags (skipped + counted): ${malformed.length}`);
  L.push(`- untagged candidates (heuristic; NEVER auto-promoted): ${untagged.length}`);
  L.push(`- engine concepts indexed: ${(engine.concepts || []).length}${engine.incomplete ? ' — ⚠ INDEX INCOMPLETE → proposals suppressed (fail closed)' : ''}`);
  L.push('');

  L.push(`## Proposed rule stubs (${proposed.length}) — approve, then land by hand`);
  if (!proposed.length) L.push('_None. Every tagged claim is already covered by an existing rule/tactic/gate/guard (or was skipped fail-closed)._');
  proposed.forEach((p, i) => {
    L.push(`### ${i + 1}. \`${p.suggestedId}\``);
    L.push(`- severity (suggested): ${p.severity}`);
    L.push(`- evidenceTier: ${p.evidenceTier}`);
    L.push(`- source: ${p.source}`);
    L.push(`- draft message: ${p.draftMessage}`);
    L.push(`- draft recommendation: ${p.draftRecommendation}`);
    L.push('');
  });
  L.push('');

  L.push(`## Already covered (${covered.length}) — no duplicate proposals`);
  for (const c of covered.slice(0, 100)) L.push(`- ${c.claim.file}:${c.claim.line} — "${c.claim.claim.slice(0, 140)}" → ${c.matchedBy.map((m) => `\`${m.id}\`(${m.kind}, ${m.via})`).join(', ')}`);
  if (covered.length > 100) L.push(`- … +${covered.length - 100} more`);
  L.push('');

  L.push(`## Skipped — fail-closed (${skipped.length})`);
  for (const s of skipped.slice(0, 50)) L.push(`- ${s.claim?.file || '?'}:${s.claim?.line ?? '?'} — ${s.reason}`);
  L.push('');

  L.push(`## Malformed tags — skipped + counted (${malformed.length})`);
  for (const m of malformed.slice(0, 50)) L.push(`- ${m.file}:${m.line} [${m.tag}] ${m.reason} — \`${String(m.raw || '').slice(0, 100)}\``);
  L.push('');

  L.push(`## Untagged candidates (${untagged.length}) — heuristic only, NEVER auto-promoted`);
  L.push('_To enter the pipeline, tag the line explicitly with `CLAIM:` / `EVIDENCE:` / `TIER:` in the research file._');
  for (const u of untagged.slice(0, 100)) L.push(`- ${u.file}:${u.line} [${(u.signals || []).join('+')}]${u.likelyCovered ? ' (likely already covered)' : ''} — "${u.text.slice(0, 160)}"`);
  if (untagged.length > 100) L.push(`- … +${untagged.length - 100} more`);
  L.push('');

  if ((scan.errors || []).length || (engine.errors || []).length) {
    L.push('## Read errors (recorded, not swallowed)');
    for (const e of [...(scan.errors || []), ...(engine.errors || [])].slice(0, 20)) L.push(`- ${e.path}: ${e.error}`);
    L.push('');
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, L.join('\n'));
  return out;
}

// ---------------------------------------------------------------------------
// Orchestrator (CLI entry)
// ---------------------------------------------------------------------------
export async function compileKnowledge({ dir, out, log = () => {} } = {}) {
  const scan = scanClaims(dir ? resolve(String(dir)) : join(ROOT, 'research'));
  const engine = buildEngineIndex();
  const diff = diffAgainstEngine(scan.claims, engine);
  const untagged = scan.untagged.map((u) => ({
    ...u,
    likelyCovered: diffAgainstEngine([{ claim: u.text, file: u.file, line: u.line }], engine).covered.length === 1,
  }));
  const outPath = out ? resolve(String(out)) : join(ROOT, 'reports', 'knowledge-compile.md');
  emitWorksheet({ scan, diff, untagged, engine, outPath });
  log(`  compile-knowledge: ${scan.files.length} research files → ${scan.claims.length} tagged claims`);
  log(`  covered: ${diff.covered.length} · proposed NEW: ${diff.proposed.length} · skipped (fail-closed): ${diff.skipped.length} · malformed tags: ${scan.malformed.length} · untagged candidates: ${untagged.length}`);
  if (engine.incomplete) log('  ⚠ engine index incomplete — ALL proposals suppressed (fail closed)');
  log(`  → ${outPath}  (HUMAN worksheet — the compiler never writes rules.mjs or the registry)`);
  return { scan, engine, diff, untagged, outPath };
}
