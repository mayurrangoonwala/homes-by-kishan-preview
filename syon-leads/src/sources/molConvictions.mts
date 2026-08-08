// Ontario Ministry of Labour convictions and court bulletins.
//
// The highest-value free source available, by a distance. A company just
// convicted or fined under the OHSA has an urgent, funded, board-level safety
// problem, and training is the standard remedial step. There is no warmer cold
// call in this sector.
//
// Three extraction strategies, tried in order, because live runs showed the
// page shape moving under us:
//
//   1. RSS/Atom feed, with the address read from the page's own autodiscovery
//      <link>. The only strategy that works against the newsroom, which is a
//      JavaScript application serving 1505 bytes of empty shell.
//   2. Convictions listed inline on the index page.
//   3. Following links to individual releases.
//
// Whichever succeeds is named in the diagnostics, so a future break says which
// assumption stopped holding.

import type { RawLead } from '../types.mts';
import type { SourceResult, SourceContext } from './types.mts';
import { fetchRaw, stripHtml, saveRaw, extractLinks } from '../lib/http.mts';
import { classifyHtml, describeVerdict, describeHttpFailure } from '../lib/diagnose.mts';
import { discoverFeeds, parseFeed, looksLikeFeed } from '../lib/feed.mts';
import { courseFromText } from '../lib/score.mts';

/**
 * Candidate index URLs, tried in order until one returns 200.
 *
 * The first entry 404'd on the first live run — ontario.ca had moved the page.
 * Government sites reorganise regularly, so a single hardcoded URL guarantees
 * this source breaks periodically and silently. Trying a list, and reporting
 * which one worked, turns that from an outage into a log line.
 *
 * Add the current URL to the TOP of this list when you find it; the old ones
 * are harmless to keep and document where it used to live.
 */
const BULLETIN_INDEX_CANDIDATES = [
  // Ministry of Labour, Immigration, Training and Skills Development
  // newsroom. Convictions are published here as dated news releases, so this
  // is a headline index rather than a page of inline bulletins — the
  // link-following strategy below is the one that does the work.
  'https://news.ontario.ca/mlitsd/en',
  'https://www.ontario.ca/page/court-bulletins-convictions',
  'https://www.ontario.ca/page/court-bulletins',
  'https://www.ontario.ca/page/workplace-health-and-safety-convictions',
];

/** How many linked bulletins to follow when the index has no inline content. */
const MAX_FOLLOW = 8;

const CONVICTION_LANGUAGE = /\bfined\b|\bconvicted\b|\bguilty\b|\bpleaded\b|\bpenalty of\b/i;

/**
 * Company-name extraction.
 *
 * Two patterns, tried in order. The first catches a name with an explicit
 * legal suffix, which is the common bulletin style and the safest match. The
 * second catches a capitalised run immediately preceding conviction language,
 * for bulletins that omit the suffix.
 *
 * Both are deliberately conservative — skipping an entry costs one lead, while
 * inventing a company name puts a wrong entry on a call sheet that someone
 * then rings. A short batch is recoverable; a fabricated lead is not.
 */
// Longest suffixes first, so "Incorporated" is not truncated to "Inc". The
// trailing (?!\w) rather than \b lets the optional full stop in "Inc." be
// captured while still refusing a partial match inside a longer word.
// Legal suffixes only. Trade words like "Roofing" or "Construction" must NOT
// appear here: the quantifier is lazy, so "Northgate Roofing Ltd." would stop
// at "Northgate Roofing" and silently truncate the name. Companies with no
// legal suffix are caught by the second pattern instead.
const LEGAL_SUFFIX =
  'Incorporated|Inc|Limited|Ltd|Corporation|Corp|Company|Co|Group|Holdings|Enterprises|Partnership|LLP|LP';

const NAME_PATTERNS: RegExp[] = [
  new RegExp(
    `\\b([A-Z][\\w&.'-]*(?:\\s+[A-Z0-9][\\w&.'-]*){0,6}?\\s*(?:${LEGAL_SUFFIX})\\.?)(?!\\w)`,
  ),
  /^([A-Z][\w&.'-]*(?:\s+[A-Z0-9][\w&.'-]*){1,5})\s+(?:was|has been|pleaded)/,
];

export function extractCompanyName(chunk: string): string | undefined {
  for (const pattern of NAME_PATTERNS) {
    const m = chunk.match(pattern);
    if (m?.[1]) {
      const name = m[1].replace(/[,\s]+$/, '').trim();
      if (name.length >= 4 && /[a-z]/.test(name)) return name;
    }
  }
  return undefined;
}

export function parseBulletin(text: string, sourceUrl: string): RawLead[] {
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  // Split on sentence boundaries followed by a capital, which keeps each
  // conviction in its own chunk in the usual bulletin format.
  const chunks = text.split(/(?<=[.!?])\s+(?=[A-Z])/);

  for (const chunk of chunks) {
    if (!CONVICTION_LANGUAGE.test(chunk)) continue;

    const companyName = extractCompanyName(chunk);
    if (!companyName || seen.has(companyName)) continue;
    seen.add(companyName);

    const cityMatch = chunk.match(
      /\b(?:based in|located in|of|a)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)[-\s]?(?:based)?\b/,
    );
    const fineMatch = chunk.match(/\$[\d,]+(?:\.\d{2})?/);
    const dateMatch = chunk.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/,
    );

    leads.push({
      source: 'mol-convictions',
      companyName,
      city: cityMatch?.[1],
      trigger: {
        kind: 'mol-enforcement',
        detail: fineMatch
          ? `Fined ${fineMatch[0]} under the OHSA — remedial training is the standard next step`
          : 'Convicted under the OHSA — remedial training is the standard next step',
        date: dateMatch ? new Date(dateMatch[0]).toISOString() : new Date().toISOString(),
        sourceUrl,
      },
      suggestedCourse: courseFromText(chunk),
    });
  }

  return leads;
}

/**
 * Links worth following from an index page.
 *
 * Handles both shapes this source might meet: an ontario.ca page of bulletin
 * links, and the newsroom at news.ontario.ca where releases live at dated
 * paths like /mlitsd/en/2026/08/....
 *
 * On the newsroom the slug itself is the filter. Most releases are funding
 * announcements and programme news, and fetching all of them would burn the
 * request budget on pages containing no convictions — so only slugs carrying
 * enforcement language are followed.
 */
const ENFORCEMENT_SLUG =
  /convict|prosecut|court-bulletin|fined|guilty|penalt|sentenc|charged|safety-violation/i;

const DATED_RELEASE = /\/\d{4}\/\d{2}\//;

export function bulletinLinks(html: string, baseUrl: string): string[] {
  const links = extractLinks(html, baseUrl)
    .filter((u) => u !== baseUrl && !u.includes('#'))
    // Stay on the government host the index came from.
    .filter((u) => /(^|\.)ontario\.ca$/.test(new URL(u).hostname));

  const enforcement = links.filter((u) => ENFORCEMENT_SLUG.test(u));
  if (enforcement.length > 0) return enforcement.slice(0, MAX_FOLLOW);

  // Nothing obviously enforcement-related: fall back to recent dated releases
  // and let the conviction-language check in parseBulletin do the filtering.
  return links.filter((u) => DATED_RELEASE.test(u)).slice(0, MAX_FOLLOW);
}

export async function fetchMolConvictions(ctx: SourceContext): Promise<SourceResult> {
  // Try each candidate until one responds. The attempt log is reported either
  // way, so a total failure still says exactly what was tried.
  const attempts: string[] = [];
  let res = await fetchRaw(BULLETIN_INDEX_CANDIDATES[0]);
  attempts.push(`${BULLETIN_INDEX_CANDIDATES[0]} -> ${res.status}`);

  for (const candidate of BULLETIN_INDEX_CANDIDATES.slice(1)) {
    if (res.ok) break;
    res = await fetchRaw(candidate);
    attempts.push(`${candidate} -> ${res.status}`);
  }

  const BULLETIN_INDEX = res.url;
  const rawPath = ctx.debugDir
    ? saveRaw(ctx.debugDir, 'mol-index.html', res.body)
    : undefined;

  if (!res.ok) {
    const diag = describeHttpFailure('mol-convictions', res.status, 'ontario.ca', {
      bytes: res.bytes,
      rawPath,
    });
    diag.hints = [
      'Every known URL for this page failed. Attempts:',
      ...attempts.map((a) => `   ${a}`),
      'Search "Ontario Ministry of Labour court bulletins convictions" in a browser, then add the working URL to the TOP of BULLETIN_INDEX_CANDIDATES in src/sources/molConvictions.mts.',
    ];
    return { leads: [], diagnostics: [diag] };
  }

  const text = stripHtml(res.body);

  // Strategy 1: an RSS/Atom feed.
  //
  // Tried first because it is the only strategy that works when the newsroom
  // renders client-side, which it does. The feed address is read out of the
  // shell's <head>, where autodiscovery lives, so no feed URL is guessed.
  let leads: RawLead[] = [];
  let strategy = '';

  const feedUrls = [
    ...discoverFeeds(res.body, BULLETIN_INDEX),
    // Conventional fallbacks if the page declares no feed.
    new URL('rss.xml', BULLETIN_INDEX.replace(/\/?$/, '/')).toString(),
    new URL('feed', BULLETIN_INDEX.replace(/\/?$/, '/')).toString(),
  ];

  for (const feedUrl of feedUrls) {
    const feed = await fetchRaw(feedUrl);
    if (!feed.ok || !looksLikeFeed(feed.body, feed.contentType)) continue;

    if (ctx.debugDir) saveRaw(ctx.debugDir, 'mol-feed.xml', feed.body);

    const items = parseFeed(feed.body);
    for (const item of items) {
      const body = `${item.title}. ${item.description ?? ''}`;
      const found = parseBulletin(body, item.link ?? feedUrl);
      // A feed gives a real publication date; prefer it over the date the
      // prose happens to mention, which is often the court date.
      if (item.published) {
        const when = new Date(item.published);
        if (!Number.isNaN(when.getTime())) {
          for (const lead of found) lead.trigger.date = when.toISOString();
        }
      }
      leads.push(...found);
    }

    strategy = `feed ${feedUrl} (${items.length} items)`;
    break;
  }

  // Strategy 2: convictions listed inline on the index page itself.
  if (leads.length === 0) {
    leads = parseBulletin(text, BULLETIN_INDEX);
    if (leads.length > 0) strategy = 'index page';
  }

  // Strategy 3: index is a link list — follow the individual bulletins.
  if (leads.length === 0) {
    const links = bulletinLinks(res.body, BULLETIN_INDEX);
    if (links.length > 0) {
      strategy = `${links.length} linked bulletins`;
      for (const link of links) {
        try {
          const page = await fetchRaw(link);
          if (page.ok) leads.push(...parseBulletin(stripHtml(page.body), link));
        } catch {
          // One unreachable bulletin should not stop the rest.
        }
      }
    }
  }

  // When a strategy produced leads, report that rather than classifying the
  // index HTML — the newsroom shell is a JavaScript app and would always be
  // reported as unusable even on a run where the feed worked perfectly.
  if (leads.length > 0) {
    return {
      leads,
      diagnostics: [
        {
          sourceId: 'mol-convictions',
          ok: true,
          note: `${leads.length} convictions extracted via ${strategy}.`,
          hints: [],
          bytes: res.bytes,
          rawPath,
        },
      ],
    };
  }

  const verdict = classifyHtml(res.body, text.length);
  const diagnostic = describeVerdict('mol-convictions', verdict, {
    bytes: res.bytes,
    rawPath,
    matched: 0,
  });
  diagnostic.note = `${diagnostic.note} (no strategy produced leads)`;

  if (verdict === 'js-shell') {
    diagnostic.hints = [
      'The newsroom renders client-side, so the HTML will never contain convictions.',
      'No RSS or Atom feed was found either, by autodiscovery or at the conventional paths.',
      'Open the newsroom in a browser, use View Source, and search for "rss" or "atom" — then add that URL to feedUrls in src/sources/molConvictions.mts.',
      'Failing that, check the Network tab for the request that returns the release list as JSON.',
    ];
  }

  return { leads, diagnostics: [diagnostic] };
}
