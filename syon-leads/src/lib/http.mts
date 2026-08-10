// Minimal fetch helpers. No dependencies — Node 22 has fetch built in.
//
// Every source is a public government or municipal endpoint. Requests are
// rate-limited and identify themselves honestly: these are open data services
// run on public money, and hammering them anonymously is both rude and the
// fastest way to get blocked.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const USER_AGENT =
  'SyonLeads/0.1 (Ontario safety training lead research; contact: sandeep@syonsafety.com)';

/** Politeness delay between requests to the same host. */
const THROTTLE_MS = 1200;

const lastRequestByHost = new Map<string, number>();

async function throttle(url: string): Promise<void> {
  const host = new URL(url).host;
  const last = lastRequestByHost.get(host) ?? 0;
  const wait = last + THROTTLE_MS - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestByHost.set(host, Date.now());
}

export type FetchResult = {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: string;
  bytes: number;
};

/**
 * Never throws on a non-2xx. A 403 tells us as much as a 200 does — it says
 * the source is blocking rather than that the parser is wrong — and throwing
 * away that distinction is what makes remote debugging slow.
 *
 * `headerOverrides` lets a caller identify differently for one request — used
 * by the dynamic-rendering rescue in spaRescue.mts, which needs a crawler
 * user agent to reach the pre-rendered version some sites serve to indexers.
 * Still goes through the same per-host throttle.
 */
export async function fetchRaw(
  url: string,
  headerOverrides?: Record<string, string>,
): Promise<FetchResult> {
  await throttle(url);
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/json,application/xhtml+xml',
      'Accept-Language': 'en-CA,en;q=0.9',
      ...headerOverrides,
    },
    redirect: 'follow',
  });

  const body = await res.text();
  return {
    url,
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get('content-type') ?? '',
    body,
    bytes: body.length,
  };
}

export async function getText(url: string): Promise<string> {
  const res = await fetchRaw(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.body;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetchRaw(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  try {
    return JSON.parse(res.body) as T;
  } catch {
    // A JSON endpoint returning HTML is nearly always an error or block page,
    // and "Unexpected token <" hides that.
    throw new Error(
      `GET ${url} -> expected JSON, got ${res.contentType || 'unknown'} (${res.bytes} bytes)`,
    );
  }
}

/** Saves a payload for inspection. Returns the path written. */
export function saveRaw(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

/** Strips tags to plain text. Adequate for keyword matching over gov HTML. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Absolute URLs for every href on a page, deduped. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      out.add(new URL(m[1], baseUrl).toString());
    } catch {
      // Ignore unparseable hrefs (mailto:, javascript:, malformed).
    }
  }
  return [...out];
}
