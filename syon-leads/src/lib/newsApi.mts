// Ontario Newsroom JSON API.
//
// The newsroom is a Vue application: the HTML is 1505 bytes of empty shell and
// there is no RSS feed. The release list therefore arrives over a JSON call
// the app makes after boot, and that call is the only viable way in.
//
// The endpoint path is not documented, so this tries a small set of plausible
// shapes and reports exactly what each returned. That is cheap, and it beats
// asking someone to sit in a browser's Network tab — which remains the
// fallback when none of these land.
//
// The `types` filter is passed through because a link to the convictions
// category carries `?types=2007`, and the app forwards that to its API.

import { fetchRaw } from './http.mts';

export type NewsRelease = {
  title: string;
  summary?: string;
  url?: string;
  published?: string;
};

export type ApiAttempt = { url: string; status: number; note: string };

const ORIGIN = 'https://news.ontario.ca';

/**
 * Pulls candidate API paths out of the application's own JavaScript.
 *
 * Better than guessing, and better than asking someone to sit in a browser's
 * Network tab: a Vue build inlines its API base path as a string literal, so
 * the bundle the shell already tells us to load contains the answer.
 *
 * Deliberately permissive about what looks like an endpoint, because the
 * candidates cost one request each to test and a missed one costs a whole
 * round trip.
 */
export function extractApiCandidates(js: string, origin: string): string[] {
  const found = new Set<string>();

  const patterns = [
    // Absolute, "api" in the host: "https://api.example.com/releases"
    /["'`](https?:\/\/api\.[a-z0-9.-]+\/[a-z0-9/_.-]*)["'`]/gi,
    // Absolute, "api" in the path: "https://example.com/api/releases"
    /["'`](https?:\/\/[a-z0-9.-]+\/[a-z0-9/_.-]*api[a-z0-9/_.-]*)["'`]/gi,
    // Rooted path: "/api/v1/releases"
    /["'`](\/(?:api|rest|graphql)[a-z0-9/_.-]*)["'`]/gi,
    // Versioned path without the word api: "/v1/releases"
    /["'`](\/v\d\/[a-z0-9/_.-]*(?:release|news|article|post)[a-z0-9/_.-]*)["'`]/gi,
  ];

  for (const pattern of patterns) {
    for (const m of js.matchAll(pattern)) {
      const raw = m[1];
      if (!raw || raw.length > 160) continue;
      // Skip source maps, assets and obvious non-endpoints.
      if (/\.(?:js|css|png|jpe?g|svg|woff2?|map|ico)$/i.test(raw)) continue;
      try {
        found.add(new URL(raw, origin).toString());
      } catch {
        // Unparseable literal; ignore.
      }
    }
  }

  return [...found];
}

/**
 * Script URLs the shell tells the browser to load.
 *
 * The real newsroom shell writes unquoted attributes throughout —
 * `<script src=/js/app.43d1fd35.js>` rather than `src="/js/app.js"`. A
 * quotes-only pattern found zero scripts against a real capture and would
 * have made discovery silently useless on the one page it exists for.
 */
export function bundleUrls(html: string, origin: string): string[] {
  const out = new Set<string>();
  const pattern = /<script\b[^>]*\bsrc\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi;

  for (const m of html.matchAll(pattern)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    try {
      const url = new URL(raw, origin).toString();
      // Only same-origin bundles; third-party tag managers are noise.
      if (new URL(url).hostname === new URL(origin).hostname) out.add(url);
    } catch {
      // Ignore.
    }
  }
  return [...out];
}

/** Candidate endpoints, most likely first. */
export function candidateEndpoints(ministry = 'mlitsd', types = '2007'): string[] {
  const q = `types=${encodeURIComponent(types)}`;
  return [
    `${ORIGIN}/api/releases?ministry=${ministry}&${q}&lang=en`,
    `${ORIGIN}/api/v1/releases?ministry=${ministry}&${q}&lang=en`,
    `${ORIGIN}/api/releases/${ministry}/en?${q}`,
    `${ORIGIN}/api/news?ministry=${ministry}&${q}&lang=en`,
    `${ORIGIN}/${ministry}/en/api/releases?${q}`,
  ];
}

/**
 * Pulls releases out of an unknown JSON shape.
 *
 * The response could be an array at the root, or wrapped in `results`, `data`,
 * `items` or `releases`. Field names vary the same way. Rather than commit to
 * one guess, this walks the likely containers and accepts any object carrying
 * something title-shaped — which is enough for the conviction-language filter
 * downstream to do the real work.
 */
export function extractReleases(payload: unknown): NewsRelease[] {
  const rows = findRows(payload);
  const out: NewsRelease[] = [];

  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;

    const title = firstString(r, ['title', 'name', 'headline', 'subject']);
    if (!title) continue;

    out.push({
      title,
      summary: firstString(r, ['summary', 'description', 'excerpt', 'body', 'lead']),
      url: firstString(r, ['url', 'link', 'permalink', 'href', 'slug']),
      published: firstString(r, [
        'publishedAt', 'published_at', 'date', 'publishedDate',
        'releaseDate', 'created_at', 'createdAt',
      ]),
    });
  }

  return out;
}

function findRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object' || payload === null) return [];

  const obj = payload as Record<string, unknown>;
  for (const key of ['results', 'data', 'items', 'releases', 'records', 'content']) {
    const v = obj[key];
    if (Array.isArray(v)) return v;
    // One level of nesting, e.g. { data: { results: [...] } }.
    if (v && typeof v === 'object') {
      const nested = findRows(v);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function firstString(
  row: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Tries each endpoint, returning the first that yields releases.
 *
 * Endpoints discovered in the application bundle are tried before the guessed
 * ones, since a string the app itself ships is far more likely to be real.
 */
export async function fetchReleases(shellHtml?: string): Promise<{
  releases: NewsRelease[];
  endpoint?: string;
  attempts: ApiAttempt[];
}> {
  const attempts: ApiAttempt[] = [];
  const discovered: string[] = [];

  if (shellHtml) {
    for (const bundle of bundleUrls(shellHtml, ORIGIN).slice(0, 4)) {
      const js = await fetchRaw(bundle);
      if (!js.ok) {
        attempts.push({ url: bundle, status: js.status, note: 'bundle not readable' });
        continue;
      }
      const candidates = extractApiCandidates(js.body, ORIGIN);
      attempts.push({
        url: bundle,
        status: js.status,
        note: `bundle scanned, ${candidates.length} API-shaped strings found`,
      });
      discovered.push(...candidates);
    }
  }

  const seen = new Set<string>();
  const ordered = [...discovered, ...candidateEndpoints()].filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  for (const url of ordered) {
    const res = await fetchRaw(url);

    if (!res.ok) {
      attempts.push({ url, status: res.status, note: 'not reachable' });
      continue;
    }
    if (!/json/i.test(res.contentType) && !res.body.trimStart().startsWith('{')) {
      attempts.push({ url, status: res.status, note: 'responded with non-JSON' });
      continue;
    }

    try {
      const releases = extractReleases(JSON.parse(res.body));
      attempts.push({
        url,
        status: res.status,
        note: `JSON with ${releases.length} releases`,
      });
      if (releases.length > 0) return { releases, endpoint: url, attempts };
    } catch {
      attempts.push({ url, status: res.status, note: 'JSON did not parse' });
    }
  }

  return { releases: [], attempts };
}
