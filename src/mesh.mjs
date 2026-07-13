// seo-bot · mesh — semantic candidate-link generator (the "what should link to what").
//
// For every page, find the topK most topically-related OTHER pages and emit candidate
// internal links {src, tgt, score, paragraphOffset} — excluding links that already exist
// and self-links. The sculptor (sculpt.mjs) then picks which candidates to actually place.
//
// EMBEDDINGS ARE OPTIONAL. If cfg.mesh.embeddings is explicitly configured (a local
// model — Ollama nomic-embed / bge), we use cosine over real embeddings. OTHERWISE we
// fall back to a TF-IDF term-overlap cosine that runs with ZERO external deps and no
// network — so the mesh works out-of-the-box on the Mac Mini with nothing installed.
// (Per the plan, embeddings are a "try local only if configured" nicety, never required.)

const STOP = new Set(('a an and are as at be by for from has have in is it its of on or that the to was were will with your you our we us this these those they their he she his her not but if then so than too very can could should would may might must do does did been being also more most other some such only own same about into over under after before between out off down up out near here there what which who whom where when why how').split(' '));

const WORD_RE = /[a-z][a-z0-9'-]{1,}/g;

/** Tokenize visible text → lowercased content terms (stopwords + very-short words dropped). */
export function tokenize(text) {
  const out = [];
  for (const m of (text || '').toLowerCase().matchAll(WORD_RE)) {
    const w = m[0].replace(/^['-]+|['-]+$/g, '');
    if (w.length >= 3 && !STOP.has(w)) out.push(w);
  }
  return out;
}

/** Term-frequency map for one document's tokens. */
function tf(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/**
 * Build TF-IDF vectors for a set of docs. Returns vectors as Map<term, weight>, L2-normalized
 * so a dot product IS the cosine similarity. Pure, zero-dep, deterministic.
 * @param {Array<{tokens:string[]}>} docs
 */
export function tfidfVectors(docs) {
  const N = docs.length || 1;
  const df = new Map();
  const tfs = docs.map((d) => {
    const m = tf(d.tokens);
    for (const term of m.keys()) df.set(term, (df.get(term) || 0) + 1);
    return m;
  });
  return tfs.map((m) => {
    const vec = new Map();
    let norm = 0;
    for (const [term, freq] of m) {
      const idf = Math.log((N + 1) / ((df.get(term) || 0) + 1)) + 1; // smoothed idf
      const w = (1 + Math.log(freq)) * idf; // sublinear tf × idf
      vec.set(term, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const term of vec.keys()) vec.set(term, vec.get(term) / norm);
    return vec;
  });
}

/** Cosine of two L2-normalized sparse Map vectors = dot product. Iterate the smaller map. */
export function cosine(a, b) {
  if (!a || !b) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) { const o = big.get(t); if (o) dot += w * o; }
  return dot;
}

/** Optional local embedding backend. Only used when cfg.mesh.embeddings is configured. */
async function embedDocs(texts, embedCfg, { log = () => {} } = {}) {
  // embedCfg = { url:"http://127.0.0.1:11434/api/embeddings", model:"nomic-embed-text" }
  const url = embedCfg.url || 'http://127.0.0.1:11434/api/embeddings';
  const model = embedCfg.model || 'nomic-embed-text';
  const vecs = [];
  for (const text of texts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`embed ${res.status}`);
    const j = await res.json();
    vecs.push(j.embedding || j.data?.[0]?.embedding || []);
  }
  log(`  mesh: embedded ${vecs.length} docs via ${model}`);
  // Convert dense arrays to L2-normalized Map<index, w> so cosine() works uniformly.
  return vecs.map((arr) => {
    let norm = Math.sqrt(arr.reduce((s, x) => s + x * x, 0)) || 1;
    const m = new Map();
    arr.forEach((x, i) => m.set(i, x / norm));
    return m;
  });
}

/** Find the earliest body paragraph offset (word index) where the target topic is mentioned,
 *  so the sculptor inserts the link inside genuinely-relevant existing prose (anti-slop). */
function bestParagraphOffset(srcDoc, tgtVec) {
  const paras = srcDoc.paragraphs || [];
  let best = { paragraphOffset: 0, paraIdx: -1, score: 0 };
  let wordCursor = 0;
  for (let i = 0; i < paras.length; i++) {
    const pv = paras[i].vec;
    const s = pv ? cosine(pv, tgtVec) : 0;
    if (s > best.score) best = { paragraphOffset: wordCursor, paraIdx: i, score: s };
    wordCursor += paras[i].words;
  }
  return best;
}

/**
 * Generate candidate internal links for every page.
 * @param {Array} pages  page docs: { url, text, paragraphs?:[{text,words}], existingTargets?:Set<string> }
 *                        `text` = visible body text; `existingTargets` = URLs already linked FROM this page.
 * @param {{cfg:object, topK?:number, minScore?:number, log?:Function}} options
 * @returns {Promise<Array<{src,tgt,score,paragraphOffset}>>} candidate edges (existing links + self excluded).
 *
 * Embeddings used only when cfg.mesh.embeddings is set; otherwise TF-IDF cosine (zero deps).
 */
export async function candidateLinks(pages, { cfg = {}, topK = 5, minScore, log = () => {} } = {}) {
  const docs = pages.map((p) => ({ url: p.url, text: p.text || '', existing: p.existingTargets || new Set(), paragraphs: p.paragraphs || [] }));
  const meshCfg = cfg.mesh || {};
  const floor = minScore ?? meshCfg.minScore ?? (meshCfg.embeddings ? 0.6 : 0.08); // TF-IDF cosines run lower than dense embeddings
  let vecs, paraVecsByDoc = null, mode = 'tfidf';

  if (meshCfg.embeddings) {
    try {
      vecs = await embedDocs(docs.map((d) => d.text), meshCfg.embeddings, { log });
      mode = 'embeddings';
    } catch (e) {
      log(`  mesh: embeddings unavailable (${String(e.message || e).slice(0, 80)}) — falling back to TF-IDF`);
    }
  }
  if (!vecs) {
    // TF-IDF over whole-doc tokens; also vectorize paragraphs in the SAME idf space so
    // paragraph offsets are comparable to the target doc vector.
    const docTokens = docs.map((d) => ({ tokens: tokenize(d.text) }));
    vecs = tfidfVectors(docTokens);
    // Per-paragraph vectors reuse the doc idf implicitly via a second tfidf pass over all paras.
    const allParas = [];
    const paraIndex = docs.map((d) => d.paragraphs.map((p) => { allParas.push({ tokens: tokenize(p.text) }); return allParas.length - 1; }));
    const paraVecs = tfidfVectors(allParas);
    paraVecsByDoc = docs.map((d, di) => d.paragraphs.map((p, pi) => ({ words: p.words, vec: paraVecs[paraIndex[di][pi]] })));
  }

  const candidates = [];
  for (let i = 0; i < docs.length; i++) {
    const scored = [];
    for (let j = 0; j < docs.length; j++) {
      if (i === j) continue;
      if (docs[i].existing.has(docs[j].url)) continue; // already linked — skip
      const s = cosine(vecs[i], vecs[j]);
      if (s >= floor) scored.push({ tgt: docs[j].url, score: Math.round(s * 1000) / 1000, j });
    }
    scored.sort((a, b) => b.score - a.score);
    for (const c of scored.slice(0, topK)) {
      let paragraphOffset = 0;
      if (paraVecsByDoc) {
        const off = bestParagraphOffset({ paragraphs: paraVecsByDoc[i] }, vecs[c.j]);
        paragraphOffset = off.paragraphOffset;
      }
      candidates.push({ src: docs[i].url, tgt: c.tgt, score: c.score, paragraphOffset });
    }
  }
  log(`  mesh: ${candidates.length} candidate links across ${docs.length} pages (mode: ${mode}, floor ${floor})`);
  return candidates;
}
