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

/** Tries each endpoint, returning the first that yields releases. */
export async function fetchReleases(): Promise<{
  releases: NewsRelease[];
  endpoint?: string;
  attempts: ApiAttempt[];
}> {
  const attempts: ApiAttempt[] = [];

  for (const url of candidateEndpoints()) {
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
