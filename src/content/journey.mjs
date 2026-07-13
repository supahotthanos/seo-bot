// seo-bot · content/journey — the per-client CONTENT JOURNEY: a dated posting calendar built from
// real demand signals, sequenced EASY→HARD so early posts can actually rank while authority builds
// toward the crowded heads. Every row targets BOTH end goals: an SEO keyword AND the AEO capsule
// question the post must answer in its first 60 words (the fan-out sub-queries are the AEO demand).
//
// Difficulty model (deterministic, explainable):
//   - striking-distance GSC queries (we already rank pos 8–20) = EASIEST (a nudge, not a fight)
//   - fan-out sub-queries from the query-bank panel = AEO demand with usually thin SERPs = EASY-MED
//   - corpus/competitor head topics ("best botox <city>") = HARD (sequenced last, weeks in)
// The journey is a living artifact: blog-post consumes the next due 'planned' row and marks it
// 'posted', so the daily cadence drives itself off this file.

const DAY = 864e5;

/** PURE: derive scored topic candidates from the available signals (any subset may be empty). */
export function topicsFromSignals({ strikingDistance = [], fanoutSubqueries = [], corpusTopics = [], city = '' } = {}) {
  const out = [];
  const seen = new Set();
  const push = (topic, t) => { const k = topic.toLowerCase().replace(/\s+/g, ' ').trim(); if (!k || seen.has(k)) return; seen.add(k); out.push({ topic: topic.trim(), ...t }); };
  for (const q of strikingDistance) {
    const kw = q.query || q.topic || String(q);
    // position 8–20: closer to 8 = easier. Map to 0.15–0.35.
    const pos = Number(q.position) || 14;
    push(kw, { source: 'gsc-striking-distance', difficulty: +(0.15 + Math.min(1, Math.max(0, (pos - 8) / 12)) * 0.2).toFixed(2), demand: Number(q.impressions) || 0, aeoQuestion: null });
  }
  for (const s of fanoutSubqueries) {
    const q = (s.q || s.topic || String(s)).trim();
    if (q.length < 8) continue;
    push(q, { source: 'ai-fanout', difficulty: 0.4, demand: Number(s.n) || 1, aeoQuestion: q.endsWith('?') ? q : null });
  }
  for (const c of corpusTopics) {
    const t = (c.topic || String(c)).trim();
    push(t, { source: 'competitor-corpus', difficulty: +(c.difficulty ?? 0.75), demand: Number(c.demand) || 0, aeoQuestion: null });
  }
  // Every topic gets an AEO capsule question (the thing the first 60 words must answer).
  for (const t of out) if (!t.aeoQuestion) t.aeoQuestion = /^(how|what|when|why|which|is|are|does|do|can|should)\b/i.test(t.topic) ? `${t.topic.replace(/\?+$/, '')}?` : `What should you know about ${t.topic}${city ? ` in ${city}` : ''}?`;
  return out;
}

/** PURE: sequence topics into a dated calendar — easy→hard within demand tiers, N posts/week. */
export function buildContentJourney(topics = [], { startDate = '', weeks = 13, perWeek = 3 } = {}) {
  const ranked = [...topics].sort((a, b) => (a.difficulty - b.difficulty) || (b.demand - a.demand));
  const slots = Math.min(ranked.length, weeks * perWeek);
  // Post days spread across the week: 3/wk = Mon/Wed/Fri; 7/wk = daily; else evenly.
  const dayOffsets = perWeek >= 7 ? [0, 1, 2, 3, 4, 5, 6]
    : perWeek === 3 ? [0, 2, 4]
    : Array.from({ length: Math.max(1, perWeek) }, (_, i) => Math.round(i * (6 / Math.max(1, perWeek - 1 || 1))));
  const t0 = Date.parse(startDate);
  if (!Number.isFinite(t0)) return { status: 'bad-start-date', rows: [] };
  const rows = [];
  for (let i = 0; i < slots; i++) {
    const week = Math.floor(i / perWeek);
    const off = dayOffsets[i % perWeek] ?? 0;
    const t = ranked[i];
    rows.push({
      n: i + 1, week: week + 1,
      date: new Date(t0 + (week * 7 + off) * DAY).toISOString().slice(0, 10),
      topic: t.topic, targetKeyword: t.topic, aeoQuestion: t.aeoQuestion,
      difficulty: t.difficulty, demand: t.demand, source: t.source, status: 'planned',
    });
  }
  return { status: rows.length ? 'ok' : 'empty', rows, weeks, perWeek, generatedFrom: topics.length };
}

/** PURE: the next journey row that is due (date ≤ today) and still 'planned'. */
export function nextDuePost(journey = { rows: [] }, todayIso = '') {
  const today = String(todayIso).slice(0, 10);
  return (journey.rows || []).find((r) => r.status === 'planned' && r.date <= today) || null;
}

/** PURE: mark a row posted (by n) — returns a new journey object. */
export function markPosted(journey = { rows: [] }, n, { slug = '', postedAt = '' } = {}) {
  return { ...journey, rows: (journey.rows || []).map((r) => (r.n === n ? { ...r, status: 'posted', slug, postedAt } : r)) };
}

export function renderJourneyMd(journey = { rows: [] }, { brand = '' } = {}) {
  const L = [
    `# Content journey — ${brand}`, '',
    '> Dated posting plan, sequenced EASY→HARD. Each post targets one SEO keyword AND one AEO capsule',
    '> question (answered in the first 60 words). blog-post consumes the next due row automatically.',
    '',
    `**${(journey.rows || []).length} posts · ${journey.perWeek}/week · ${journey.weeks} weeks**`, '',
    '| # | date | topic | difficulty | demand | source | AEO question | status |',
    '|---|------|-------|-----------|--------|--------|--------------|--------|',
    ...(journey.rows || []).map((r) => `| ${r.n} | ${r.date} | ${r.topic} | ${r.difficulty} | ${r.demand} | ${r.source} | ${r.aeoQuestion} | ${r.status} |`),
  ];
  return L.join('\n');
}
