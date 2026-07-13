// seo-bot · mcp-server — a thin MCP stdio server exposing existing capabilities
// (audit / propose / apply / measure / verify) as tools (Epic 16, work-unit A10).
//
// OTTO sells a hosted v2 MCP server (mcp.searchatlas.com, ~587 tools, JWT auth) only
// on standard tiers. We expose OUR loop as a local MCP stdio server for free, so
// internal agents (and Claude Code) can call audit/propose/apply/measure/verify like
// any MCP tool.
//
// Dependency-free by design (no @modelcontextprotocol/sdk — the no-deps rule). MCP is
// line-delimited JSON-RPC 2.0 over stdio: the client sends `initialize`, then
// `tools/list`, then `tools/call`. We implement that subset by hand. This is a
// documented, working skeleton — wire in stricter schema validation / notifications
// as needed.
//
// Run:  node seo-bot/src/mcp-server.mjs        (speaks JSON-RPC on stdin/stdout)
// Register it in an MCP client (e.g. Claude Code) as a stdio server with that command.
//
// SAFETY: tools that WRITE (apply) require an explicit { confirm: true } argument AND
// still go through the gated apply adapter (dryrun unless the client config says
// otherwise). Read-only tools (audit/propose/measure/verify) never write production.

import { loadConfig, listConfigs } from './config.mjs';

const PROTOCOL_VERSION = '2024-11-05'; // MCP stdio protocol revision we speak
const SERVER_INFO = { name: 'seo-bot', version: '1.0.0' };

/** Tool catalogue. Each maps an MCP tool call → an existing seo-bot capability. */
export const TOOLS = [
  {
    name: 'seo_audit',
    description: 'Crawl a client site (raw HTML, no JS) and return the SEO/AEO health score + findings. Read-only.',
    inputSchema: { type: 'object', properties: { client: { type: 'string', description: 'config name in seo-bot/config/<name>.json' }, maxPages: { type: 'number' } }, required: ['client'] },
    handler: async ({ client, maxPages }) => {
      const cfg = loadConfig(client);
      if (maxPages) cfg.audit.maxPages = Number(maxPages);
      const { runAudit } = await import('./audit.mjs');
      const r = await runAudit(cfg, { log: () => {} });
      return { score: r.score, bySeverity: r.bySeverity, topRules: r.byRule.slice(0, 10), pageCount: r.pageCount };
    },
  },
  {
    name: 'seo_propose',
    description: 'Audit + generate concrete, EV-ranked fix proposals (meta/title/schema/answer-capsule). Read-only — writes nothing to production.',
    inputSchema: { type: 'object', properties: { client: { type: 'string' } }, required: ['client'] },
    handler: async ({ client }) => {
      const cfg = loadConfig(client);
      const { buildProposals, saveProposals } = await import('./decide.mjs');
      const result = await buildProposals(cfg, { log: () => {} });
      saveProposals(result);
      return { score: result.score, count: result.proposals.length, proposals: result.proposals.map((p) => ({ id: p.id, type: p.type, page: p.page, severity: p.severity, priority: p.priority, autoApplicable: p.autoApplicable })) };
    },
  },
  {
    name: 'seo_apply',
    description: 'Apply the latest proposals via the client CMS adapter. GATED: requires confirm:true to execute writes; otherwise previews. High-traffic/YMYL pages are still queued by policy.',
    inputSchema: { type: 'object', properties: { client: { type: 'string' }, confirm: { type: 'boolean', description: 'true to execute writes (still gated by the adapter); false/omitted = preview only' } }, required: ['client'] },
    handler: async ({ client, confirm = false }) => {
      const cfg = loadConfig(client);
      const { applyClient } = await import('./apply/index.mjs');
      const r = await applyClient(cfg, { log: () => {}, confirm: !!confirm });
      return { adapter: cfg.cms?.type || 'dryrun', confirmed: !!confirm, applied: (r.applied || []).length, detail: (r.applied || []).slice(0, 20) };
    },
  },
  {
    name: 'seo_measure',
    description: 'Run AI-visibility tracking (drives the real chat apps; best-effort, needs Playwright). Read-only.',
    inputSchema: { type: 'object', properties: { client: { type: 'string' } }, required: ['client'] },
    handler: async ({ client }) => {
      const cfg = loadConfig(client);
      const { measure } = await import('./measure.mjs');
      const r = await measure(cfg, { log: () => {} });
      return { ok: !!r.ok, skipped: !!r.skipped, note: r.error || null };
    },
  },
  {
    name: 'seo_verify',
    description: 'Verify server-render of a client URL set (raw no-JS HTML), or score the build progress rubric. Read-only.',
    inputSchema: { type: 'object', properties: { client: { type: 'string' }, urls: { type: 'array', items: { type: 'string' }, description: 'optional explicit URL list; omit to score the build-progress rubric' } }, required: ['client'] },
    handler: async ({ client, urls }) => {
      const cfg = loadConfig(client);
      if (urls?.length) {
        const { verifyUrls } = await import('./verify.mjs');
        const out = await verifyUrls(cfg, urls, { log: () => {} });
        return { checked: out.length, passed: out.filter((v) => v.ok).length, results: out };
      }
      const { verifyBot } = await import('./verifier.mjs');
      const p = verifyBot(cfg, { log: () => {} });
      return { progressScore: p.score, gaps: p.gaps?.slice(0, 8) || [] };
    },
  },
  {
    name: 'seo_list_clients',
    description: 'List configured clients (config names). Read-only.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ clients: listConfigs() }),
  },
];

const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

/** Build a JSON-RPC result envelope. */
function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

/**
 * Dispatch one JSON-RPC request object → a response object (or null for notifications).
 * Exported so it can be unit-tested without spinning up the stdio loop.
 */
export async function handleRpc(msg) {
  const { id, method, params } = msg || {};
  // Notifications (no id) get no response.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return rpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    case 'notifications/initialized':
    case 'initialized':
      return null; // handshake ack — no response
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments || {};
      const tool = toolByName.get(name);
      if (!tool) return rpcError(id, -32602, `unknown tool: ${name}`);
      try {
        const out = await tool.handler(args);
        // MCP tool results are a content array; we return one JSON text block.
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false });
      } catch (e) {
        return rpcResult(id, { content: [{ type: 'text', text: `error: ${String(e.message || e)}` }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

/** Start the stdio JSON-RPC loop. Reads line-delimited JSON on stdin, writes on stdout. */
export function startStdioServer() {
  let buf = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { process.stderr.write(`seo-bot mcp: bad JSON line\n`); continue; }
      Promise.resolve(handleRpc(msg)).then((resp) => { if (resp) process.stdout.write(JSON.stringify(resp) + '\n'); }).catch((e) => {
        if (msg?.id != null) process.stdout.write(JSON.stringify(rpcError(msg.id, -32603, String(e.message || e))) + '\n');
      });
    }
  });
  process.stderr.write(`seo-bot MCP stdio server ready (protocol ${PROTOCOL_VERSION}, ${TOOLS.length} tools)\n`);
}

// Run the server when invoked directly (node src/mcp-server.mjs).
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startStdioServer();
