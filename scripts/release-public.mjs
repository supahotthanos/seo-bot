#!/usr/bin/env node
// seo-bot · release-public — rebuild the PUBLIC sanitized snapshot (supahotthanos/seo-bot)
// from this private tree, by ALLOWLIST. Blocklists rot; the only safe sanitizer is "copy
// exactly what is named here, then scan what was staged."
//
// Policy (CLAUDE.md + INFRASTRUCTURE.md): the public repo NEVER gets harvested data, client
// intel, contracts, secrets, operator/engine intelligence, corpus, or live reports. Code,
// tests, store contract, generic playbooks, and example configs only.
//
// Usage: node scripts/release-public.mjs <path-to-public-clone> [--version vX.Y.Z]
//   1) wipes everything in the clone except .git
//   2) copies the allowlist from this repo
//   3) scrubs the STAGED tree (secret patterns + forbidden path fragments) — violation = exit 1
//   4) prints the summary; committing/pushing stays a HUMAN/CALLER step (review the diff first)

import { cpSync, rmSync, readdirSync, mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = process.argv[2];
const version = (process.argv.includes('--version') ? process.argv[process.argv.indexOf('--version') + 1] : null) || 'v0.3.0';
if (!dest || !existsSync(join(dest, '.git'))) { console.error('usage: release-public.mjs <path-to-public-clone> — target must be a git clone'); process.exit(1); }

const TOP_FILES = ['README.md', 'QUICKSTART.md', 'SETUP.md', 'AGENTS.md', 'ARCHITECTURE-SAAS.md', 'BLOG-KIT.md', 'LICENSE', 'package.json', 'package-lock.json', '.gitignore'];
const DIRS = ['bin', 'src', 'test', 'store', 'scraper'];
const SCRIPTS_EXCLUDE = new Set(['ghl-session.mjs']); // auth-mechanism operational glue — private
const CONFIG_FILES = ['_e2e.json', 'example.client.json', 'source-trust.json'];
const REPORTS_FILES = ['_e2e/run-latest.json'];
// The established public research set (v0.2.0) + later GENERIC additions. Operator deep-dives,
// engine/system-prompt intel, blog-corpus, serp-playbook, and anything client-specific stay private.
const RESEARCH_FILES = [
  'aeo-deep-research-2026.md', 'aeo-pioneer-tactics.md', 'ai-observation-stealth-2026.md',
  'fanout-extraction-2026.md', 'local-ranking-factors-2026.md', 'medspa-ein-aeo-playbook.md',
  'medspa-funnelhack-2026.md', 'medspa-seo-framework.md', 'seo-aeo-master-playbook-2026.md',
  'seo-automation-landscape-2026.md', 'spam-update-impact-2026.md', 'superlative-wires.md',
  'winning-site-teardowns.md', 'founder-google-runbook.md',
];

// Anything staged whose PATH matches one of these is a policy breach — hard fail. Patterns are
// DATA-directory-anchored: the code modules (src/measure/query-bank*.mjs, src/content/
// blog-corpus.mjs) are public; the harvested artifacts under research/ + reports/ never are.
const FORBIDDEN_PATH = /(research\/(blog-corpus|serp-playbook|operators)\b|reports\/query-bank\b|system-prompt-intel|all-spas|^contracts\b|sales-playbook|\.local\.json$|\.env$|^secrets\b)/i;
// Secret-shaped CONTENT anywhere in the staged tree — hard fail.
const SECRET_RE = /(xoxb-[A-Za-z0-9-]{10,}|sk-ant-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{30,})/;

// 1) wipe (keep .git)
for (const n of readdirSync(dest)) { if (n === '.git') continue; rmSync(join(dest, n), { recursive: true, force: true }); }

// 2) copy the allowlist
const copied = [];
const copy = (relPath) => {
  const from = join(SRC, relPath), to = join(dest, relPath);
  if (!existsSync(from)) { console.warn(`  ⚠ allowlisted but missing: ${relPath}`); return; }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  copied.push(relPath);
};
for (const f of TOP_FILES) copy(f);
for (const d of DIRS) copy(d);
for (const n of readdirSync(join(SRC, 'scripts'))) { if (!SCRIPTS_EXCLUDE.has(n)) copy(join('scripts', n)); }
for (const f of CONFIG_FILES) copy(join('config', f));
for (const f of REPORTS_FILES) copy(join('reports', f));
for (const f of RESEARCH_FILES) copy(join('research', f));

// 3) scrub the STAGED tree
const violations = [];
const walk = (dir) => {
  for (const n of readdirSync(dir)) {
    if (n === '.git') continue;
    const p = join(dir, n);
    const rel = relative(dest, p).replace(/\\/g, '/'); // normalize for the pattern on every OS
    if (FORBIDDEN_PATH.test(rel)) { violations.push(`forbidden path: ${rel}`); continue; }
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (statSync(p).size > 5 * 1024 * 1024) { violations.push(`oversized file (data smuggling?): ${rel}`); continue; }
    try {
      const body = readFileSync(p, 'utf-8');
      const m = body.match(SECRET_RE);
      if (m) violations.push(`secret-shaped content in ${rel}: ${m[0].slice(0, 12)}…`);
    } catch { /* binary — size-capped above */ }
  }
};
walk(dest);
if (violations.length) {
  console.error(`\n✗ SANITIZATION FAILED — nothing should be pushed:\n${violations.map((v) => `  - ${v}`).join('\n')}`);
  process.exit(1);
}

writeFileSync(join(dest, 'VERSION'), `${version}\n`);
console.log(`\n✓ public snapshot staged (${version}) — ${copied.length} allowlist entries, scrub clean.`);
console.log('  Review: cd <clone> && git status && git diff --stat');
console.log('  Then:   git add -A && git commit -m "<version> sanitized snapshot" && git push');
