// seo-bot · content/templates — proven med-spa content patterns. Each is a BRIEF
// skeleton filled from a real DATA TABLE (prices, sources, reviewer) — the brief is
// the contract the gates enforce. Includes Edward Sturm's Compact-Keyword BOFU page
// (service×city conversion page) + his page-per-LLM-query GEO shape.

export const CONTENT_TEMPLATES = {
  compact_keyword: {
    name: 'Compact Keyword — BOFU conversion page (Sturm)',
    intent: 'bottom-of-funnel purchase intent; ONE page per service×city, not a blog',
    targetShape: ['{service} cost {city}', '{service} near me {city}', 'best {service} {neighborhood}'],
    wordTarget: [350, 500],
    sections: ['Direct answer + local price up top', 'What affects the price (3-4 bullets)', 'Why here / local proof', 'Single book/consult CTA'],
    requiredData: ['local price range (real)', 'one local proof (reviews/credentials)', 'booking URL'],
    schemaTypes: ['MedicalBusiness', 'Service', 'Offer'],
    ymyl: true,
  },
  cost_guide: {
    name: 'Cost guide — answer-box bait',
    intent: 'informational+commercial; "/cost/{service}" with real local prices',
    wordTarget: [600, 900],
    sections: ['40-60w answer capsule (price range)', 'Price table by city/tier', 'What drives price', 'Common questions (40-60w answer-islands)'],
    requiredData: ['low/median/high price (real, dated)', 'price drivers', '2 primary sources'],
    schemaTypes: ['Article', 'Service'],
    ymyl: true,
  },
  treatment_explainer: {
    name: 'Treatment explainer (YMYL)',
    intent: 'informational; what it is / how it works / risks',
    wordTarget: [800, 1400],
    sections: ['FDA indication + mechanism', 'Hedged, cited results', 'PROMINENT risks/contraindications', 'Named reviewer'],
    requiredData: ['FDA clearance/indication', 'cited efficacy (hedged)', 'risk list', 'medical reviewer'],
    schemaTypes: ['Article', 'MedicalProcedure'],
    ymyl: true,
  },
  comparison: {
    name: 'Comparison (objective)',
    intent: '"{service} vs {alt}" — objective spec matrix; honestly recommend per use-case',
    wordTarget: [700, 1100],
    sections: ['Spec matrix table', 'Best for X / best for Y', 'Honest recommendation (NEVER self-rank #1)'],
    requiredData: ['objective spec rows', '2 primary sources'],
    schemaTypes: ['Article', 'Service'],
    ymyl: true,
  },
  faq_cluster: {
    name: 'FAQ cluster (from real queries)',
    intent: 'answer real GSC/AI-visibility questions; one cited fact per answer',
    wordTarget: [500, 900],
    sections: ['Q/A pairs from real query data', 'one cited fact each', 'answer-island structure (no FAQ rich schema — deprecated May 2026)'],
    requiredData: ['real query list', 'one primary source per answer'],
    schemaTypes: ['Article', 'Service'],
    ymyl: true,
  },
};

export const TEMPLATE_IDS = Object.keys(CONTENT_TEMPLATES);
