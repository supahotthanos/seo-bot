// seo-bot · apply/nextjs — apply fixes to a Next.js repo you control and open a PR.
//
// Two kinds of proposal payloads are auto-applied:
//   • patch:     { file, find, replace }   — exact, unique find/replace in a source file
//   • fileWrite: { path, content }         — create/overwrite a file (e.g., robots/sitemap)
// Templated/per-URL content fixes that can't be safely located are committed as a
// review doc for the web-dev team instead. ALL writes are gated behind --yes, and
// land on a fresh branch + PR — never a direct push to the default branch.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, isAbsolute, resolve, dirname, sep } from 'node:path';
import { ROOT } from '../config.mjs';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function has(cmd) {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

export async function applyNextjs(cfg, data, { log = () => {}, confirm = false } = {}) {
  const repoPath = cfg.cms.repoPath === '.' || !cfg.cms.repoPath ? ROOT : (isAbsolute(cfg.cms.repoPath) ? cfg.cms.repoPath : resolve(ROOT, cfg.cms.repoPath));
  if (!existsSync(join(repoPath, '.git'))) { log(`  ⚠ ${repoPath} is not a git repo; cannot open a PR. Falling back to dry run.`); const { applyDryrun } = await import('./dryrun.mjs'); return applyDryrun(cfg, data, { log }); }

  const patches = data.proposals.filter((p) => p.patch || p.fileWrite);
  const previews = [];
  for (const p of patches) {
    if (p.fileWrite) {
      const wp = p.fileWrite.path;
      const dest = wp && isAbsolute(wp) ? wp : join(repoPath, wp || '');
      const root = resolve(repoPath); const safe = resolve(dest);
      const contained = !!wp && (safe === root || safe.startsWith(root + sep)); // block ../../ traversal
      previews.push({ p, kind: 'write', ok: contained && p.fileWrite.content != null, reason: !wp ? 'missing path' : !contained ? 'path escapes repo' : p.fileWrite.content == null ? 'missing content' : '', path: wp });
      continue;
    }
    const file = isAbsolute(p.patch.file) ? p.patch.file : join(repoPath, p.patch.file);
    if (!existsSync(file)) { previews.push({ p, kind: 'patch', ok: false, reason: 'file not found', path: p.patch.file }); continue; }
    const src = readFileSync(file, 'utf-8');
    const occurrences = src.split(p.patch.find).length - 1;
    previews.push({ p, kind: 'patch', ok: occurrences === 1, reason: occurrences === 0 ? 'find not present' : occurrences > 1 ? `find matches ${occurrences}×` : '', path: p.patch.file, file });
  }
  const applicable = previews.filter((x) => x.ok);

  log(`  ${patches.length} patch payloads (${applicable.length} apply cleanly); ${data.proposals.length - patches.length} advisory proposals for review.`);
  if (!confirm) {
    for (const x of previews) log(`    ${x.ok ? '✓' : '✗'} ${x.kind} ${x.path}${x.reason ? ` — ${x.reason}` : ''}`);
    log(`  Preview only. Re-run with --yes to apply on a new branch + PR.`);
    return { applied: [], previews, dryrun: true };
  }

  // --- execute: branch, apply, commit, (push + PR) ---
  const stamp = (data.ranAt || new Date().toISOString()).replace(/[^A-Za-z0-9-]/g, '-'); // git-ref-safe; tolerate missing ranAt
  const branch = `${cfg.cms.branchPrefix || 'seo-bot/'}${stamp}`;
  const baseBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  // Warn (don't block) if the tree is dirty — we stage ONLY our own files, so unrelated changes
  // can never land in the PR, but the operator should know they're present (esp. repoPath===ROOT).
  const dirtyCount = git(['status', '--porcelain'], repoPath).split('\n').filter(Boolean).length;
  if (dirtyCount) log(`  ℹ working tree has ${dirtyCount} unrelated change(s); staging ONLY the ${applicable.length} file(s) seo-bot edits.`);

  git(['checkout', '-b', branch], repoPath);
  const changedFiles = [];
  try {
    for (const x of applicable) {
      if (x.kind === 'write') {
        const dest = isAbsolute(x.p.fileWrite.path) ? x.p.fileWrite.path : join(repoPath, x.p.fileWrite.path);
        const root = resolve(repoPath); const safe = resolve(dest);
        if (safe !== root && !safe.startsWith(root + sep)) throw new Error(`fileWrite path escapes repo: ${x.p.fileWrite.path}`);
        if (x.p.fileWrite.content == null) throw new Error(`fileWrite missing content: ${x.p.fileWrite.path}`);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, x.p.fileWrite.content);
        changedFiles.push(dest);
      } else {
        const src = readFileSync(x.file, 'utf-8');
        writeFileSync(x.file, src.replace(x.p.patch.find, () => x.p.patch.replace));
        changedFiles.push(x.file);
      }
    }

    if (!changedFiles.length) { log('  Nothing applied cleanly — no commit.'); git(['checkout', baseBranch], repoPath); try { git(['branch', '-D', branch], repoPath); } catch { /* */ } return { applied: [], branch: null, baseBranch }; }

    // Stage ONLY the files seo-bot changed — NEVER `git add -A` (that sweeps stray untracked files
    // — logs, other clients' artifacts — into the verifier-gated auto-PR).
    git(['add', '--', ...changedFiles], repoPath);
    const body = `seo-bot: ${applicable.length} auto-fixes + ${data.proposals.length - patches.length} advisory items (score ${data.score}/100)`;
    git(['commit', '-m', `seo-bot: on-site SEO/AEO fixes (${stamp})`, '-m', body], repoPath);

    let pr = null;
    if (has('gh')) {
      try {
        git(['push', '-u', 'origin', branch], repoPath);
        // Optional caller-supplied PR title/body (e.g. an experiment evidence bundle); default --fill unchanged.
        const prArgs = data.prBody
          ? ['pr', 'create', '--title', data.prTitle || `seo-bot: on-site SEO/AEO fixes (${stamp})`, '--body', data.prBody, '--base', baseBranch, '--head', branch]
          : ['pr', 'create', '--fill', '--base', baseBranch, '--head', branch];
        pr = execFileSync('gh', prArgs, { cwd: repoPath, encoding: 'utf-8' }).trim();
      } catch (e) { log(`  ⚠ PR step skipped: ${String(e.message || e).slice(0, 160)}`); }
    }
    log(`  Applied ${changedFiles.length} file change(s) on branch ${branch}${pr ? ` → ${pr}` : ' (no PR — review + push manually)'}.`);
    return { applied: changedFiles.map((f) => ({ url: f.replace(repoPath, '').replace(/^[\\/]/, ''), field: 'file', ref: pr })), branch, baseBranch, pr };
  } finally {
    // Always return the working tree to the base branch (the commit stays on `branch` for the PR).
    try { git(['checkout', baseBranch], repoPath); } catch { /* */ }
  }
}
