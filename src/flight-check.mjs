// seo-bot · flight-check — the Rank Loop's Layer-0 verdict: ONE GREEN/AMBER/RED answer to
// "is the machine actually on?". Composes signals that already exist (capture-lane mtimes,
// scheduler heartbeat, mini heartbeats, artifact ages, store reachability) — it invents no
// new monitoring, it UNIFIES the fragmented ones (doctor logs, lane-health per-lane pings,
// heartbeat files nobody read) into a single portfolio verdict + one escalation on RED.
//
// Honesty: a signal that never produced an artifact is 'never' (could be a lane that hasn't
// launched for this client — informational), not a fake 'dead'. Staleness budgets are 3-tier:
// ok (< budget) / stale (< 3× budget) / dead (≥ 3×). The verdict never claims more than the
// files on disk prove.

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listConfigs } from './config.mjs';
import { nowIso } from './util.mjs';

const H = 3600000;
// Per-signal freshness budgets (hours). Lanes tick on the Mini daily; weekly artifacts get
// ~8 days; the monthly deep audit gets 35 days.
export const BUDGETS = {
  'lane-qb': 48, 'lane-serp': 48,
  'daily-brief': 8 * 24, 'action-plan': 10 * 24, 'outcomes': 10 * 24,
  'deep-audit': 35 * 24, 'geogrid': 45 * 24,
  'scheduler-heartbeat': 8 * 24, 'mini-heartbeat': 48, 'strategist': 72,
};
const CORE = new Set(['lane-qb', 'lane-serp', 'daily-brief']); // a client with 2+ core signals dead = RED

const ageH = (p, now) => { try { return (now - statSync(p).mtimeMs) / H; } catch { return null; } };
const newestIn = (dir, re, now) => {
  try {
    const files = readdirSync(dir).filter((n) => re.test(n));
    if (!files.length) return null;
    return Math.min(...files.map((n) => ageH(join(dir, n), now)).filter((a) => a !== null));
  } catch { return null; }
};

function signal(id, ageHours, { budget = BUDGETS[id] ?? 24 * 7, note = null } = {}) {
  let status;
  if (ageHours === null) status = 'never';
  else if (ageHours < budget) status = 'ok';
  else if (ageHours < budget * 3) status = 'stale';
  else status = 'dead';
  return { id, status, ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10, budgetHours: budget, note };
}

/** Gather everything from disk (read-only). Injected now/root for tests. */
export function gatherFlightInputs({ root = ROOT, now = Date.now(), clients = null, storeProbe = null } = {}) {
  // _-prefixed configs are fixtures/internal (mini-run's clients() skips them too) — a test
  // fixture must never tint the fleet verdict.
  const names = (clients || listConfigs()).filter((n) => !n.startsWith('_'));
  const global = [];
  // scheduler heartbeat (state/autopilot-heartbeat.json — src/scheduler.mjs)
  const hbPath = join(root, 'state', 'autopilot-heartbeat.json');
  let hbOk = null;
  try { hbOk = existsSync(hbPath) ? JSON.parse(readFileSync(hbPath, 'utf-8')).ok !== false : null; } catch { hbOk = null; }
  global.push(signal('scheduler-heartbeat', ageH(hbPath, now), { note: hbOk === false ? 'last scheduled run reported NOT ok' : null }));
  // mini heartbeats (reports/_heartbeat/<mode> — mini-run.sh)
  global.push(signal('mini-heartbeat', newestIn(join(root, 'reports', '_heartbeat'), /./, now)));
  // strategist memo (reports/_strategist/<day>.json)
  global.push(signal('strategist', newestIn(join(root, 'reports', '_strategist'), /\.json$/, now)));
  // store reachability — optional async probe result passed in (CLI does the ping; pure layer just scores it)
  if (storeProbe) global.push({ id: 'store', status: storeProbe.ok ? 'ok' : 'dead', ageHours: null, budgetHours: null, note: storeProbe.note || null });

  const perClient = {};
  for (const c of names) {
    const dir = join(root, 'reports', c);
    perClient[c] = [
      signal('lane-qb', ageH(join(root, 'reports', 'query-bank', c, 'observations.ndjson'), now)),
      signal('lane-serp', ageH(join(root, 'research', 'serp-playbook', c, 'serp-observations.ndjson'), now)),
      signal('daily-brief', ageH(join(dir, 'daily-brief.md'), now)),
      signal('deep-audit', ageH(join(dir, 'deep-audit-latest.json'), now)),
      signal('action-plan', ageH(join(dir, 'action-plan.json'), now)),
      signal('outcomes', ageH(join(dir, 'outcomes.ndjson'), now)),
      signal('geogrid', newestIn(dir, /^geogrid-.*\.json$/, now)),
    ];
  }
  return { global, perClient };
}

/** PURE: verdicts from gathered signals.
 *  Client: RED = ≥2 CORE signals dead · AMBER = anything stale/dead/never · GREEN otherwise.
 *  System: RED = store dead, scheduler not-ok, or any client RED · AMBER = any amber/global
 *  degradation · GREEN otherwise. */
export function assessFlight({ global = [], perClient = {} } = {}) {
  const clients = {};
  for (const [name, signals] of Object.entries(perClient)) {
    const dead = signals.filter((s) => s.status === 'dead' && CORE.has(s.id)).length;
    const degraded = signals.filter((s) => s.status !== 'ok');
    const verdict = dead >= 2 ? 'RED' : degraded.length ? 'AMBER' : 'GREEN';
    clients[name] = { verdict, signals, attention: degraded.map((s) => `${s.id}:${s.status}`) };
  }
  const store = global.find((s) => s.id === 'store');
  const sched = global.find((s) => s.id === 'scheduler-heartbeat');
  const anyRed = Object.values(clients).some((c) => c.verdict === 'RED');
  const globalDegraded = global.filter((s) => s.status !== 'ok');
  let system = 'GREEN';
  if ((store && store.status === 'dead') || (sched && /NOT ok/.test(sched.note || '')) || anyRed) system = 'RED';
  else if (globalDegraded.length || Object.values(clients).some((c) => c.verdict === 'AMBER')) system = 'AMBER';
  const reasons = [
    ...(store?.status === 'dead' ? ['store unreachable'] : []),
    ...(/NOT ok/.test(sched?.note || '') ? ['last scheduled run failed'] : []),
    ...Object.entries(clients).filter(([, c]) => c.verdict === 'RED').map(([n]) => `${n}: ≥2 core lanes dead`),
    ...globalDegraded.map((s) => `${s.id}:${s.status}`),
  ];
  return { system, reasons, global, clients };
}

/** Run + persist + escalate on RED. escalateImpl injectable; store probe optional (CLI). */
export async function runFlightCheck({ log = () => {}, clients = null, now = Date.now(), root = ROOT, storeProbe = null, escalateImpl = null } = {}) {
  const verdictObj = assessFlight(gatherFlightInputs({ root, now, clients, storeProbe }));
  const at = nowIso();
  const dir = join(root, 'reports', '_flight');
  mkdirSync(dir, { recursive: true });
  const payload = { at, ...verdictObj };
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(payload, null, 2));
  writeFileSync(join(dir, `${at.slice(0, 10)}.json`), JSON.stringify(payload, null, 2));

  const chip = { GREEN: '🟢', AMBER: '🟡', RED: '🔴' };
  log(`\n  Flight check — system ${chip[verdictObj.system]} ${verdictObj.system}`);
  for (const g of verdictObj.global) log(`    ${g.status === 'ok' ? '✓' : g.status === 'never' ? '·' : '⚠'} ${g.id}: ${g.status}${g.ageHours !== null ? ` (${Math.round(g.ageHours)}h old, budget ${g.budgetHours}h)` : ''}${g.note ? ` — ${g.note}` : ''}`);
  for (const [name, c] of Object.entries(verdictObj.clients)) {
    log(`    ${chip[c.verdict]} ${name}${c.attention.length ? ` — ${c.attention.join(' · ')}` : ''}`);
  }
  if (verdictObj.system === 'RED') {
    try {
      const esc = escalateImpl || (await import('./escalate.mjs')).escalate;
      await esc(null, { severity: 'critical', area: 'flight', title: `Flight check RED — ${verdictObj.reasons.slice(0, 3).join('; ')}`, detail: verdictObj.reasons.join('\n') }, { log });
    } catch { /* the verdict file is the record; Slack is a mirror */ }
  }
  return payload;
}
