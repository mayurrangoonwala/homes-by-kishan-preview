// Government of Canada Job Bank.
//
// The most reliable free source of intent: an employer posting for a role that
// requires certification is publicly announcing an untrained or expanding
// workforce, with a timeline attached.
//
// Chosen over Indeed and LinkedIn deliberately — both prohibit scraping in
// their terms of service, and building a client-facing process on a terms
// violation is a liability that outweighs the data.
//
// NEVER RUN AGAINST THE LIVE SITE. The most likely outcome is that Job Bank
// renders results client-side, in which case no parser will ever work and the
// source needs their data feed instead. That specific failure is detected and
// reported rather than being reported as "0 results", because the two call for
// completely different fixes.

import type { RawLead } from '../types.mts';
import type { SourceResult, SourceContext } from './types.mts';
import { fetchRaw, stripHtml, saveRaw } from '../lib/http.mts';
import {
  classifyHtml,
  describeVerdict,
  describeHttpFailure,
  type SourceDiagnostic,
} from '../lib/diagnose.mts';
import { courseFromText } from '../lib/score.mts';
import { config } from '../config.mts';

const SEARCH = 'https://www.jobbank.gc.ca/jobsearch/jobsearch';

/** Queries chosen to surface postings implying a certification requirement. */
export const searchTerms = [
  'forklift',
  'lift truck operator',
  'working at heights',
  'WHMIS',
  'confined space',
  'warehouse associate',
  'construction labourer',
  'health and safety coordinator',
];

export function buildSearchUrl(term: string, location = 'Ontario'): string {
  const params = new URLSearchParams({
    searchstring: term,
    locationstring: location,
    sort: 'D',
  });
  return `${SEARCH}?${params.toString()}`;
}

/**
 * Words that appear in a capitalised run but never start a real employer name.
 * Without this the pattern happily returns "Posted Yesterday Toronto ON".
 */
const NOT_AN_EMPLOYER =
  /^(Job|Jobs|Search|Home|Results?|Posted|Salary|Location|Apply|Full|Part|Permanent|Temporary|Hourly|Skip|Menu|Sign|Language|Français|Date|Sort|Filter|New|Verified|Employer|Title|Wage|Terms|Privacy|Government|Canada)\b/i;

export function parseResults(
  text: string,
  term: string,
  sourceUrl: string,
): RawLead[] {
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  // Results render as "<title> <employer> <city> ON <date>" once tags are
  // stripped. The employer is the capitalised run immediately before a city
  // and the province marker.
  const pattern =
    /([A-Z][\w&.,'-]*(?:\s+[A-Z0-9][\w&.,'-]*){0,6})\s+((?:[A-Z][a-z]+\s?){1,3}),?\s+(?:ON|Ontario)\b/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const companyName = match[1].trim();
    const city = match[2].trim();

    if (companyName.length < 4) continue;
    if (NOT_AN_EMPLOYER.test(companyName)) continue;
    // A run of single capitalised words with no lowercase is usually nav text.
    if (!/[a-z]/.test(companyName)) continue;

    const key = `${companyName}|${city}`;
    if (seen.has(key)) continue;
    seen.add(key);

    leads.push({
      source: 'jobbank',
      companyName,
      city,
      trigger: {
        kind: 'hiring',
        detail: `Hiring — posting matched "${term}", so they have staff who need certifying`,
        // Sorted newest-first; without a parsed date, treat as current rather
        // than undated, which would score as stale and drop the lead.
        date: new Date().toISOString(),
        sourceUrl,
      },
      suggestedCourse: courseFromText(`${term} ${companyName}`),
    });
  }

  return leads;
}

export async function fetchJobBank(ctx: SourceContext): Promise<SourceResult> {
  const all: RawLead[] = [];
  const diagnostics: SourceDiagnostic[] = [];
  let sampled = false;

  for (const term of searchTerms) {
    const url = buildSearchUrl(term);
    const res = await fetchRaw(url);

    // Save and classify only the first response — eight copies of the same
    // page shape helps nobody.
    if (!sampled) {
      sampled = true;
      const rawPath = ctx.debugDir
        ? saveRaw(ctx.debugDir, 'jobbank-sample.html', res.body)
        : undefined;

      if (!res.ok) {
        diagnostics.push(
          describeHttpFailure('jobbank', res.status, 'jobbank.gc.ca', {
            bytes: res.bytes,
            rawPath,
          }),
        );
        break;
      }

      const text = stripHtml(res.body);
      const verdict = classifyHtml(res.body, text.length);
      const found = parseResults(text, term, url);

      const diag = describeVerdict('jobbank', verdict, {
        bytes: res.bytes,
        rawPath,
        matched: found.length,
      });

      if (verdict === 'js-shell') {
        diag.hints.push(
          'Job Bank publishes bulk job data separately from the search UI — look for their open data / XML feed and point this source at that instead.',
        );
        diagnostics.push(diag);
        break; // No point issuing seven more identical requests.
      }

      diagnostics.push(diag);
      all.push(...found);
      continue;
    }

    if (res.ok) {
      all.push(...parseResults(stripHtml(res.body), term, url));
    }
  }

  const area = config.serviceArea.map((c) => c.toLowerCase());
  const inArea = all.filter((l) => !l.city || area.includes(l.city.toLowerCase()));

  if (all.length > 0 && inArea.length === 0) {
    diagnostics.push({
      sourceId: 'jobbank',
      ok: false,
      note: `${all.length} postings parsed but none fell inside the service area.`,
      hints: [
        'The parser is working; the city filter is rejecting everything.',
        `Check the extracted city names against config.serviceArea — they may carry a suffix or region name.`,
      ],
    });
  }

  return { leads: inArea, diagnostics };
}
