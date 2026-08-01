// seo-bot · intake/github — the CODE side of the client handoff.
//
// The operating agreement (user, 2026-07-12): every client site is vibe-coded and handed over
// as a GitHub repo — the dev invites the agency account (the GitHub account on
// seenaiseo@gmail.com) as a collaborator. This lane turns that invitation into PR access:
//
//   /user/repository_invitations  ──accept──▶  clone → pair with a client config → cms.repoPath
//
// so the apply adapters + blog-publish can open PRs against the client's codebase with ZERO
// human clicks. Org membership invites are accepted the same way (API, never email links).
//
// Auth: a classic PAT with `repo` scope in GH_TOKEN (the same env the gh CLI honors — this also
// retires the Mini's pending `gh` device-auth). Fail-closed pairing: a repo only wires into a
// client config when the DOMAIN-HEAD match is unambiguous; otherwise it's cloned, reported to
// C-suite, and waits for a human `intake pair`. Accepting an invite is always reported — the
// C-suite channel sees every repo that enters the fleet.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ROOT, listConfigs } from '../config.mjs';

const API = 'https://api.github.com';
const UA = 'seo-bot-intake';

export const clientsDir = (env = process.env) => env.SEO_BOT_CLIENTS_DIR || join(homedir(), 'clients');
export const ghToken = (env = process.env) => env.GH_TOKEN || env.GITHUB_TOKEN || null;

async function gh(token, path, { method = 'GET' } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA, 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 204) return { ok: true };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`github ${method} ${path}: HTTP ${res.status} ${body.message || ''}`.trim());
  return body;
}

export const listRepoInvitations = (token) => gh(token, '/user/repository_invitations');
export const acceptRepoInvitation = (token, id) => gh(token, `/user/repository_invitations/${id}`, { method: 'PATCH' });
export const listOrgInvitations = async (token) => (await gh(token, '/user/memberships/orgs?state=pending').catch(() => [])) || [];
export const acceptOrgInvitation = (token, org) => gh(token, `/user/memberships/orgs/${org}`, { method: 'PATCH' });

/** PURE: the distinctive head of a client's domain — "nobsmedspareviews.com" → "nobsmedspareviews". */
export function domainHead(domain = '') {
  return String(domain).toLowerCase().replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/g, '');
}

/** PURE: pair a repo with a client config by domain-head evidence in name/description/homepage.
 *  Returns { slug } on an UNAMBIGUOUS match, { slug: null, reason } otherwise (fail-closed). */
export function guessClientForRepo(repo = {}, clients = []) {
  const hay = `${repo.name || ''} ${repo.description || ''} ${repo.homepage || ''} ${repo.full_name || ''}`.toLowerCase();
  const hits = clients.filter((c) => {
    const head = domainHead(c.domain || '');
    return head.length >= 5 && hay.includes(head); // ≥5 chars: "spa"/"med" style heads would false-match
  });
  if (hits.length === 1) return { slug: hits[0].slug, matchedOn: domainHead(hits[0].domain) };
  return { slug: null, reason: hits.length ? `ambiguous (${hits.map((h) => h.slug).join(', ')})` : 'no domain-head match' };
}

/** Clients as pairing candidates (slug + domain), reading configs directly. */
export function pairingCandidates({ root = ROOT } = {}) {
  const out = [];
  for (const name of listConfigs()) {
    try {
      const j = JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));
      const domain = j.domain || (j.baseUrl ? new URL(j.baseUrl).hostname : null);
      if (domain) out.push({ slug: name, domain });
    } catch { /* unreadable config is not a candidate */ }
  }
  return out;
}

/** Wire a cloned repo into a client config (cms block) — the moment PRs become possible. */
export function pairRepoToClient(slug, repoPath, { root = ROOT, cmsType = 'nextjs' } = {}) {
  const cfgPath = join(root, 'config', `${slug}.json`);
  if (!existsSync(cfgPath)) return { ok: false, error: `no config for "${slug}"` };
  const j = JSON.parse(readFileSync(cfgPath, 'utf8'));
  j.cms = { ...(j.cms || {}), type: j.cms?.type && j.cms.type !== 'dryrun' ? j.cms.type : cmsType, repoPath, branchPrefix: j.cms?.branchPrefix || 'seo-bot/' };
  writeFileSync(cfgPath, JSON.stringify(j, null, 2));
  return { ok: true, cms: j.cms };
}

/** Clone (or update) a repo into the clients dir using the PAT over https. */
export function cloneRepo(fullName, { token, dir = clientsDir(), git = execFileSync, log = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, fullName.replace('/', '-'));
  const url = `https://x-access-token:${token}@github.com/${fullName}.git`;
  try {
    if (existsSync(join(dest, '.git'))) { git('git', ['-C', dest, 'pull', '--ff-only'], { stdio: 'pipe' }); return { ok: true, dest, updated: true }; }
    git('git', ['clone', '--quiet', url, dest], { stdio: 'pipe' });
    return { ok: true, dest, cloned: true };
  } catch (e) {
    // Never leak the tokenized URL into logs/Slack.
    return { ok: false, dest, error: String(e && e.message || e).replace(/x-access-token:[^@]+@/g, '').slice(0, 200) };
  }
}

/** The GitHub lane: accept pending invitations → clone → pair (fail-closed) → report each. */
export async function intakeGithub({ log = () => {}, dryRun = false, env = process.env, deps = {} } = {}) {
  const {
    token = ghToken(env),
    listFn = listRepoInvitations, acceptFn = acceptRepoInvitation,
    listOrgFn = listOrgInvitations, acceptOrgFn = acceptOrgInvitation,
    cloneFn = cloneRepo, candidatesFn = pairingCandidates, pairFn = pairRepoToClient,
    escalateFn = null,
  } = deps;
  if (!token) return { ok: false, note: 'no GH_TOKEN — create a classic PAT (repo scope) for the seenaiseo GitHub account and put it in the Mini .env' };
  const esc = escalateFn || (await import('../escalate.mjs')).escalate;

  const invites = await listFn(token);
  const orgs = await listOrgFn(token);
  log(`  intake/github: ${invites.length} repo invitation(s) · ${orgs.length} org invitation(s) pending`);
  const results = [];

  for (const om of orgs) {
    const org = om.organization?.login;
    if (!org) continue;
    if (dryRun) { results.push({ org, status: 'dry-run' }); continue; }
    try {
      await acceptOrgFn(token, org);
      await esc(null, { severity: 'info', area: 'intake-github', title: `📦 Joined GitHub org — ${org}`, detail: `Accepted the pending org membership for the agency account (invited by ${om.organization?.login || 'unknown'}). Repo invitations from this org will flow in normally.` }, { log });
      results.push({ org, status: 'org-accepted' });
    } catch (e) {
      await esc(null, { severity: 'warning', area: 'intake-github', title: `Org invitation accept FAILED — ${org}`, detail: String(e && e.message || e).slice(0, 300) }, { log });
      results.push({ org, status: 'error', error: String(e && e.message || e) });
    }
  }

  for (const inv of invites) {
    const repo = inv.repository || {};
    const fullName = repo.full_name || '(unknown)';
    const inviter = inv.inviter?.login || 'unknown';
    if (dryRun) { log(`  would accept: ${fullName} (from ${inviter})`); results.push({ repo: fullName, status: 'dry-run' }); continue; }
    try {
      await acceptFn(token, inv.id);
      const clone = cloneFn(fullName, { token, log });
      const guess = guessClientForRepo(repo, candidatesFn());
      let paired = null;
      if (clone.ok && guess.slug) {
        const p = pairFn(guess.slug, clone.dest);
        paired = p.ok ? guess.slug : null;
      }
      await esc(null, {
        severity: 'info', area: 'intake-github',
        title: `📦 Repo handoff accepted — ${fullName}`,
        detail: [
          `Invited by \`${inviter}\`. Accepted via API${clone.ok ? ` and cloned to \`${clone.dest}\`` : ` — CLONE FAILED: ${clone.error}`}.`,
          paired
            ? `Paired with client \`${paired}\` (matched \`${guess.matchedOn}\`) — cms.repoPath set, PR lane LIVE.`
            : `Not auto-paired (${guess.reason}) — run \`seo-bot intake pair <client> --repo ${fullName}\` to wire the PR lane.`,
        ].join('\n'),
        link: repo.html_url || null,
      }, { log });
      results.push({ repo: fullName, status: 'accepted', cloned: !!clone.ok, paired });
      log(`  ✅ intake/github: ${fullName} accepted${paired ? ` → paired with ${paired}` : ' (awaiting pairing)'}`);
    } catch (e) {
      await esc(null, { severity: 'critical', area: 'intake-github', title: `Repo invitation accept FAILED — ${fullName}`, detail: String(e && e.message || e).slice(0, 300) }, { log });
      results.push({ repo: fullName, status: 'error', error: String(e && e.message || e) });
    }
  }
  return { ok: true, invitations: invites.length, orgs: orgs.length, results };
}
