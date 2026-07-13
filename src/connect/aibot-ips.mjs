// seo-bot · connect/aibot-ips — AI-crawler verification (FREE, no key). Fetches the
// official IP-range JSONs the AI vendors now publish and verifies that a hit claiming to
// be GPTBot/ClaudeBot/PerplexityBot/OAI-SearchBot really came from their network (UA can
// be spoofed; CIDR can't). Closes the AEO loop: the bot tracks CITATIONS but had no proof
// the engines actually CRAWLED the pages. Feed a server access-log to see per-bot crawl
// frequency + last-crawled, and alert when a bot's fetch count drops to zero.

const SOURCES = {
  GPTBot: 'https://openai.com/gptbot.json',
  'OAI-SearchBot': 'https://openai.com/searchbot.json',
  'ChatGPT-User': 'https://openai.com/chatgpt-user.json',
  PerplexityBot: 'https://www.perplexity.com/perplexitybot.json',
  ClaudeBot: 'https://claude.com/crawling/bots.json',
};

export async function fetchBotRanges({ log = () => {} } = {}) {
  const ranges = {};
  for (const [bot, url] of Object.entries(SOURCES)) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) { ranges[bot] = { error: `status ${r.status}` }; continue; }
      const j = await r.json();
      const prefixes = (j.prefixes || j.creationTime ? j.prefixes : j) || [];
      ranges[bot] = { cidrs: (prefixes || []).map((p) => p.ipv4Prefix || p.ipv6Prefix).filter(Boolean), creationTime: j.creationTime };
      log(`  ${bot}: ${ranges[bot].cidrs.length} CIDRs`);
    } catch (e) { ranges[bot] = { error: String(e.message || e) }; }
  }
  return ranges;
}

function ip4ToInt(ip) { const p = ip.split('.').map(Number); if (p.length !== 4 || p.some((x) => Number.isNaN(x))) return null; return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; }
function inCidr4(ip, cidr) {
  const [base, bitsStr] = cidr.split('/'); const bits = parseInt(bitsStr, 10);
  const a = ip4ToInt(ip), b = ip4ToInt(base); if (a === null || b === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

/** Verify an IP belongs to the claimed bot. ipv6 falls back to a prefix-string check. */
export function verifyBot(ip, claimedBot, ranges) {
  const r = ranges[claimedBot];
  if (!r || r.error || !r.cidrs) return { verified: false, reason: 'no ranges for ' + claimedBot };
  const v4 = ip.includes('.');
  const hit = r.cidrs.some((c) => (v4 && c.includes('.') ? inCidr4(ip, c) : ip.startsWith(c.split('/')[0].split(':').slice(0, 3).join(':'))));
  return { verified: hit, bot: claimedBot };
}

const UA_BOT = [/GPTBot/i, /OAI-SearchBot/i, /ChatGPT-User/i, /PerplexityBot/i, /ClaudeBot/i, /Claude-User/i, /Google-Extended/i, /Googlebot/i, /Bingbot/i];
const matchBot = (ua) => (UA_BOT.find((re) => re.test(ua || '')) || '').toString().replace(/[/\\i]/g, '').replace(/\^|\$/g, '') || null;

/** Parse a combined/common access log: count hits + last-seen per AI bot, flag unverified. */
export async function analyzeCrawlLog(logText, { ranges = null, log = () => {} } = {}) {
  ranges = ranges || (await fetchBotRanges({ log }));
  const lines = String(logText || '').split('\n');
  const stats = {};
  const LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:GET|HEAD|POST) ([^ "]+)[^"]*" \d+ \d+ "[^"]*" "([^"]*)"/;
  for (const ln of lines) {
    const m = ln.match(LINE); if (!m) continue;
    const [, ip, ts, , ua] = m;
    const bot = (UA_BOT.find((re) => re.test(ua)) ? (ua.match(/(GPTBot|OAI-SearchBot|ChatGPT-User|PerplexityBot|ClaudeBot|Claude-User|Google-Extended|Googlebot|Bingbot)/i) || [])[0] : null);
    if (!bot) continue;
    const key = bot.replace(/^Google-Extended$/, 'Google-Extended');
    stats[key] = stats[key] || { hits: 0, verified: 0, spoofed: 0, lastSeen: null };
    stats[key].hits++;
    stats[key].lastSeen = ts;
    if (ranges[key]?.cidrs) { const v = verifyBot(ip, key, ranges); v.verified ? stats[key].verified++ : stats[key].spoofed++; }
  }
  for (const [bot, s] of Object.entries(stats)) log(`  ${bot}: ${s.hits} hits (${s.verified} verified, ${s.spoofed} unverified) · last ${s.lastSeen}`);
  return { stats, ranges };
}
