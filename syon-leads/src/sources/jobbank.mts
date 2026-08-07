// Government of Canada Job Bank.
//
// The most reliable free source of intent. An employer posting for a role that
// requires certification is publicly announcing an untrained or expanding
// workforce, with a timeline attached. "I saw you're hiring lift truck
// operators" is a legitimate opening line rather than an interruption.
//
// Job Bank is chosen over Indeed and LinkedIn on purpose: both of those
// prohibit scraping in their terms of service, and building a business process
// on a terms violation is a liability. Job Bank is a public service and
// publishes open data.
//
// UNVERIFIED AGAINST THE LIVE ENDPOINT — see the note in molConvictions.mts.
// The search URL and result shape are written from Job Bank's public search
// interface and will likely need adjusting on first live run.

import type { RawLead } from '../types.mts';
import { getText, stripHtml } from '../lib/http.mts';
import { courseFromText } from '../lib/score.mts';
import { config } from '../config.mts';

const SEARCH = 'https://www.jobbank.gc.ca/jobsearch/jobsearch';

/** Queries chosen to surface postings that imply a certification requirement. */
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
    sort: 'D', // date, newest first
  });
  return `${SEARCH}?${params.toString()}`;
}

/**
 * Extracts postings from a Job Bank results page.
 *
 * Each result carries an employer name, a location and a posting date. The
 * employer is the lead; the search term that surfaced it is the course signal.
 */
export function parseResults(
  text: string,
  term: string,
  sourceUrl: string,
): RawLead[] {
  const leads: RawLead[] = [];

  // Results render as "<title> <employer> <location> <date>" runs once tags
  // are stripped. Employer lines are followed by a city and a province code.
  const pattern =
    /([A-Z][\w&.,'-]*(?:\s+[A-Z0-9][\w&.,'-]*){0,6})\s+((?:[A-Z][a-z]+\s?){1,3}),?\s+(?:ON|Ontario)\b/g;

  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const companyName = match[1].trim();
    const city = match[2].trim();

    // Skip obvious non-employers picked up by a permissive pattern.
    if (companyName.length < 3) continue;
    if (/^(Job|Search|Home|Results|Posted|Salary|Location|Apply)/i.test(companyName)) {
      continue;
    }
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
        // Job Bank sorts newest-first; without a parsed date, assume recent
        // rather than undated, which would score as stale and drop the lead.
        date: new Date().toISOString(),
        sourceUrl,
      },
      suggestedCourse: courseFromText(`${term} ${companyName}`),
    });
  }

  return leads;
}

export async function fetchJobBank(): Promise<RawLead[]> {
  const all: RawLead[] = [];

  for (const term of searchTerms) {
    const url = buildSearchUrl(term);
    try {
      const html = await getText(url);
      all.push(...parseResults(stripHtml(html), term, url));
    } catch (err) {
      // One failing search term should not kill the batch.
      console.warn(`  ! jobbank "${term}" failed: ${(err as Error).message}`);
    }
  }

  // Job Bank covers all of Ontario; narrow to the service area here rather
  // than issuing 17 separate city searches.
  const area = config.serviceArea.map((c) => c.toLowerCase());
  return all.filter((l) => !l.city || area.includes(l.city.toLowerCase()));
}
