// Ontario Ministry of Labour convictions and court bulletins.
//
// The highest-value free source available, by a distance. A company just
// convicted or fined under the OHSA has an urgent, funded, board-level safety
// problem, and training is the standard remedial step. There is no warmer cold
// call in this sector.
//
// Six extraction strategies, tried in order, because live runs kept moving
// the page shape under us:
//
//   R. Rescue: if the index comes back as a JavaScript shell, try refetching
//      it identifying as a crawler — see spaRescue.mts. If a rescued page
//      comes back, every strategy below runs against that instead of the
//      original empty shell.
//   0. The newsroom's own JSON API, discovered by scanning its JS bundle for
//      API-shaped strings, then a short list of guessed shapes as fallback.
//   1. Sitemap. A relevant sitemap URL fetched and parsed directly, with no
//      guessing about API shape at all.
//   2. RSS/Atom feed, address read from the page's autodiscovery <link>.
//   3. Convictions listed inline on the index page.
//   4. Following links to individual releases.
//
// Whichever succeeds is named in the diagnostics, so a future break says which
// assumption stopped holding.

import type { RawLead } from '../types.mts';
import type { SourceResult, SourceContext } from './types.mts';
import { fetchRaw, stripHtml, saveRaw, extractLinks } from '../lib/http.mts';
import { classifyHtml, describeVerdict, describeHttpFailure } from '../lib/diagnose.mts';
import { discoverFeeds, parseFeed, looksLikeFeed } from '../lib/feed.mts';
import { fetchReleases } from '../lib/newsApi.mts';
import { fetchAsCrawler, discoverSitemapUrls } from '../lib/spaRescue.mts';
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
  // newsroom, filtered to release type 2007. The type filter came from a link
  // that lands on the convictions category; the numeric id is opaque but the
  // app passes it straight through to its API.
  //
  // Mailchimp tracking parameters were stripped from the original link: they
  // identify an individual subscriber and have no business in a repository.
  'https://news.ontario.ca/mlitsd/en?types=2007',
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
  // The optional leading digit run matters: Ontario numbered corporations are
  // written "2545345 Ontario Corp." and without it the match started at the
  // first capital, producing the useless name "Ontario Corp." on a live run.
  new RegExp(
    `\\b((?:\\d{5,}\\s+)?[A-Z][\\w&.'-]*(?:\\s+[A-Z0-9][\\w&.'-]*){0,6}?\\s*(?:${LEGAL_SUFFIX})\\.?)(?!\\w)`,
  ),
  /^([A-Z][\w&.'-]*(?:\s+[A-Z0-9][\w&.'-]*){1,5})\s+(?:was|has been|pleaded)/,
];

export function extractCompanyName(chunk: string): string | undefined {
  for (const pattern of NAME_PATTERNS) {
    const m = chunk.match(pattern);
    if (m?.[1]) {
      const name = m[1].replace(/[,\s]+$/, '').trim();
      // Must contain a lowercase letter: an all-caps run is a heading, not a
      // company name.
      if (name.length >= 4 && /[a-z]/.test(name)) return name;
    }
  }
  return undefined;
}

export type BulletinOptions = {
  source?: string;
  kind?: 'mol-enforcement' | 'wsib-enforcement';
  /** Sentence explaining why the conviction is a reason to call. */
  rationale?: string;
};

export function parseBulletin(
  text: string,
  sourceUrl: string,
  opts: BulletinOptions = {},
): RawLead[] {
  const source = opts.source ?? 'mol-convictions';
  const kind = opts.kind ?? 'mol-enforcement';
  const rationale =
    opts.rationale ?? 'remedial training is the standard next step';
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

    // Requires the province to follow. A looser pattern matched "of Schedule"
    // in legislative boilerplate and shipped "Schedule" as a city.
    const cityMatch = chunk.match(
      /\b(?:of|in|based in|located in)\s+([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)?),\s*(?:Ontario|ON)\b/,
    );
    const fineMatch = chunk.match(/\$[\d,]+(?:\.\d{2})?/);
    const dateMatch = chunk.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/,
    );

    leads.push({
      source,
      companyName,
      city: cityMatch?.[1],
      trigger: {
        kind,
        detail: fineMatch
          ? `Fined ${fineMatch[0]} — ${rationale}`
          : `Convicted — ${rationale}`,
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

  if (!res.ok) {
    const rawPathOnFailure = ctx.debugDir
      ? saveRaw(ctx.debugDir, 'mol-index.html', res.body)
      : undefined;
    const diag = describeHttpFailure('mol-convictions', res.status, 'ontario.ca', {
      bytes: res.bytes,
      rawPath: rawPathOnFailure,
    });
    diag.hints = [
      'Every known URL for this page failed. Attempts:',
      ...attempts.map((a) => `   ${a}`),
      'Search "Ontario Ministry of Labour court bulletins convictions" in a browser, then add the working URL to the TOP of BULLETIN_INDEX_CANDIDATES in src/sources/molConvictions.mts.',
    ];
    return { leads: [], diagnostics: [diag] };
  }

  // Rescue: if this came back as a JavaScript shell, try refetching it as a
  // crawler before doing anything else. Everything below reads from `res`, so
  // a successful rescue upgrades every later strategy transparently rather
  // than needing its own separate handling.
  let rescueNote: string | undefined;
  if (classifyHtml(res.body, stripHtml(res.body).length) === 'js-shell') {
    const rendered = await fetchAsCrawler(BULLETIN_INDEX);
    if (rendered === undefined) {
      rescueNote = 'dynamic-rendering rescue skipped — robots.txt disallows this path for crawlers';
    } else if (!rendered.ok) {
      rescueNote = `dynamic-rendering rescue attempted, HTTP ${rendered.status}`;
    } else {
      const renderedVerdict = classifyHtml(rendered.body, stripHtml(rendered.body).length);
      if (renderedVerdict !== 'js-shell' && rendered.bytes > res.bytes) {
        rescueNote = `dynamic-rendering rescue succeeded — ${rendered.bytes} bytes vs ${res.bytes} from the shell`;
        res = rendered;
      } else {
        rescueNote = `dynamic-rendering rescue attempted — no improvement (${rendered.bytes} bytes, still ${renderedVerdict})`;
      }
    }
  }

  const rawPath = ctx.debugDir
    ? saveRaw(ctx.debugDir, 'mol-index.html', res.body)
    : undefined;

  const text = stripHtml(res.body);

  // Strategy 0: the app's own JSON API.
  //
  // Tried first because the newsroom is a Vue application and this is where
  // its data actually comes from. The endpoint path is undocumented, so
  // several shapes are attempted and every attempt is reported.
  let leads: RawLead[] = [];
  let strategy = '';
  const apiAttempts: string[] = [];

  {
    // The shell is passed in so the API path can be read out of the app's
    // own JavaScript rather than guessed.
    const { releases, endpoint, attempts } = await fetchReleases(res.body);
    for (const a of attempts) apiAttempts.push(`${a.url} -> ${a.status}, ${a.note}`);

    for (const release of releases) {
      const body = `${release.title}. ${release.summary ?? ''}`;
      const found = parseBulletin(body, release.url ?? endpoint ?? BULLETIN_INDEX);
      if (release.published) {
        const when = new Date(release.published);
        if (!Number.isNaN(when.getTime())) {
          for (const l of found) l.trigger.date = when.toISOString();
        }
      }
      leads.push(...found);
    }

    if (leads.length > 0) strategy = `newsroom API ${endpoint}`;
  }

  // Strategy 1: sitemap.
  //
  // Government sites publish these for SEO almost without exception, and it
  // is a stable documented format rather than a guessed API shape. Filtered
  // to slugs carrying enforcement language, same test as the link-following
  // strategy below, so a huge sitemap does not turn into dozens of fetches.
  if (leads.length === 0) {
    const origin = new URL(BULLETIN_INDEX).origin;
    const sitemapUrls = await discoverSitemapUrls(
      origin,
      (url) => ENFORCEMENT_SLUG.test(url) || DATED_RELEASE.test(url),
    );

    if (sitemapUrls.length > 0) {
      strategy = `${sitemapUrls.length} sitemap URLs`;
      for (const url of sitemapUrls.slice(0, MAX_FOLLOW)) {
        try {
          const page = await fetchRaw(url);
          if (page.ok) leads.push(...parseBulletin(stripHtml(page.body), url));
        } catch {
          // One unreachable page should not stop the rest.
        }
      }
      if (leads.length === 0) strategy = ''; // found URLs, but none parsed
    }
  }

  // Strategy 2: an RSS/Atom feed.
  //
  // Tried first because it is the only strategy that works when the newsroom
  // renders client-side, which it does. The feed address is read out of the
  // shell's <head>, where autodiscovery lives, so no feed URL is guessed.
  const feedUrls = leads.length > 0 ? [] : [
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

  // Strategy 3: convictions listed inline on the index page itself.
  if (leads.length === 0) {
    leads = parseBulletin(text, BULLETIN_INDEX);
    if (leads.length > 0) strategy = 'index page';
  }

  // Strategy 4: index is a link list — follow the individual bulletins.
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
          note: `${leads.length} convictions extracted via ${strategy}.${rescueNote ? ` (${rescueNote})` : ''}`,
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
      rescueNote ? `Dynamic-rendering rescue: ${rescueNote}` : 'Dynamic-rendering rescue was not attempted.',
      'Newsroom API endpoints attempted (guessed plus any found by scanning the JS bundle):',
      ...apiAttempts.map((a) => `   ${a}`),
      'No sitemap yielded a relevant URL, no RSS/Atom feed was found by autodiscovery or convention.',
      'Remaining manual option: open the newsroom in a browser, Inspect -> Network -> Fetch/XHR, reload, and find the request that returns the release list. Send that URL, or add it directly to candidateEndpoints() in src/lib/newsApi.mts.',
    ];
  }

  return { leads, diagnostics: [diagnostic] };
}
