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
// Verified against the live site. Results are server-rendered — the earlier
// suspicion that this was a client-rendered app was wrong, and the diagnostics
// said so correctly ("real content, parser matched nothing"), which is what
// eventually pointed at the markup rather than at the transport.

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
 * Extracts postings from a Job Bank results page.
 *
 * Written against the real markup, which the first live capture finally
 * revealed. Each result is an <article> carrying labelled list items:
 *
 *   <article id="article-50029982">
 *     <span class="noctitle"> forklift operator </span>
 *     <li class="date">August 07, 2026</li>
 *     <li class="business">B&amp;J Global Inc</li>
 *     <li class="location">... Mississauga (ON)</li>
 *
 * Labelled fields mean no guessing: earlier attempts pattern-matched
 * capitalised runs against stripped text and returned nav furniture like
 * "Posted Yesterday Toronto".
 */

const ARTICLE = /<article\b[^>]*id="article-\d+"[\s\S]*?<\/article>/gi;

function field(block: string, cls: string): string | undefined {
  const m = block.match(new RegExp(`<li class="${cls}"[^>]*>([\\s\\S]*?)<\\/li>`, 'i'));
  return m ? decode(strip(m[1])) : undefined;
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** "Location Mississauga (ON)" -> "Mississauga". */
export function parseLocation(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^\s*Location\s*/i, '').trim();
  const m = cleaned.match(/^(.+?)\s*\((?:ON|Ontario)\)/i);
  const city = (m ? m[1] : cleaned).trim();
  return city.length > 1 ? city : undefined;
}

export function parseResults(
  html: string,
  term: string,
  sourceUrl: string,
): RawLead[] {
  const leads: RawLead[] = [];
  const seen = new Set<string>();

  for (const [block] of html.matchAll(ARTICLE)) {
    const companyName = field(block, 'business');
    if (!companyName || companyName.length < 2) continue;

    const city = parseLocation(field(block, 'location'));
    const key = `${companyName}|${city ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const titleMatch = block.match(
      /<span class="noctitle"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const jobTitle = titleMatch ? decode(strip(titleMatch[1])) : term;

    // The posting date is printed on every result, so a stale posting can be
    // aged out properly rather than assumed current.
    const dateRaw = field(block, 'date');
    const posted = dateRaw ? new Date(dateRaw) : undefined;

    const linkMatch = block.match(/href="([^"]*jobposting\/\d+[^"]*)"/i);
    const link = linkMatch
      ? new URL(linkMatch[1].split(';')[0], 'https://www.jobbank.gc.ca').toString()
      : sourceUrl;

    leads.push({
      source: 'jobbank',
      companyName,
      city,
      trigger: {
        kind: 'hiring',
        detail: `Hiring a ${jobTitle} — they have staff who need certifying`,
        date:
          posted && !Number.isNaN(posted.getTime())
            ? posted.toISOString()
            : new Date().toISOString(),
        sourceUrl: link,
      },
      // The job title is a far better course signal than the search term that
      // happened to surface it.
      suggestedCourse: courseFromText(`${jobTitle} ${term}`),
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
      const found = parseResults(res.body, term, url);

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
      all.push(...parseResults(res.body, term, url));
    }
  }

  // No location filter. The search is already Ontario-scoped, and Raj travels
  // anywhere in the province — distance is handled as a scoring bonus instead.
  return { leads: all, diagnostics };
}
