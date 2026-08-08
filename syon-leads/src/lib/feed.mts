// RSS/Atom discovery and parsing.
//
// The Ontario newsroom turned out to be a JavaScript application: the first
// live run received 1505 bytes containing no readable text. No parser can
// extract convictions from that.
//
// A feed solves it properly. Newsrooms publish RSS because syndication is the
// point of a newsroom, feeds are plain text with a stable schema, and reading
// one is explicitly sanctioned rather than scraping around a rendering layer.
//
// Better still, the shell we do receive is the <head> — and that is exactly
// where feed autodiscovery lives. So rather than guessing feed URLs, the
// source reads the address out of the page that failed.

export type FeedItem = {
  title: string;
  link?: string;
  description?: string;
  published?: string;
};

/**
 * Reads <link rel="alternate" type="application/rss+xml"> out of a page head.
 * Works on a JavaScript shell, because autodiscovery is server-rendered even
 * when the body is not.
 */
export function discoverFeeds(html: string, baseUrl: string): string[] {
  const out: string[] = [];

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;

    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      out.push(new URL(href, baseUrl).toString());
    } catch {
      // Ignore an unparseable href.
    }
  }

  return [...new Set(out)];
}

function tag(xml: string, name: string): string | undefined {
  // Handles both <title>x</title> and <title><![CDATA[x]]></title>.
  const m = xml.match(
    new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'),
  );
  if (!m) return undefined;
  return decodeEntities(
    m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' '),
  ).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Parses RSS <item> and Atom <entry> alike. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ];

  for (const [block] of blocks) {
    const title = tag(block, 'title');
    if (!title) continue;

    // Atom puts the URL in an attribute rather than in element text.
    const link =
      tag(block, 'link') ||
      block.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];

    items.push({
      title,
      link,
      description:
        tag(block, 'description') ??
        tag(block, 'summary') ??
        tag(block, 'content'),
      published:
        tag(block, 'pubDate') ??
        tag(block, 'published') ??
        tag(block, 'updated'),
    });
  }

  return items;
}

export function looksLikeFeed(body: string, contentType: string): boolean {
  if (/xml|rss|atom/i.test(contentType)) return true;
  return /<rss\b|<feed\b|<channel\b/i.test(body.slice(0, 1000));
}
