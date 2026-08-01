// seo-bot · notify — the Slack lane: high-urgency approvals + held PRs → the operator's channel,
// each with a ONE-CLICK deep link into the deployed dashboard (…/approvals?client=X&focus=<taskId>)
// where the card carries the before/after screenshots + change magnitude and the accept/reject
// buttons. Slack is a MIRROR of the queue, never a dependency:
//   - builders are PURE (tested without a network),
//   - sendSlack never throws — a dead webhook can never break a dashboard push or a blog publish,
//   - no webhook configured → {delivered:false, note} and the caller logs one honest line.
//
// Config: cfg.notify = { slackWebhook, dashboardUrl, tiers:['red'], maxItems:6 }
// Env fallbacks: SEO_BOT_SLACK_WEBHOOK, SEENAI_DASHBOARD_URL.

const DEFAULT_DASHBOARD = 'https://seenai-next.vercel.app';

/** Resolve where notifications go (config first, env fallback, honest defaults).
 *  Two transports: a Slack BOT TOKEN (xoxb-, chat.postMessage — supports named channels,
 *  the C-suite escalation lane) and the legacy incoming WEBHOOK. Bot token wins when both
 *  are set; either alone works; neither = the lane is off. */
export function notifyTargets(cfg = {}, env = process.env) {
  const n = cfg.notify || {};
  const ch = n.channels || {};
  return {
    webhook: n.slackWebhook || env.SEO_BOT_SLACK_WEBHOOK || null,
    botToken: n.botToken || env.SLACK_BOT_TOKEN || null,
    channels: {
      approvals: ch.approvals || env.SEO_BOT_SLACK_CHANNEL_APPROVALS || null,
      csuite: ch.csuite || env.SEO_BOT_SLACK_CHANNEL_CSUITE || null,
    },
    dashboardUrl: String(n.dashboardUrl || env.SEENAI_DASHBOARD_URL || DEFAULT_DASHBOARD).replace(/\/+$/, ''),
    tiers: Array.isArray(n.tiers) && n.tiers.length ? n.tiers : ['red'],
    maxItems: Number(n.maxItems) > 0 ? Number(n.maxItems) : 6,
  };
}

/** The one-click link: /approvals scoped to the client, optionally focused on one card. */
export function approvalsLink(dashboardUrl, client, taskId = null) {
  const base = `${String(dashboardUrl).replace(/\/+$/, '')}/approvals?client=${encodeURIComponent(client)}`;
  return taskId ? `${base}&focus=${encodeURIComponent(taskId)}` : base;
}

const TIER_EMOJI = { red: '🔴', amber: '🟠', green: '🟢' };
const trunc = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** One record → the Slack line the operator decides from (type · page · why · visual Δ). */
export function describeRecord(r = {}) {
  const path = (() => { try { return new URL(r.page).pathname || r.page; } catch { return r.page || '(site)'; } })();
  const bits = [`${TIER_EMOJI[r.tier] || '•'} *${r.type || 'change'}* · \`${trunc(path, 60)}\``];
  if (r.rationale) bits.push(`_${trunc(r.rationale, 140)}_`);
  const s = r.screenshot;
  if (s && Number.isFinite(Number(s.magnitude))) {
    bits.push(`📸 before/after on the card — visible change ${s.magnitude}%${s.verdict ? ` (${s.verdict})` : ''}`);
  } else if (s) {
    bits.push(`📸 before/after screenshots on the card`);
  }
  return bits.join('\n');
}

/** PURE: Slack Block Kit payload for a pending push. null when no record matches the notify tiers
 *  (quiet weeks stay quiet — no "0 items" noise in the channel). */
export function buildApprovalNotification({ client, records = [], dashboardUrl = DEFAULT_DASHBOARD, tiers = ['red'], maxItems = 6, runId = null } = {}) {
  const urgent = records.filter((r) => tiers.includes(r.tier));
  if (!urgent.length) return null;
  const counts = { green: 0, amber: 0, red: 0 };
  for (const r of records) if (counts[r.tier] != null) counts[r.tier]++;
  const shown = urgent.slice(0, maxItems);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${urgent.length} change${urgent.length === 1 ? '' : 's'} need${urgent.length === 1 ? 's' : ''} your review — ${client}`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `queue: 🔴 ${counts.red} dangerous · 🟠 ${counts.amber} mild · 🟢 ${counts.green} vetted${runId ? ` · run \`${runId}\`` : ''}` }] },
    { type: 'divider' },
  ];
  for (const r of shown) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: describeRecord(r) },
      accessory: { type: 'button', text: { type: 'plain_text', text: 'Review →', emoji: true }, url: approvalsLink(dashboardUrl, client, r.taskId), action_id: `review-${r.taskId}` },
    });
  }
  if (urgent.length > shown.length) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `…and ${urgent.length - shown.length} more in the queue.` }] });
  }
  blocks.push({
    type: 'actions',
    elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Open the full queue', emoji: true }, url: approvalsLink(dashboardUrl, client), action_id: 'open-queue' }],
  });
  return {
    text: `${urgent.length} change(s) need review — ${client}: ${approvalsLink(dashboardUrl, client)}`, // notification fallback
    blocks,
    _urgentCount: urgent.length, // internal (callers/log lines); Slack ignores unknown keys
  };
}

/** PURE: a held YMYL blog PR → one actionable Slack message with the PR link. */
export function buildHeldPrNotification({ client, title, prUrl = null, reason = 'YMYL — held for human review' } = {}) {
  if (!title) return null;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `✍️ Blog post held for review — ${client}`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${trunc(title, 150)}*\n_${trunc(reason, 160)}_\nMerge = publish · Close = drop. Nothing ships until you decide.` } },
  ];
  if (prUrl) blocks.push({ type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Review the PR', emoji: true }, url: prUrl, action_id: 'open-pr' }] });
  return { text: `Blog post held for review — ${title}${prUrl ? ` · ${prUrl}` : ''}`, blocks };
}

/** PURE: pre-call "call ammo" for a CONFIRMED lead — what the closer reads in 30 seconds
 *  before dialing: score, where it hurts, what we'd pitch, one link to the full audit. */
export function buildCallAmmoMessage({ name = null, domain, phone = null, apptTime = null, score = null, bySeverity = {}, byRule = [], proposals = [], reportUrl = null, facts = [] } = {}) {
  if (!domain) return null;
  const who = name ? `${name} — ${domain}` : domain;
  const meta = [];
  if (apptTime) meta.push(`📅 ${trunc(apptTime, 40)}`);
  if (phone) meta.push(`📱 ${trunc(phone, 24)}`);
  meta.push(`score *${score ?? '?'}/100* · 🔴 ${bySeverity.critical ?? 0} 🟠 ${bySeverity.high ?? 0} 🟡 ${bySeverity.medium ?? 0}`);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📞 Call ammo — ${trunc(who, 120)}`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: meta.join(' · ') }] },
  ];
  // Teardown one-liners (speed / booking / AI access / panel) — the 10-second read.
  if (facts.length) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: facts.map((f) => trunc(String(f), 60)).join(' · ') }] });
  const issues = byRule.slice(0, 5).map((r) => `• \`${r.rule}\` — ${r.count}× (${r.severity})`).join('\n');
  const pitch = proposals.slice(0, 5).map((pp) => `• ${trunc(pp.type || 'fix', 40)} on \`${trunc(String(pp.page || '').replace(/^https?:\/\/[^/]+/, '') || '/', 40)}\``).join('\n');
  if (issues) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Where it hurts:*\n${issues}` } });
  if (pitch) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*What we'd pitch:*\n${pitch}` } });
  if (!issues && !pitch) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `Site audits clean at ${score}/100 — the pitch is maintenance + AI-visibility, not repairs.` } });
  if (reportUrl) blocks.push({ type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Full audit', emoji: true }, url: reportUrl, action_id: 'open-ammo' }] });
  return { text: `Call ammo — ${who}: ${score ?? '?'}/100${reportUrl ? ` · ${reportUrl}` : ''}`, blocks };
}

/** PURE: the founder's weekly SEO checklist (founders+AI lane — src/action-plan.mjs).
 *  null when nothing needs the founder (quiet weeks stay quiet). Deep link mirrors the
 *  approvals `?focus=` pattern onto the dashboard /todo page. */
export function buildWeeklyTodoNotification({ client, brand = null, founderWeek = [], autoVerified = null, dashboardUrl = DEFAULT_DASHBOARD, founderName = null } = {}) {
  const tasks = (founderWeek || []).filter((t) => t && t.title);
  const doneBits = [];
  if (autoVerified?.verified?.length) doneBits.push(`✅ ${autoVerified.verified.length} finished task(s) verified themselves`);
  if (autoVerified?.reopened?.length) doneBits.push(`⚠ ${autoVerified.reopened.length} REGRESSED and reopened`);
  if (!tasks.length && !doneBits.length) return null;
  const todoLink = (taskId = null) => `${String(dashboardUrl).replace(/\/+$/, '')}/todo?client=${encodeURIComponent(client)}${taskId ? `&focus=${encodeURIComponent(taskId)}` : ''}`;
  const totalMin = tasks.reduce((s, t) => s + (Number(t.effortMin) || 0), 0);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📋 Your SEO week — ${brand || client}`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${founderName ? `${founderName}: ` : ''}${tasks.length} task(s) · ~${totalMin} min total · everything else runs itself${doneBits.length ? ` · ${doneBits.join(' · ')}` : ''}` }] },
    { type: 'divider' },
  ];
  for (const t of tasks) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `☐ *${trunc(t.title, 140)}* _(~${t.effortMin}m${t.cadence && t.cadence !== 'once' ? ` · ${t.cadence}` : ''})_\n${trunc(t.why, 150)}` },
      accessory: { type: 'button', text: { type: 'plain_text', text: 'How →', emoji: true }, url: todoLink(t.id), action_id: `todo-${t.id}` },
    });
  }
  blocks.push({ type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Open the full plan', emoji: true }, url: todoLink(), action_id: 'open-todo' }] });
  return { text: `Your SEO week — ${brand || client}: ${tasks.length} task(s), ~${totalMin} min · ${todoLink()}`, blocks, _taskCount: tasks.length };
}

/** Orchestrator for the weekly founder checklist (called from the weekly routine). */
export async function notifyFounderTodo(cfg, plan = {}, { log = () => {}, env = process.env, send = postSlack } = {}) {
  const t = notifyTargets(cfg, env);
  const target = { botToken: t.botToken, channel: t.channels.approvals || t.channels.csuite, webhook: t.webhook };
  if (!(target.botToken && target.channel) && !target.webhook) return { delivered: false, note: 'no slack transport (set SLACK_BOT_TOKEN + a channel, or SEO_BOT_SLACK_WEBHOOK)' };
  const payload = buildWeeklyTodoNotification({ client: cfg.name, brand: cfg.brand, founderWeek: plan.founderWeek, autoVerified: plan.autoVerified, dashboardUrl: t.dashboardUrl, founderName: cfg.deepAudit?.founder?.name || null });
  if (!payload) { log('  slack todo: nothing needs the founder this week — staying quiet'); return { delivered: false, note: 'nothing for the founder' }; }
  const r = await send(target, payload);
  log(`  slack todo: ${r.delivered ? `sent — ${payload._taskCount} founder task(s)` : `NOT delivered (${r.note})`}`);
  return r;
}

/** PURE: proposed strategy bets awaiting human approval. null when none (quiet weeks quiet).
 *  Approval is a deliberate human act: the card carries the exact CLI command per bet. */
export function buildBetProposalNotification({ client, brand = null, placed = [], record = null, dashboardUrl = DEFAULT_DASHBOARD } = {}) {
  const bets = (placed || []).filter((b) => b && b.title);
  if (!bets.length) return null;
  const rec = record ? `agent record: ${record.hit}H/${record.miss}M${record.hitRate !== null ? ` · ${record.hitRate}% hit-rate` : ' · nothing judged yet'}` : null;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `🎯 ${bets.length} strategy bet(s) await your call — ${brand || client}`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `The agent stakes its record on these. Nothing runs until you approve.${rec ? ` · ${rec}` : ''}` }] },
    { type: 'divider' },
  ];
  for (const b of bets) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${trunc(b.title, 130)}*\n${trunc(b.action, 160)}\nexpects \`${b.metric}\` ${b.expectedDirection === 'down' ? 'to drop' : 'to rise'} by *${b.horizonDate}* (now: ${b.placedValue})\n_${trunc(b.why, 140)}_\n\`bets ${client} --approve ${b.id}\` · \`--reject ${b.id}\`` } });
  }
  blocks.push({ type: 'actions', elements: [{ type: 'button', style: 'primary', text: { type: 'plain_text', text: 'See the scoreboard', emoji: true }, url: `${String(dashboardUrl).replace(/\/+$/, '')}/todo?client=${encodeURIComponent(client)}`, action_id: 'open-bets' }] });
  return { text: `${bets.length} strategy bet(s) await approval — ${brand || client}`, blocks, _betCount: bets.length };
}

/** Orchestrator for the bet-proposal card. */
export async function notifyBetProposals(cfg, { placed = [], record = null } = {}, { log = () => {}, env = process.env, send = postSlack } = {}) {
  const t = notifyTargets(cfg, env);
  const target = { botToken: t.botToken, channel: t.channels.approvals || t.channels.csuite, webhook: t.webhook };
  if (!(target.botToken && target.channel) && !target.webhook) return { delivered: false, note: 'no slack transport' };
  const payload = buildBetProposalNotification({ client: cfg.name, brand: cfg.brand, placed, record, dashboardUrl: t.dashboardUrl });
  if (!payload) return { delivered: false, note: 'no bets to propose' };
  const r = await send(target, payload);
  log(`  slack bets: ${r.delivered ? `sent — ${payload._betCount} proposal(s)` : `NOT delivered (${r.note})`}`);
  return r;
}

/** POST a payload to a Slack incoming webhook. NEVER throws; 8s hard timeout. */
export async function sendSlack(webhook, payload) {
  if (!webhook) return { delivered: false, note: 'no webhook' };
  if (!payload) return { delivered: false, note: 'nothing to send' };
  try {
    const { _urgentCount, ...body } = payload;
    const res = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { delivered: false, status: res.status, note: `slack replied ${res.status}` };
    return { delivered: true, status: res.status };
  } catch (e) { return { delivered: false, note: String(e && e.message || e).slice(0, 120) }; }
}

/** POST via a Slack BOT TOKEN (chat.postMessage). NEVER throws; 8s hard timeout.
 *  Slack replies 200 with {ok:false,error} on failures — both layers are checked. */
export async function sendSlackBot(token, channel, payload) {
  if (!token || !channel) return { delivered: false, note: 'no bot token/channel' };
  if (!payload) return { delivered: false, note: 'nothing to send' };
  try {
    const { _urgentCount, ...body } = payload;
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, unfurl_links: false, ...body }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) return { delivered: false, status: res.status, note: `slack api: ${j.error || res.status}` };
    return { delivered: true, ts: j.ts || null, channel: j.channel || channel };
  } catch (e) { return { delivered: false, note: String(e && e.message || e).slice(0, 120) }; }
}

/** ONE door for every Slack send: bot token first (named channel), webhook fallback.
 *  target = { botToken, channel, webhook }. Never throws. */
export async function postSlack(target = {}, payload, { botSend = sendSlackBot, hookSend = sendSlack } = {}) {
  if (target.botToken && target.channel) return botSend(target.botToken, target.channel, payload);
  if (target.webhook) return hookSend(target.webhook, payload);
  return { delivered: false, note: 'no slack transport (set SLACK_BOT_TOKEN + channel, or SEO_BOT_SLACK_WEBHOOK)' };
}

/** Orchestrator for the pending push: filter → build → send → one honest log line. */
export async function notifyApprovals(cfg, { records = [], runId = null } = {}, { log = () => {}, env = process.env, send = postSlack } = {}) {
  const t = notifyTargets(cfg, env);
  const target = { botToken: t.botToken, channel: t.channels.approvals || t.channels.csuite, webhook: t.webhook };
  if (!(target.botToken && target.channel) && !target.webhook) return { delivered: false, note: 'no slack transport (set SLACK_BOT_TOKEN + SEO_BOT_SLACK_CHANNEL_APPROVALS, or SEO_BOT_SLACK_WEBHOOK)' };
  const payload = buildApprovalNotification({ client: cfg.name, records, dashboardUrl: t.dashboardUrl, tiers: t.tiers, maxItems: t.maxItems, runId });
  if (!payload) { log(`  slack notify: queue has no ${t.tiers.join('/')} items — staying quiet`); return { delivered: false, note: 'nothing urgent' }; }
  const r = await send(target, payload);
  log(`  slack notify: ${r.delivered ? `sent — ${payload._urgentCount} item(s) + deep links` : `NOT delivered (${r.note})`}`);
  return r;
}

/** Orchestrator for a held YMYL blog PR. */
export async function notifyHeldPr(cfg, { title, prUrl = null, reason } = {}, { log = () => {}, env = process.env, send = postSlack } = {}) {
  const t = notifyTargets(cfg, env);
  const target = { botToken: t.botToken, channel: t.channels.approvals || t.channels.csuite, webhook: t.webhook };
  if (!(target.botToken && target.channel) && !target.webhook) return { delivered: false, note: 'no slack transport (set SLACK_BOT_TOKEN + a channel, or SEO_BOT_SLACK_WEBHOOK)' };
  const payload = buildHeldPrNotification({ client: cfg.name, title, prUrl, reason });
  if (!payload) return { delivered: false, note: 'no title' };
  const r = await send(target, payload);
  log(`  slack notify: ${r.delivered ? 'held-PR alert sent' : `NOT delivered (${r.note})`}`);
  return r;
}
