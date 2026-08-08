// WSIB convictions.
//
// The Workplace Safety and Insurance Board publishes its prosecutions at
// wsib.ca/en/convictions.
//
// Worth being precise about what this signal means, because it is easy to
// treat it as interchangeable with the Ministry of Labour list and it is not.
// WSIB prosecutes obligations under the Workplace Safety and Insurance Act:
// failing to register, failing to report an injury, understating payroll. The
// Ministry prosecutes the safety failures themselves under the OHSA.
//
// So a WSIB conviction says "this business has a compliance problem and has
// just been penalised for it" — a real opening, and often a business that has
// been avoiding exactly the obligations safety training sits alongside. But it
// is not evidence that a worker was hurt, which is why it scores below an OHSA
// conviction rather than equal to it.
//
// NEVER RUN AGAINST THE LIVE PAGE from the build environment — wsib.ca is
// blocked there. The parser is shared with the Ministry source, which has been
// exercised against real release text, but the page shape here is unverified
// and the diagnostics will say so.

import type { SourceResult, SourceContext } from './types.mts';
import { fetchRaw, stripHtml, saveRaw, extractLinks } from '../lib/http.mts';
import { classifyHtml, describeVerdict, describeHttpFailure } from '../lib/diagnose.mts';
import { discoverFeeds, parseFeed, looksLikeFeed } from '../lib/feed.mts';
import { parseBulletin } from './molConvictions.mts';
import { looksLikeBusiness } from './ckanPermits.mts';
import type { RawLead } from '../types.mts';

const INDEX_CANDIDATES = [
  'https://www.wsib.ca/en/convictions',
  'https://www.wsib.ca/en/newsroom/convictions',
];

const MAX_FOLLOW = 8;

/**
 * Convictions that are about a person, not an employer.
 *
 * The live WSIB list is dominated by individual benefit fraud — a claimant
 * who misstated their condition, prosecuted under s.149. The first run pulled
 * "Mahmoud Mohamed El Hacene of Ottawa" onto a lead list.
 *
 * That is not a near miss, it is a private individual who would be cold-called
 * about corporate safety training because of a personal conviction. These must
 * be excluded on the text, and separately every surviving name must look like
 * a business.
 */
const CLAIMANT_FRAUD =
  /\b(?:his|her|their) claim\b|claim for benefits|benefit(?:s)? fraud|false or misleading statement.*claim|received benefits|loss of earnings/i;

/** Employer-side offences: the ones that indicate a business with obligations. */
const EMPLOYER_OFFENCE =
  /\bemployer\b|failing to register|failure to register|premium|payroll|classif|failing to report|failure to report an injury|reporting obligations|material change/i;

export function isEmployerConviction(text: string): boolean {
  if (CLAIMANT_FRAUD.test(text) && !EMPLOYER_OFFENCE.test(text)) return false;
  return true;
}

const RATIONALE =
  'just penalised for a compliance failure, so safety obligations are live for them right now';

const BULLETIN_OPTS = {
  source: 'wsib-convictions',
  kind: 'wsib-enforcement' as const,
  rationale: RATIONALE,
};

/** Links from the index that look like individual conviction records. */
export function wsibConvictionLinks(html: string, baseUrl: string): string[] {
  return extractLinks(html, baseUrl)
    .filter((u) => u !== baseUrl && !u.includes('#'))
    .filter((u) => /wsib\.ca$/i.test(new URL(u).hostname))
    .filter((u) => /convict|prosecut|penalt|charged|fined/i.test(u))
    .slice(0, MAX_FOLLOW);
}

/**
 * Keeps only convictions that are plausibly about an employer.
 *
 * Two independent gates, because either alone lets something through: the
 * offence text must not read as personal benefit fraud, and the extracted name
 * must carry a business marker. A person's name has no legal suffix, so the
 * second gate catches what the first misses.
 */
export function filterToEmployers(leads: RawLead[]): RawLead[] {
  return leads.filter(
    (l) => isEmployerConviction(l.trigger.detail) && looksLikeBusiness(l.companyName),
  );
}

export async function fetchWsibConvictions(ctx: SourceContext): Promise<SourceResult> {
  const attempts: string[] = [];
  let res = await fetchRaw(INDEX_CANDIDATES[0]);
  attempts.push(`${INDEX_CANDIDATES[0]} -> ${res.status}`);

  for (const candidate of INDEX_CANDIDATES.slice(1)) {
    if (res.ok) break;
    res = await fetchRaw(candidate);
    attempts.push(`${candidate} -> ${res.status}`);
  }

  const indexUrl = res.url;
  const rawPath = ctx.debugDir
    ? saveRaw(ctx.debugDir, 'wsib-convictions.html', res.body)
    : undefined;

  if (!res.ok) {
    const diag = describeHttpFailure('wsib-convictions', res.status, 'wsib.ca', {
      bytes: res.bytes,
      rawPath,
    });
    diag.hints = [...diag.hints, 'Attempts:', ...attempts.map((a) => `   ${a}`)];
    return { leads: [], diagnostics: [diag] };
  }

  const text = stripHtml(res.body);
  const leads: RawLead[] = [];
  let strategy = '';

  // Strategy 1: convictions listed inline, which is the usual shape for a
  // page whose entire purpose is to be a list.
  leads.push(...filterToEmployers(parseBulletin(text, indexUrl, BULLETIN_OPTS)));
  if (leads.length > 0) strategy = 'index page';

  // Strategy 2: a feed, if the page declares one.
  if (leads.length === 0) {
    for (const feedUrl of discoverFeeds(res.body, indexUrl)) {
      const feed = await fetchRaw(feedUrl);
      if (!feed.ok || !looksLikeFeed(feed.body, feed.contentType)) continue;
      for (const item of parseFeed(feed.body)) {
        const found = parseBulletin(
          `${item.title}. ${item.description ?? ''}`,
          item.link ?? feedUrl,
          BULLETIN_OPTS,
        );
        if (item.published) {
          const when = new Date(item.published);
          if (!Number.isNaN(when.getTime())) {
            for (const l of found) l.trigger.date = when.toISOString();
          }
        }
        leads.push(...filterToEmployers(found));
      }
      if (leads.length > 0) {
        strategy = `feed ${feedUrl}`;
        break;
      }
    }
  }

  // Strategy 3: follow linked conviction records.
  if (leads.length === 0) {
    const links = wsibConvictionLinks(res.body, indexUrl);
    if (links.length > 0) {
      strategy = `${links.length} linked records`;
      for (const link of links) {
        try {
          const page = await fetchRaw(link);
          if (page.ok) {
            leads.push(
              ...filterToEmployers(parseBulletin(stripHtml(page.body), link, BULLETIN_OPTS)),
            );
          }
        } catch {
          // One unreachable record should not stop the rest.
        }
      }
    }
  }

  if (leads.length > 0) {
    return {
      leads,
      diagnostics: [
        {
          sourceId: 'wsib-convictions',
          ok: true,
          note: `${leads.length} WSIB convictions extracted via ${strategy}.`,
          hints: [],
          bytes: res.bytes,
          rawPath,
        },
      ],
    };
  }

  const diagnostic = describeVerdict(
    'wsib-convictions',
    classifyHtml(res.body, text.length),
    { bytes: res.bytes, rawPath, matched: 0 },
  );
  diagnostic.note = `${diagnostic.note} (no strategy produced leads)`;
  return { leads: [], diagnostics: [diagnostic] };
}
