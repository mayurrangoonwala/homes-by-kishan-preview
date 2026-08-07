// Ontario Ministry of Labour convictions and court bulletins.
//
// The highest-value free source available, by a distance. A company just
// convicted or fined under the OHSA has an urgent, funded, board-level safety
// problem, and training is the standard remedial step. There is no warmer cold
// call in this sector.
//
// NEVER RUN AGAINST THE LIVE PAGE — the build environment blocks ontario.ca.
// Rather than commit to one guess about the page shape, this tries several
// extraction strategies and reports which (if any) worked. The index page may
// list convictions inline, or it may only link to individual bulletins, so
// both are handled.

import type { RawLead } from '../types.mts';
import type { SourceResult, SourceContext } from './types.mts';
import { fetchRaw, stripHtml, saveRaw, extractLinks } from '../lib/http.mts';
import { classifyHtml, describeVerdict, describeHttpFailure } from '../lib/diagnose.mts';
import { courseFromText } from '../lib/score.mts';

const BULLETIN_INDEX = 'https://www.ontario.ca/page/court-bulletins-convictions';

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

/** Links from the index that look like individual conviction bulletins. */
export function bulletinLinks(html: string, baseUrl: string): string[] {
  return extractLinks(html, baseUrl)
    .filter((u) => /court-bulletin|conviction|prosecution/i.test(u))
    .filter((u) => u !== baseUrl && !u.includes('#'))
    .slice(0, MAX_FOLLOW);
}

export async function fetchMolConvictions(ctx: SourceContext): Promise<SourceResult> {
  const res = await fetchRaw(BULLETIN_INDEX);
  const rawPath = ctx.debugDir
    ? saveRaw(ctx.debugDir, 'mol-index.html', res.body)
    : undefined;

  if (!res.ok) {
    return {
      leads: [],
      diagnostics: [
        describeHttpFailure('mol-convictions', res.status, 'ontario.ca', {
          bytes: res.bytes,
          rawPath,
        }),
      ],
    };
  }

  const text = stripHtml(res.body);

  // Strategy 1: convictions listed inline on the index.
  let leads = parseBulletin(text, BULLETIN_INDEX);
  let strategy = 'index page';

  // Strategy 2: index is a link list — follow the individual bulletins.
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

  const verdict = classifyHtml(res.body, text.length);
  const diagnostic = describeVerdict('mol-convictions', verdict, {
    bytes: res.bytes,
    rawPath,
    matched: leads.length,
  });
  diagnostic.note = `${diagnostic.note} (strategy: ${strategy})`;

  return { leads, diagnostics: [diagnostic] };
}
