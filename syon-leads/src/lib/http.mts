// Minimal fetch helpers. No dependencies — Node 22 has fetch built in.
//
// Every source is a public government or municipal endpoint. Requests are
// rate-limited and identify themselves honestly: these are open data services
// run on public money, and hammering them anonymously is both rude and the
// fastest way to get blocked.

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

export async function getText(url: string): Promise<string> {
  await throttle(url);
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.text();
}

export async function getJson<T>(url: string): Promise<T> {
  await throttle(url);
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
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
