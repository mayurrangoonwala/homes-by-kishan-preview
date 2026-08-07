// Ontario Ministry of Labour convictions and court bulletins.
//
// The highest-value free source available for this business, by a distance.
// A company that was just convicted or fined under the OHSA has an urgent,
// funded, board-level safety problem, and training is the standard remedial
// step. There is no warmer cold call in this sector.
//
// The data is published by the province at ontario.ca as court bulletins.
//
// UNVERIFIED AGAINST THE LIVE PAGE. The sandbox this was written in blocks
// ontario.ca, so the parser below is written against the documented bulletin
// format but has not been run on the real HTML. Run `--source mol-convictions
// --debug` locally and expect to adjust the selectors on first contact. The
// pipeline around it is fixture-tested and correct.

import type { RawLead } from '../types.mts';
import { getText, stripHtml } from '../lib/http.mts';
import { courseFromText } from '../lib/score.mts';

const BULLETIN_INDEX = 'https://www.ontario.ca/page/court-bulletins-convictions';

/**
 * Bulletins read roughly:
 *   "COMPANY NAME, a CITY-based firm, was fined $N after a worker was injured…"
 * The company is the leading proper-noun run and the city follows a small set
 * of connective phrases. This is deliberately conservative: it would rather
 * skip an entry than invent a company name, because a wrong name on a call
 * sheet is worse than a short batch.
 */
export function parseBulletin(text: string, sourceUrl: string): RawLead[] {
  const leads: RawLead[] = [];

  // Split into sentences and look for the fine/conviction pattern.
  const chunks = text.split(/(?<=\.)\s+(?=[A-Z])/);

  for (const chunk of chunks) {
    if (!/\bfined\b|\bconvicted\b|\bguilty\b|\bpleaded\b/i.test(chunk)) continue;

    // Company: leading run of capitalised words, optionally with a legal suffix.
    const nameMatch = chunk.match(
      /^([A-Z][\w&.,'-]*(?:\s+[A-Z0-9][\w&.,'-]*){0,6}?\s*(?:Inc\.?|Ltd\.?|Limited|Corp\.?|Corporation|Company|Co\.?|Group|Holdings|Enterprises)\.?)/,
    );
    if (!nameMatch) continue;

    const companyName = nameMatch[1].replace(/[,\s]+$/, '');

    const cityMatch = chunk.match(
      /\b(?:based in|of|located in|a)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)[-\s]?(?:based)?/,
    );

    const fineMatch = chunk.match(/\$[\d,]+/);
    const dateMatch = chunk.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/,
    );

    const detail = fineMatch
      ? `Fined ${fineMatch[0]} under the OHSA — remedial training is the standard next step`
      : 'Convicted under the OHSA — remedial training is the standard next step';

    leads.push({
      source: 'mol-convictions',
      companyName,
      city: cityMatch?.[1],
      trigger: {
        kind: 'mol-enforcement',
        detail,
        date: dateMatch ? new Date(dateMatch[0]).toISOString() : new Date().toISOString(),
        sourceUrl,
      },
      suggestedCourse: courseFromText(chunk),
    });
  }

  return leads;
}

export async function fetchMolConvictions(): Promise<RawLead[]> {
  const html = await getText(BULLETIN_INDEX);
  return parseBulletin(stripHtml(html), BULLETIN_INDEX);
}
