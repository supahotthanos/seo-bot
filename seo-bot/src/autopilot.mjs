// seo-bot · autopilot — supervised autonomy with VERIFIER CONSENSUS. The policy engine
// (policy.decidePolicy) already says which proposals are safe to auto-approve (deterministic
// meta/title clamps, low-severity, low-traffic, proven non-negative class). This adds the
// second gate the owner asked for: before ANYTHING auto-pushes to a live site, an independent
// panel of N adversarial verifier agents must reach CONSENSUS that the change is safe. Only
// consensus-safe changes push — and ONLY through a PR/diff adapter (Next.js/edge), never a
// live-overwrite (WordPress) — every write journaled to the change-ledger for one-click
// rollback. Fail-closed: if the verifier panel can't run (no LLM key) or doesn't agree, the
// change is queued for a human. Nothing here weakens the legal/YMYL/irreversible hard gates.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

export const PR_ADAPTERS = new Set(['nextjs', 'edge', 'cloudflare-worker']); // diff/PR paths only — never wordpress

async function llmVerify(prompt, client = null) {
  // Each verifier is an independent model call — on the Claude Code subscription by default.
  const { complete } = await import('./llm.mjs');
  return complete(prompt, { system: 'You are an adversarial reviewer of automated website changes about to be pushed with NO human review. Be strict; default to UNSAFE when uncertain. Reply ONLY with compact JSON.', maxTokens: 300, client, tag: 'autopilot-verify' });
}

export function parseVerdict(text) {
  if (!text) return null;
  try { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

/** Tally a set of verifier votes into a consensus verdict (pure — unit-tested). */
export function tallyConsensus(votes = [], { n = votes.length, threshold = votes.length } = {}) {
  const safeCount = votes.filter((v) => v && v.safe === true).length;
  const thr = Math.max(1, threshold || 0); // a 0/negative threshold must NEVER pass with zero safe votes
  const consensus = votes.length > 0 && safeCount >= 1 && safeCount >= thr;
  const worst = votes.reduce((w, v) => (v && /high/.test(v.risk || '') ? 'high' : w), 'low');
  return { consensus, safeCount, n, threshold: thr, worstRisk: worst, dissent: votes.filter((v) => !v || v.safe !== true).map((v) => v?.reason).filter(Boolean) };
}

/** Run N independent adversarial verifiers on ONE change; require consensus to clear it. */
export async function verifierConsensus(proposal, cfg, { n = 3 } = {}) {
  n = Math.max(3, n || 3); // floor: never auto-push behind fewer than 3 independent reviewers
  const { llmAvailable } = await import('./llm.mjs');
  if (!llmAvailable()) return { consensus: false, available: false, votes: [], reason: 'verifier panel unavailable (no model — login the claude CLI or set ANTHROPIC_API_KEY) — fail-closed to human queue' };
  const threshold = cfg.autopilot?.consensusThreshold ?? n; // default: UNANIMOUS
  const votes = [];
  for (let i = 0; i < n; i++) {
    const prompt = `Independent reviewer ${i + 1} of ${n}. A bot will AUTO-PUSH this change to the LIVE site ${cfg.baseUrl} with NO human review.
PAGE: ${proposal.page}
CHANGE TYPE: ${proposal.type} (severity ${proposal.severity})
BEFORE: ${String(proposal.current ?? '').slice(0, 300)}
AFTER:  ${String(proposal.proposed ?? '').slice(0, 300)}
RATIONALE: ${proposal.rationale || ''}

Find ANY reason this is unsafe to auto-push: breaks layout, factually wrong/misleading, loses information, touches sensitive/YMYL/medical/review content, or hurts SEO. Default to UNSAFE if at all unsure.
Reply ONLY: {"safe":true|false,"risk":"low|medium|high","reason":"<one line>"}`;
    votes.push(parseVerdict(await llmVerify(prompt, cfg.name)) || { safe: false, risk: 'high', reason: 'no parseable verdict (fail-closed)' });
  }
  const t = tallyConsensus(votes, { n, threshold });
  return { ...t, available: true, votes, reason: t.consensus ? `${t.safeCount}/${n} verifiers agree safe` : `only ${t.safeCount}/${n} safe (need ${threshold}) — queued for human` };
}

async function applyFiltered(cfg, proposals, { log, confirm }) {
  const type = cfg.cms?.type;
  const data = { client: cfg.name, brand: cfg.brand, proposals };
  if (type === 'nextjs') { const { applyNextjs } = await import('./apply/nextjs.mjs'); return (await applyNextjs(cfg, data, { log, confirm })).applied || []; }
  if (type === 'edge') { const { applyEdge } = await import('./apply/edge.mjs'); return (await applyEdge(cfg, data, { log, confirm })).applied || []; }
  if (type === 'cloudflare-worker') { const { applyCloudflareWorker } = await import('./apply/cloudflare-worker.mjs'); return (await applyCloudflareWorker(cfg, data, { log, confirm })).applied || []; }
  return [];
}

/**
 * The autopilot run: propose → policy → verifier consensus → push (PR only) → journal.
 * push:false = plan only (default, safe). push:true = apply the consensus-safe set.
 */
export async function runAutopilot(cfg, { log = () => {}, push = false, n = 3 } = {}) {
  try { const { setCostContext } = await import('./cost.mjs'); setCostContext({ client: cfg.name, tag: 'autopilot' }); } catch { /* */ }
  const { buildProposals, saveProposals } = await import('./decide.mjs');
  const result = await buildProposals(cfg, { log });
  saveProposals(result);

  // first-party signals (graceful) for the policy risk-tier check
  let gsc = {}, ga4 = {};
  try { gsc = await (await import('./gsc.mjs')).pullGSC(cfg, { log: () => {} }); } catch { /* */ }
  try { ga4 = await (await import('./data/ga4.mjs')).ga4Report(cfg, { log: () => {} }); } catch { /* */ }
  const { buildSignals, loadStatsDecisions, decideBatch } = await import('./policy.mjs');
  const signals = buildSignals(gsc, ga4);
  const stats = await loadStatsDecisions(cfg.name);
  const { auto, queued } = decideBatch(result.proposals, cfg, { stats, signals });

  // verifier consensus on each policy-auto-approved change
  const cleared = [], rejected = [];
  for (const p of auto) {
    const c = await verifierConsensus(p, cfg, { n });
    (c.consensus ? cleared : rejected).push({ ...p, consensus: c });
  }

  // push — ONLY consensus-safe, ONLY through a PR/diff adapter, journaled for rollback
  const prSafe = PR_ADAPTERS.has(cfg.cms?.type);
  let applied = [];
  if (push && cleared.length && prSafe) {
    applied = await applyFiltered(cfg, cleared, { log, confirm: true });
    try { const { recordChanges } = await import('./change-ledger.mjs'); recordChanges(cfg.name, applied, { adapter: cfg.cms.type, runId: 'autopilot-' + nowIso().slice(0, 10) }); } catch { /* */ }
  } else if (push && cleared.length && !prSafe) {
    log(`  ⚠ refusing to autopilot a "${cfg.cms?.type || 'dryrun'}" adapter (no PR/diff) — cleared changes left queued. Set cms.type=nextjs/edge.`);
  }

  const summary = {
    client: cfg.name, ranAt: nowIso(), pushed: push && prSafe, adapter: cfg.cms?.type,
    proposals: result.proposals.length, policyAuto: auto.length, policyQueued: queued.length,
    verifierCleared: cleared.length, verifierRejected: rejected.length, applied: applied.length,
    cleared: cleared.map((p) => ({ page: p.page, type: p.type, votes: p.consensus.safeCount + '/' + p.consensus.n })),
    rejected: rejected.map((p) => ({ page: p.page, type: p.type, reason: p.consensus.reason })),
    queued: queued.map((p) => ({ page: p.page, type: p.type, blockers: p.policy.blockers })),
  };
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'autopilot-latest.json'), JSON.stringify(summary, null, 2));
  log(`\n  Autopilot${push ? (prSafe ? ' (PUSHED)' : ' (plan)') : ' (plan)'}: ${result.proposals.length} proposals → ${auto.length} policy-auto → ${cleared.length} verifier-cleared → ${applied.length} applied · ${queued.length + rejected.length} queued for human`);
  try { const { llmAvailable, llmProvider } = await import('./llm.mjs'); if (!llmAvailable()) log('  (no model → verifier panel can\'t run → everything queued, fail-closed)'); else log(`  (verifier model: ${llmProvider()})`); } catch { /* */ }
  return summary;
}
