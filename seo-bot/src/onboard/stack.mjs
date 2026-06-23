// seo-bot · onboard/stack — detect a site's tech stack, CDN, analytics, and
// (med-spa-specific) booking platform from response headers + raw HTML. Free, no
// Wappalyzer. Used during onboarding so recurring SEO knows what it's working with
// (which apply-adapter, whether booking/Reserve is wired, whether it's server-rendered).

const FRAMEWORKS = [
  [/__NEXT_DATA__|\/_next\//, 'Next.js'],
  [/id="__nuxt"|\/_nuxt\//, 'Nuxt'],
  [/wp-content|wp-json|wp-includes/, 'WordPress'],
  [/cdn\.shopify\.com|Shopify\./, 'Shopify'],
  [/static\.wixstatic\.com|wix\.com/, 'Wix'],
  [/squarespace\.com|static1\.squarespace/, 'Squarespace'],
  [/gatsby|___gatsby/, 'Gatsby'],
  [/data-reactroot|react/, 'React (generic)'],
  [/webflow/i, 'Webflow'],
  [/drupal/i, 'Drupal'],
];
const CDNS = [
  ['cf-ray', 'Cloudflare'], ['x-vercel-id', 'Vercel'], ['x-amz-cf-id', 'AWS CloudFront'],
  ['x-fastly-request-id', 'Fastly'], ['x-akamai-transformed', 'Akamai'], ['x-served-by', 'Fastly/Varnish'],
];
const BOOKING = [
  [/joinblvd|blvd\.co|boulevard/i, 'Boulevard'],
  [/vagaro\.com/i, 'Vagaro'],
  [/mindbody|mindbodyonline/i, 'Mindbody'],
  [/zenoti/i, 'Zenoti'],
  [/calendly/i, 'Calendly'],
  [/squareup\.com\/appointments|square\.site/i, 'Square Appointments'],
  [/acuityscheduling|squarespace-scheduling/i, 'Acuity'],
  [/aestheticrecord/i, 'Aesthetic Record'],
  [/getweave|podium/i, 'Podium/Weave (reviews/booking)'],
];
const ANALYTICS = [
  [/gtag\(|googletagmanager\.com\/gtag|google-analytics\.com/, 'Google Analytics / gtag'],
  [/googletagmanager\.com\/gtm/, 'Google Tag Manager'],
  [/connect\.facebook\.net|fbq\(/, 'Meta Pixel'],
  [/static\.hotjar\.com/, 'Hotjar'],
  [/clarity\.ms/, 'Microsoft Clarity'],
];

const firstMatch = (list, hay) => { for (const [re, name] of list) if ((re instanceof RegExp ? re.test(hay) : false)) return name; return null; };

/** @param headers a Headers object (or null). @param html raw HTML string. */
export function detectStack(html = '', headers = null) {
  const h = (k) => { try { return headers?.get(k) || ''; } catch { return ''; } };
  const generator = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i) || [])[1] || null;

  const frameworks = [];
  for (const [re, name] of FRAMEWORKS) if (re.test(html)) frameworks.push(name);

  const cdn = CDNS.find(([hdr]) => h(hdr))?.[1] || (/cloudflare/i.test(h('server')) ? 'Cloudflare' : null);

  const booking = [];
  for (const [re, name] of BOOKING) if (re.test(html)) booking.push(name);

  const analytics = [];
  for (const [re, name] of ANALYTICS) if (re.test(html)) analytics.push(name);

  // Reserve-with-Google / booking action schema present?
  const hasReserveAction = /"@type"\s*:\s*"(ReserveAction|OrderAction|FoodEstablishmentReservation)"|reserve.*google/i.test(html);

  return {
    server: h('server') || null,
    poweredBy: h('x-powered-by') || null,
    generator,
    frameworks: [...new Set(frameworks)],
    primaryFramework: frameworks[0] || (generator || null),
    cdn,
    booking: [...new Set(booking)],
    hasBooking: booking.length > 0,
    hasReserveAction,
    analytics: [...new Set(analytics)],
    // Which apply-adapter the recurring loop should use. Prefer the rendering layer
    // you actually deploy: a Next.js frontend is edited via PR even if it's headless-WP
    // sourced, so Next.js wins over a stray wp-json/wp-content reference.
    suggestedCms: frameworks.includes('Next.js') ? 'nextjs' : frameworks.includes('WordPress') ? 'wordpress' : 'dryrun',
  };
}
