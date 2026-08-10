// Generic rescue toolkit for JavaScript-rendered ("SPA") sites.
//
// The Ontario newsroom is the reason this exists: 1505 bytes of empty shell,
// no RSS, five guessed API paths that all failed. But nothing here is
// specific to that one site — every function is written so the next source
// that hits the same problem reuses it instead of re-deriving it.
//
// Three independent rescue strategies, roughly cheapest and most reliable
// first:
//
//   1. Sitemaps. Public-sector sites publish these for SEO almost without
//      exception, and unlike an API it is a stable, self-describing format —
//      no guessing required, just a parse.
//   2. Dynamic rendering to crawlers. A site that cannot afford to be
//      invisible to Google commonly serves a fully rendered version of the
//      page to a small allow-list of crawler user agents even though
//      ordinary visitors get the JS shell — a standard, Google-documented
//      technique for SPA indexability, not a bypass of anything. The server
//      opts into it deliberately, for exactly this purpose. robots.txt is
//      still checked first: this only fetches paths a generic crawler would
//      be allowed to fetch.
//   3. The application bundle. A client-rendered app has to ship the address
//      of its own data source somewhere in its JavaScript, because it has to
//      fetch content into the empty shell it just handed the browser.

import { fetchRaw, type FetchResult } from './http.mts';

const CRAWLER_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export type RobotsInfo = {
  sitemaps: string[];
  /** Disallow prefixes under User-agent: * and any Googlebot-specific block. */
  disallow: string[];
};

/**
 * Minimal robots.txt parser — enough to find sitemap locations and to check
 * whether a path is fair game before fetching it with a crawler UA. Not a
 * full spec implementation (no wildcard or $ matching); prefix matching is
 * what the disallow check below needs.
 */
export function parseRobots(text: string): RobotsInfo {
  const sitemaps: string[] = [];
  const disallow: string[] = [];
  let relevant = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (!value) continue;

    if (key === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      relevant = value === '*' || /googlebot/i.test(value);
      continue;
    }
    if (key === 'disallow' && relevant) {
      disallow.push(value);
    }
  }

  return { sitemaps, disallow };
}

export async function fetchRobots(origin: string): Promise<RobotsInfo> {
  const res = await fetchRaw(new URL('/robots.txt', origin).toString());
  if (!res.ok) return { sitemaps: [], disallow: [] };
  return parseRobots(res.body);
}

export function isAllowed(disallow: string[], path: string): boolean {
  return !disallow.some((rule) => rule !== '' && path.startsWith(rule));
}

// ---------------------------------------------------------------------------
// Sitemaps
// ---------------------------------------------------------------------------

/** <loc> entries from a sitemap or sitemap-index document. */
export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

/** robots.txt declarations first, falling back to the conventional path. */
export async function candidateSitemaps(origin: string): Promise<string[]> {
  const robots = await fetchRobots(origin);
  const out = new Set(robots.sitemaps);
  out.add(new URL('/sitemap.xml', origin).toString());
  return [...out];
}

/**
 * Fetches sitemaps and returns page URLs matching a caller-supplied
 * relevance test — e.g. a slug pattern for conviction bulletins. Follows one
 * level of sitemap-index nesting, which covers the common two-tier structure
 * without unbounded recursion, and stops at the first sitemap that yields any
 * relevant URL rather than exhausting every candidate.
 */
export async function discoverSitemapUrls(
  origin: string,
  isRelevant: (url: string) => boolean,
  maxUrls = 15,
): Promise<string[]> {
  const found = new Set<string>();

  for (const sitemapUrl of await candidateSitemaps(origin)) {
    const res = await fetchRaw(sitemapUrl);
    if (!res.ok) continue;

    if (/<sitemapindex/i.test(res.body)) {
      for (const child of parseSitemapLocs(res.body).slice(0, 5)) {
        const childRes = await fetchRaw(child);
        if (!childRes.ok) continue;
        for (const loc of parseSitemapLocs(childRes.body)) {
          if (isRelevant(loc)) found.add(loc);
          if (found.size >= maxUrls) break;
        }
        if (found.size >= maxUrls) break;
      }
    } else {
      for (const loc of parseSitemapLocs(res.body)) {
        if (isRelevant(loc)) found.add(loc);
        if (found.size >= maxUrls) break;
      }
    }

    if (found.size > 0) break;
  }

  return [...found];
}

// ---------------------------------------------------------------------------
// Dynamic rendering (crawler user agent)
// ---------------------------------------------------------------------------

export async function isCrawlingAllowed(url: string): Promise<boolean> {
  const origin = new URL(url).origin;
  const robots = await fetchRobots(origin);
  return isAllowed(robots.disallow, new URL(url).pathname);
}

/**
 * Refetches a URL identifying as a crawler, for sites that serve pre-rendered
 * content to indexers and a JS shell to everyone else. Returns undefined
 * without making the request if robots.txt disallows the path — the point is
 * to use access the site deliberately opened for indexing, not to route
 * around a restriction it set.
 */
export async function fetchAsCrawler(url: string): Promise<FetchResult | undefined> {
  if (!(await isCrawlingAllowed(url))) return undefined;
  return fetchRaw(url, { 'User-Agent': CRAWLER_UA, Accept: 'text/html' });
}

// ---------------------------------------------------------------------------
// Application bundle scanning
// ---------------------------------------------------------------------------

/**
 * Script URLs the shell tells the browser to load.
 *
 * Matches quoted and unquoted src attributes. The real newsroom shell writes
 * `<script src=/js/app.js>` with no quotes at all; a quotes-only pattern found
 * zero scripts against that exact payload.
 */
export function bundleUrls(html: string, origin: string): string[] {
  const out = new Set<string>();
  const pattern = /<script\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi;

  for (const m of html.matchAll(pattern)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    try {
      const url = new URL(raw, origin).toString();
      // Same-origin bundles only; third-party tag managers are noise.
      if (new URL(url).hostname === new URL(origin).hostname) out.add(url);
    } catch {
      // Ignore.
    }
  }
  return [...out];
}

/**
 * Pulls candidate API paths out of an app's JS: the base URL a client-
 * rendered app must ship somewhere in order to fetch its own content.
 *
 * Deliberately permissive — each candidate costs one request to test, and a
 * missed one costs a whole extra round trip to notice.
 */
export function extractApiCandidates(js: string, origin: string): string[] {
  const found = new Set<string>();

  const patterns = [
    // "api" in the host: https://api.example.com/releases
    /["'`](https?:\/\/api\.[a-z0-9.-]+\/[a-z0-9/_.-]*)["'`]/gi,
    // "api" in the path: https://example.com/api/releases
    /["'`](https?:\/\/[a-z0-9.-]+\/[a-z0-9/_.-]*api[a-z0-9/_.-]*)["'`]/gi,
    // Rooted path: /api/v1/releases
    /["'`](\/(?:api|rest|graphql)[a-z0-9/_.-]*)["'`]/gi,
    // Versioned path without the word api: /v1/releases
    /["'`](\/v\d\/[a-z0-9/_.-]*(?:release|news|article|post)[a-z0-9/_.-]*)["'`]/gi,
  ];

  for (const pattern of patterns) {
    for (const m of js.matchAll(pattern)) {
      const raw = m[1];
      if (!raw || raw.length > 160) continue;
      if (/\.(?:js|css|png|jpe?g|svg|woff2?|map|ico)$/i.test(raw)) continue;
      try {
        found.add(new URL(raw, origin).toString());
      } catch {
        // Ignore.
      }
    }
  }

  return [...found];
}

/**
 * Extracts hydration state some SSR/SSG frameworks embed directly in the
 * page — window.__NUXT__, __INITIAL_STATE__, __NEXT_DATA__ and similar. When
 * present it can contain the full content list with no second request at
 * all. Not present on the newsroom shell that motivated this file — kept for
 * the next source that ships one of these instead.
 */
export function extractInlineState(html: string): unknown {
  const patterns = [
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i,
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i,
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (!m) continue;
    try {
      return JSON.parse(m[1]);
    } catch {
      // Not valid JSON, or a partial match — try the next pattern.
    }
  }
  return undefined;
}
