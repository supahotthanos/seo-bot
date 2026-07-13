// seo-bot · scheduler — the laptop-autonomy layer. Registers TWO Windows Scheduled Tasks
// (seenai-daily, seenai-weekly) via `schtasks` + generated task XML so the bot runs itself
// on a laptop that sleeps: <StartWhenAvailable> makes missed runs fire on wake, battery
// never blocks a run, and a PT4H execution cap kills anything hung.
//
// Safety invariants (sacred, do not weaken):
//   - runScheduled NEVER passes --yes anywhere and NEVER pushes unless the CLIENT CONFIG
//     explicitly sets autopilot.push === true (strict boolean; default plan-only).
//   - Daily work is read-only/graceful: measure + content decay + dashboard sync, each step
//     try/caught so one client's failure never starves the next.
//   - Everything schtasks-related is try/caught and returns structured errors — this module
//     loads and unit-tests on any OS (install/remove/status guard process.platform).
//
// Artifacts (all under ROOT unless a test passes `root`):
//   state/scheduler/seenai-<kind>.xml   generated task XML (kept for inspection/re-install)
//   state/scheduler/installed.json      install marker (specs + results) → dashboard section
//   state/scheduler/history.jsonl       one line per run, capped at 500 (tail kept)
//   state/autopilot-heartbeat.json      full result of the LAST run (any kind)
//   logs/scheduler/<kind>-<date>.log    full run log, pruned after 30 days

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig, listConfigs } from './config.mjs';

export const TASK_NAMES = { daily: 'seenai-daily', weekly: 'seenai-weekly' };
const HISTORY_CAP = 500;
const LOG_RETENTION_DAYS = 30;

const msg = (e) => String(e && e.message || e).slice(0, 300);
const readJsonSafe = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : null; } catch { return null; } };

// ---- time-spec parsing + next-occurrence math (pure, exported for tests) ------------------

const DAY_INDEX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const DAY_XML = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** '09:15' → {h,m} — null on anything malformed (fail closed, caller decides). */
export function parseDailySpec(spec) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h <= 23 && mm <= 59 ? { h, m: mm } : null;
}

/** 'SUN 10:00' → {dow:0..6, h, m} — null on anything malformed. */
export function parseWeeklySpec(spec) {
  const m = /^([A-Za-z]{3})\s+(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim());
  if (!m) return null;
  const dow = DAY_INDEX[m[1].toUpperCase()];
  const h = Number(m[2]), mm = Number(m[3]);
  return dow !== undefined && h <= 23 && mm <= 59 ? { dow, h, m: mm } : null;
}

function nextDailyAt(from, h, m) {
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

function nextWeeklyAt(from, dow, h, m) {
  const d = new Date(from);
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 7);
  return d;
}

/** Local-time StartBoundary the Task Scheduler expects: YYYY-MM-DDTHH:MM:SS (no zone). */
function fmtLocal(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- task XML generation (pure, exported for tests) ---------------------------------------

export function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Generate the Task Scheduler XML for one kind. Laptop-proof settings baked in:
 * StartWhenAvailable=true (missed run fires on wake), DisallowStartIfOnBatteries=false,
 * ExecutionTimeLimit=PT4H, LogonType=InteractiveToken (NO admin, no /RU). Pure — no I/O.
 * @param {{kind:'daily'|'weekly', spec:string, nodePath?:string, binPath?:string,
 *          workingDir?:string, now?:Date}} opts spec: 'HH:MM' (daily) | 'DAY HH:MM' (weekly)
 */
export function buildTaskXml({ kind, spec, nodePath = process.execPath, binPath = join(ROOT, 'bin', 'seo-bot.mjs'), workingDir = ROOT, now = new Date() } = {}) {
  let trigger, start;
  if (kind === 'daily') {
    const t = parseDailySpec(spec);
    if (!t) throw new Error(`bad daily spec "${spec}" (expected HH:MM, e.g. 09:15)`);
    start = fmtLocal(nextDailyAt(now, t.h, t.m));
    trigger = `      <ScheduleByDay>\n        <DaysInterval>1</DaysInterval>\n      </ScheduleByDay>`;
  } else if (kind === 'weekly') {
    const t = parseWeeklySpec(spec);
    if (!t) throw new Error(`bad weekly spec "${spec}" (expected DAY HH:MM, e.g. SUN 10:00)`);
    start = fmtLocal(nextWeeklyAt(now, t.dow, t.h, t.m));
    trigger = `      <ScheduleByWeek>\n        <WeeksInterval>1</WeeksInterval>\n        <DaysOfWeek>\n          <${DAY_XML[t.dow]} />\n        </DaysOfWeek>\n      </ScheduleByWeek>`;
  } else {
    throw new Error(`unknown kind "${kind}" (daily|weekly)`);
  }
  const args = `"${binPath}" schedule run --kind ${kind}`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>seo-bot autonomous ${kind} run (${TASK_NAMES[kind]}). Managed by src/scheduler.mjs — reinstall via "seo-bot schedule install".</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${start}</StartBoundary>
      <Enabled>true</Enabled>
${trigger}
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT4H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(nodePath)}</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
      <WorkingDirectory>${xmlEscape(workingDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

// ---- schtasks plumbing (structured, never throws) ------------------------------------------

function defaultExec(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    return { ok: true, stdout: String(out || '') };
  } catch (e) {
    return { ok: false, stdout: String(e.stdout || ''), error: String(e.stderr || e.message || e).trim().slice(0, 400) };
  }
}

const schedDir = (root) => join(root, 'state', 'scheduler');
const installedFile = (root) => join(schedDir(root), 'installed.json');
const heartbeatFile = (root) => join(root, 'state', 'autopilot-heartbeat.json');
const historyFile = (root) => join(schedDir(root), 'history.jsonl');

// ---- 1) install ----------------------------------------------------------------------------

/**
 * Register seenai-daily + seenai-weekly Scheduled Tasks from generated XML. No admin needed
 * (InteractiveToken). NOTE: the `push` flag is recorded as metadata ONLY — whether the weekly
 * routine pushes is decided per client at RUN time from cfg.autopilot.push === true, never here
 * (PR-only autopilot invariant).
 */
export async function installSchedule({ clients = null, daily = '09:15', weekly = 'SUN 10:00', push = false, log = () => {}, root = ROOT, exec = defaultExec, platform = process.platform, nodePath = process.execPath, binPath = join(ROOT, 'bin', 'seo-bot.mjs'), workingDir = ROOT } = {}) {
  if (platform !== 'win32') return { ok: false, reason: 'windows-only' };
  if (!parseDailySpec(daily)) return { ok: false, reason: `bad daily spec "${daily}" (expected HH:MM)` };
  if (!parseWeeklySpec(weekly)) return { ok: false, reason: `bad weekly spec "${weekly}" (expected DAY HH:MM, e.g. SUN 10:00)` };

  mkdirSync(schedDir(root), { recursive: true });
  const tasks = [];
  for (const [kind, spec] of [['daily', daily], ['weekly', weekly]]) {
    const name = TASK_NAMES[kind];
    try {
      const xml = buildTaskXml({ kind, spec, nodePath, binPath, workingDir });
      const file = join(schedDir(root), `${name}.xml`);
      // Task Scheduler's canonical encoding — write UTF-16 LE with BOM to match the declaration.
      writeFileSync(file, '\ufeff' + xml, 'utf16le');
      const r = exec('schtasks', ['/Create', '/TN', name, '/XML', file, '/F']);
      tasks.push({ name, kind, spec, ok: r.ok, xmlFile: file, error: r.ok ? null : (r.error || 'schtasks /Create failed') });
      log(`  ${r.ok ? '✓' : '✗'} ${name} (${spec})${r.ok ? '' : ` — ${tasks.at(-1).error}`}`);
    } catch (e) {
      tasks.push({ name, kind, spec, ok: false, error: msg(e) });
      log(`  ✗ ${name} — ${msg(e)}`);
    }
  }

  const marker = {
    installedAt: new Date().toISOString(),
    daily: { spec: daily, ok: tasks[0].ok },
    weekly: { spec: weekly, ok: tasks[1].ok },
    clients: Array.isArray(clients) && clients.length ? clients : null, // null → all configured clients at run time
    requestedPush: push === true, // metadata only — push authority stays with each client config
  };
  try { writeFileSync(installedFile(root), JSON.stringify(marker, null, 2)); } catch { /* marker is best-effort */ }
  const ok = tasks.every((t) => t.ok);
  log(ok ? `  schedule installed — daily ${daily} · weekly ${weekly} · missed runs fire on wake` : '  schedule install INCOMPLETE — see task errors above');
  return { ok, tasks, marker };
}

// ---- 2) the scheduled work itself (OS-agnostic) ---------------------------------------------

/**
 * The actual cron target. daily: measure + content decay + dashboard sync per client, every
 * step try/caught (read-only/graceful). weekly: weeklyRoutine per client — push ONLY when the
 * client config explicitly opts in with autopilot.push === true. Always writes the heartbeat,
 * appends capped history, and writes/prunes the run log. Never throws.
 * @param {{kind:'daily'|'weekly', log?:Function, root?:string, clients?:string[],
 *          deps?:object, now?:()=>number}} opts deps/root/now/clients are test seams
 */
export async function runScheduled({ kind, log = () => {}, root = ROOT, clients = null, deps = null, now = () => Date.now() } = {}) {
  const t0 = now();
  const lines = [];
  const logAll = (m) => { lines.push(String(m)); try { log(m); } catch { /* a broken logger must not kill the run */ } };
  if (kind !== 'daily' && kind !== 'weekly') {
    const bad = { at: new Date(t0).toISOString(), kind: String(kind), ok: false, perClient: [], durationMs: 0, error: `unknown kind "${kind}" (daily|weekly)` };
    logAll(`  ✗ ${bad.error}`);
    return bad;
  }

  const d = {
    loadConfig: deps?.loadConfig || loadConfig,
    listConfigs: deps?.listConfigs || listConfigs,
    measure: deps?.measure || (async (cfg, o) => (await import('./measure.mjs')).measure(cfg, o)),
    detectDecay: deps?.detectDecay || (async (cfg, o) => (await import('./content/decay.mjs')).detectDecay(cfg, o)),
    syncDashboard: deps?.syncDashboard || (async (cfg, o) => (await import('./dashboard.mjs')).syncDashboard(cfg, o)),
    weeklyRoutine: deps?.weeklyRoutine || (async (cfg, o) => (await import('./routine.mjs')).weeklyRoutine(cfg, o)),
  };

  let names = [];
  // Default enumeration skips underscore-prefixed configs (reserved/internal: _e2e, _demo, …) —
  // they'd burn real stealth-measurement minutes daily. An explicit clients list still may include them.
  try { names = Array.isArray(clients) && clients.length ? clients : d.listConfigs().filter((n) => !String(n).startsWith('_')); } catch (e) { logAll(`  ✗ listConfigs: ${msg(e)}`); }
  logAll(`▶ scheduled ${kind} run · ${names.length} client(s) · ${new Date(t0).toISOString()}`);

  const perClient = [];
  for (const name of names) {
    const row = { client: name, ok: false };
    let cfg;
    try { cfg = d.loadConfig(name); } catch (e) {
      row.error = `config: ${msg(e)}`;
      perClient.push(row); logAll(`  ✗ ${name}: ${row.error}`);
      continue;
    }
    try {
      if (kind === 'daily') {
        const errs = [];
        const steps = [
          ['measure', () => d.measure(cfg, { log: logAll })],
          ['decay', () => d.detectDecay(cfg, { log: logAll })],
          ['dashboard', () => d.syncDashboard(cfg, { log: logAll })], // read-only: no apply/confirm
        ];
        for (const [label, fn] of steps) {
          try { await fn(); } catch (e) { errs.push(`${label}: ${msg(e)}`); logAll(`  ✗ ${name} ${label}: ${msg(e)}`); }
        }
        row.ok = errs.length === 0;
        if (errs.length) row.error = errs.join(' · ');
      } else {
        // push ONLY on explicit per-client opt-in — strict boolean, never truthy coercion.
        const push = cfg.autopilot?.push === true;
        const s = await d.weeklyRoutine(cfg, { log: logAll, push });
        row.ok = true;
        row.auditScore = s?.auditScore ?? null;
        row.pushed = s?.pushed ?? 0;
        row.queued = s?.queued ?? 0;
      }
    } catch (e) {
      row.error = msg(e);
      logAll(`  ✗ ${name}: ${row.error}`);
    }
    perClient.push(row);
    logAll(`  ${row.ok ? '✓' : '✗'} ${name}${row.auditScore != null ? ` · audit ${row.auditScore}` : ''}${row.error ? ` · ${row.error}` : ''}`);
  }

  const heartbeat = { at: new Date(t0).toISOString(), kind, ok: perClient.length > 0 && perClient.every((c) => c.ok), perClient, durationMs: now() - t0 };

  try {
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(heartbeatFile(root), JSON.stringify(heartbeat, null, 2));
  } catch (e) { logAll(`  heartbeat write failed: ${msg(e)}`); }

  try {
    mkdirSync(schedDir(root), { recursive: true });
    let hist = [];
    try { if (existsSync(historyFile(root))) hist = readFileSync(historyFile(root), 'utf-8').split('\n').filter(Boolean); } catch { /* corrupt → start fresh */ }
    hist.push(JSON.stringify({ at: heartbeat.at, kind, ok: heartbeat.ok, clients: perClient.length, durationMs: heartbeat.durationMs }));
    if (hist.length > HISTORY_CAP) hist = hist.slice(-HISTORY_CAP); // keep the tail
    writeFileSync(historyFile(root), hist.join('\n') + '\n');
  } catch (e) { logAll(`  history write failed: ${msg(e)}`); }

  // per-client autonomy artifact — the dashboard's LOCAL mode reads reports/<client>/autonomy.json
  // (store mode reads the bundle's `autonomy` section; both derive from the same builder).
  try {
    const section = buildAutonomySection({ root, now: now() });
    for (const c of perClient) {
      try {
        const dir = join(root, 'reports', c.client);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'autonomy.json'), JSON.stringify(section, null, 2));
      } catch { /* per-client artifact is best-effort */ }
    }
  } catch { /* artifact write must never fail the run */ }

  try {
    const dir = join(root, 'logs', 'scheduler');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${kind}-${heartbeat.at.slice(0, 10)}.log`), lines.join('\n') + '\n');
    for (const f of readdirSync(dir)) { // prune by the date baked into the filename
      const m = /-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && now() - Date.parse(m[1]) > LOG_RETENTION_DAYS * 86_400_000) {
        try { rmSync(join(dir, f), { force: true }); } catch { /* best-effort prune */ }
      }
    }
  } catch { /* logging must never fail the run */ }

  return heartbeat;
}

// ---- 3) status ------------------------------------------------------------------------------

function csvCells(line) {
  const cells = [];
  const re = /"((?:[^"]|"")*)"/g;
  let m;
  while ((m = re.exec(line))) cells.push(m[1].replace(/""/g, '"'));
  return cells;
}

function csvField(csv, field) {
  const rows = String(csv || '').split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return null;
  const i = csvCells(rows[0]).indexOf(field);
  return i >= 0 ? (csvCells(rows[1])[i] || null) : null;
}

/** Query both tasks (graceful if missing / non-Windows), merge heartbeat + history tail. */
export async function scheduleStatus({ log = () => {}, root = ROOT, exec = defaultExec, platform = process.platform } = {}) {
  const installed = { daily: false, weekly: false };
  const nextRuns = [];
  if (platform === 'win32') {
    for (const kind of ['daily', 'weekly']) {
      const name = TASK_NAMES[kind];
      try {
        const q = exec('schtasks', ['/Query', '/TN', name, '/XML']);
        installed[kind] = q.ok === true;
        if (q.ok) {
          const v = exec('schtasks', ['/Query', '/TN', name, '/V', '/FO', 'CSV']);
          const next = v.ok ? csvField(v.stdout, 'Next Run Time') : null;
          if (next && !/^N\/A$/i.test(next)) nextRuns.push({ kind, at: next });
        }
      } catch { /* graceful — stays false */ }
    }
  }

  const hb = readJsonSafe(heartbeatFile(root));
  const lastRun = hb && hb.at ? { at: hb.at, kind: hb.kind ?? null, ok: hb.ok === true, clients: Array.isArray(hb.perClient) ? hb.perClient.length : 0, durationMs: hb.durationMs ?? null } : null;
  let history = [];
  try {
    if (existsSync(historyFile(root))) {
      history = readFileSync(historyFile(root), 'utf-8').split('\n').filter(Boolean).slice(-5)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
  } catch { /* graceful */ }

  const status = { installed, nextRuns: nextRuns.length ? nextRuns : null, lastRun, history };
  log(`\n▶ SCHEDULE STATUS${platform !== 'win32' ? ' (non-Windows — task query skipped)' : ''}`);
  log(`  ${TASK_NAMES.daily}:  ${installed.daily ? 'installed' : 'NOT installed'}${nextRuns.find((n) => n.kind === 'daily') ? ` · next ${nextRuns.find((n) => n.kind === 'daily').at}` : ''}`);
  log(`  ${TASK_NAMES.weekly}: ${installed.weekly ? 'installed' : 'NOT installed'}${nextRuns.find((n) => n.kind === 'weekly') ? ` · next ${nextRuns.find((n) => n.kind === 'weekly').at}` : ''}`);
  log(lastRun ? `  last run: ${lastRun.kind} @ ${lastRun.at} · ${lastRun.ok ? 'OK' : 'FAILED'} · ${lastRun.clients} client(s) · ${lastRun.durationMs}ms` : '  last run: none (heartbeat missing)');
  for (const h of history) log(`    ${h.at} · ${h.kind} · ${h.ok ? 'ok' : 'FAIL'}`);
  if (!installed.daily && !installed.weekly && platform === 'win32') log(`  install with: seo-bot schedule install`);
  return status;
}

// ---- 4) remove ------------------------------------------------------------------------------

/** Delete both tasks; absence is tolerated (query-first, no locale-dependent error matching). */
export async function removeSchedule({ log = () => {}, root = ROOT, exec = defaultExec, platform = process.platform } = {}) {
  if (platform !== 'win32') return { ok: false, reason: 'windows-only' };
  const tasks = [];
  for (const kind of ['daily', 'weekly']) {
    const name = TASK_NAMES[kind];
    try {
      const q = exec('schtasks', ['/Query', '/TN', name]);
      if (!q.ok) { tasks.push({ name, ok: true, removed: false, note: 'not-installed' }); log(`  · ${name}: not installed`); continue; }
      const r = exec('schtasks', ['/Delete', '/TN', name, '/F']);
      tasks.push({ name, ok: r.ok, removed: r.ok, error: r.ok ? null : (r.error || 'schtasks /Delete failed') });
      log(`  ${r.ok ? '✓' : '✗'} ${name}${r.ok ? ' removed' : ` — ${tasks.at(-1).error}`}`);
    } catch (e) {
      tasks.push({ name, ok: false, error: msg(e) });
      log(`  ✗ ${name} — ${msg(e)}`);
    }
  }
  try { rmSync(installedFile(root), { force: true }); } catch { /* marker is best-effort */ }
  return { ok: tasks.every((t) => t.ok), tasks };
}

// ---- 5) dashboard-bundle autonomy section (pure over files, never throws) -------------------

/**
 * The dashboard-bundle `autonomy` section, read from heartbeat + history + install marker.
 * Null-safe everywhere: missing/corrupt files → nulls (recent → []), NEVER throws.
 * @param {{root?:string, now?:number}} [opts] test seams
 * @returns {{installed:{daily:boolean,weekly:boolean}|null,
 *            lastRun:{at,kind,ok,pushed,queued,error}|null,
 *            nextRuns:{kind:string,at:string}[]|null,
 *            heartbeatAgeMs:number|null,
 *            recent:{at,kind,ok}[]}}
 */
export function buildAutonomySection({ root = ROOT, now = Date.now() } = {}) {
  const out = { installed: null, lastRun: null, nextRuns: null, heartbeatAgeMs: null, recent: [] };
  try {
    const inst = readJsonSafe(installedFile(root));
    if (inst && typeof inst === 'object') {
      out.installed = { daily: inst.daily?.ok === true, weekly: inst.weekly?.ok === true };
      const nr = [];
      const ds = parseDailySpec(inst.daily?.spec);
      if (ds) nr.push({ kind: 'daily', at: nextDailyAt(new Date(now), ds.h, ds.m).toISOString() });
      const ws = parseWeeklySpec(inst.weekly?.spec);
      if (ws) nr.push({ kind: 'weekly', at: nextWeeklyAt(new Date(now), ws.dow, ws.h, ws.m).toISOString() });
      out.nextRuns = nr.length ? nr : null;
    }

    const hb = readJsonSafe(heartbeatFile(root));
    if (hb && typeof hb === 'object' && hb.at) {
      const rows = Array.isArray(hb.perClient) ? hb.perClient : null;
      out.lastRun = {
        at: hb.at,
        kind: hb.kind ?? null,
        ok: hb.ok === true,
        pushed: rows ? rows.reduce((s, c) => s + (Number(c?.pushed) || 0), 0) : null,
        queued: rows ? rows.reduce((s, c) => s + (Number(c?.queued) || 0), 0) : null,
        error: rows ? (rows.find((c) => c?.error)?.error ?? null) : (hb.error ?? null),
      };
      const t = Date.parse(hb.at);
      out.heartbeatAgeMs = Number.isFinite(t) ? Math.max(0, now - t) : null;
    }

    try {
      if (existsSync(historyFile(root))) {
        out.recent = readFileSync(historyFile(root), 'utf-8').split('\n').filter(Boolean).slice(-5)
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean)
          .map((h) => ({ at: h.at ?? null, kind: h.kind ?? null, ok: h.ok === true }));
      }
    } catch { /* recent stays [] */ }
  } catch { /* the section is decorative — never let it break a bundle build */ }
  return out;
}
