# Fan-Out Extraction & Brand Hardwiring — July 2026 refresh

Sources: Edward Sturm (edwardsturm.com "How to Get Shown in LLMs in 2026" + his YouTube shorts on
finding ChatGPT's fan-out queries), Quentin Yacoub (5.3/5.4 extraction bookmarklet write-up),
Nectiv (5.4 API method), Seer Interactive ("ChatGPT 5.5's fanout patterns reveal the importance
of brand"), Lily Ray (commentary on fan-outs + Google's AI search report). Notes are our own
summary of their published methods; all credit to the authors.

## 1 · The Sturm DevTools recipe (the original manual method)

CLAIM: ChatGPT's real fan-out sub-queries can be read from the browser network layer of a live
conversation: open DevTools → Network, filter by the conversation id (the string after `/c/` in
the URL), refresh, open the matching request's Response, and search for "queries". Typically
reveals the 1–3 searches the model actually ran.
EVIDENCE: Sturm's published walkthrough + video demos; independently reproduced by multiple
practitioners (Practical Ecommerce, TheSEOCentral wrote step-by-step versions).
TIER: high (verified practitioner method, multiple independent reproductions)

Our `measure/fanout-capture.mjs` automates exactly this posture (network-layer capture from the
real consumer app, stealth browser, fail-closed on block).

## 2 · The 5.3/5.4 relocation — fields moved, payload still has them

CLAIM: Newer ChatGPT versions hid fan-outs from the old console location, but the authenticated
`/backend-api/conversation/{conversationId}` JSON still carries them across several nested
fields: `search_model_queries`, `search_queries`, `queries`, `thoughts` (reasoning text), and
`product_lookup_data.request_query` (shopping). Cited sources ride along in
`content_references.items[].url`, `safe_urls[]`, and `search_result_group` entries
({title, url, snippet}); product images in `product_entity.image_urls`.
EVIDENCE: Yacoub's extraction bookmarklet (recursive traversal of the conversation JSON on the
authed session, same-origin); Nectiv independently documents the console hiding in 5.4.
TIER: high for the field map (working public tooling), medium for stability (fields have already
moved once — expect them to move again).

ENGINE CHANGE (this refresh): `extractFromNetwork` now does a recursive JSON walk over all the
known query fields (regex sweep kept as a fragment fallback), and a new
`extractCitationsFromNetwork` pulls the citation/result structures so a capture carries
fan-out → cited-source in one pass. We deliberately do NOT harvest `thoughts` as sub-queries
(reasoning prose ≠ executed searches; polluting the sub-query set would corrupt coverage math).

## 3 · The API fallback when the UI hides everything

CLAIM: The OpenAI Responses API with the `web_search` tool (`tool_choice: auto`) returns the
executed search queries and `url_citation` annotations in the response output — an
always-available fallback when the consumer UI hides fan-outs entirely.
EVIDENCE: Nectiv's published Python script against `gpt-5.4`.
TIER: medium-high (works, but it is the API surface — our own measurement doctrine notes API
behavior ≠ consumer-app behavior, so treat as fallback, not ground truth).

## 4 · Brand hardwiring — brands INSIDE the fan-out (the strategic shift)

CLAIM: ChatGPT 5.5 fan-outs increasingly contain brand names rather than generic keywords
(e.g. branded sub-queries naming specific agencies/people instead of "top GEO agencies"). A brand
appearing in the fan-out itself means the model treats it as synonymous with the topic — "you are
not in the result, you are the result" — and branded sub-queries structurally favor the named
brand's own content.
EVIDENCE: Seer Interactive, 617-prompt study + one prompt run 30×; named individuals appeared in
~50% of responses for their test prompt.
TIER: medium-high (single vendor study, but large-n and consistent with Lily Ray's independent
commentary that fan-outs now carry significant brand names)

CLAIM: Fan-outs are wildly non-deterministic run to run — Seer measured ~0.1% overlap in query
fan-outs across Gemini 3 runs (ChatGPT 5.5 similar). A single captured fan-out is an anecdote,
not a signal.
EVIDENCE: Seer Interactive overlap measurement across repeated runs.
TIER: medium-high
IMPLICATION: any fan-out KPI must aggregate MANY runs before claiming signal.

ENGINE CHANGE (this refresh): new `brandFanoutVisibility(captures, cfg)` KPI — share of usable
captures whose sub-queries contain our brand vs competitors, with a hard `insufficient-runs`
floor (default ≥5 usable captures) so single-run noise can never print a hardwiring verdict.
Competitors at ≥50% share get flagged as `hardwiredCompetitors` (their hardwiring is our
mention-gap work-order).

## 5 · Supporting signals (same sources)

CLAIM: Bing Webmaster Tools' grounding-queries report is a free first-party window into fan-out
visibility (which of your pages ground AI answers).
EVIDENCE: Seer recommends it as the tracking surface for the fan-out KPI. TIER: medium.

CLAIM: ChatGPT injects the current year into fan-outs for recency ("2026" modifiers).
EVIDENCE: Lily Ray commentary; consistent with our E1091 drift linter, which already lints
stale/missing year tokens against captured fan-outs. TIER: high (already encoded).

CLAIM: Google's new AI search report (Search Console) ships without brand-mention or fan-out
tracking, limiting its value for GEO measurement.
EVIDENCE: Lily Ray public commentary on the report. TIER: medium (product will iterate).

CLAIM: Sturm's on-page loop for discovered fan-outs: create/adjust pages targeting the exact
sub-query phrasing (title, meta, slug, H1, opening sentence, question-H2s on related pages),
then reinforce with internal links.
EVIDENCE: his published playbook; consistent with the +161% main+sub-query citation-odds finding
already in the registry. TIER: high (matches existing encoded evidence).

## What the bot does with this (status)

- capture: multi-field recursive extraction + citations — SHIPPED (this refresh)
- brand-in-fanout KPI with run floor — SHIPPED (this refresh), surfacing in fanout reports
- year-token drift linting vs captured fan-outs — already shipped (E1091 round 2)
- coverage planning across sub-queries — already shipped (`fanout-plan`)
- Bing grounding-queries ingestion — TODO (needs Bing WMT API creds per client)
- monthly co-citation tracking (who appears NEXT TO us in fan-outs/answers) — TODO (cheap add
  on top of captured citations)
