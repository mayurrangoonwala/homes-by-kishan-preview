// TEMPLATE — copy this file to add a new lead source. It is not registered
// anywhere and contributes nothing on its own. sources/index.mts is a
// hand-curated list of imports, not a directory scan, so an unregistered
// file like this one is simply never reached — nothing needs to "skip" it.
//
// Read this top-to-bottom before writing a new source; each numbered step
// below is something every real source in this codebase already does, and
// skipping one is how a source ships broken or silently useless.
//
// ── Checklist ────────────────────────────────────────────────────────────
//
// 1. Add a TriggerKind to types.mts if this source's signal is genuinely new
//    (not just a new source of an existing signal — a second permit portal
//    reuses 'construction-permit', it does not invent 'construction-permit-2').
//    Add it to BOTH the union AND the ALL_TRIGGER_KINDS array in the same
//    file — the completeness test in pipeline.test.mts fails loudly if you
//    forget the second one, which is the point of that array.
// 2. Add a weight for that TriggerKind in config.mts's `weights`. Missing
//    this scores every lead 0 — no error, it just never reaches a batch.
//    The same completeness test catches a missing weight; it will not catch
//    a *wrong* one, so place it deliberately relative to the existing
//    weights (does this signal mean more or less urgency than a permit? a
//    conviction? read the comment above `weights` in config.mts).
// 3. Give it a freshness window in config.mts's `maxTriggerAgeDays` if the
//    default 60 days is wrong for this signal. A conviction stays relevant
//    for months; a job posting goes cold in weeks. Get this wrong and either
//    good leads get dropped or stale ones get shipped.
// 4. If this source returns individuals mixed with businesses (permit data,
//    court records, anything drawing on public records generally does),
//    filter them out. Reuse `looksLikeBusiness` from ckanPermits.mts — a
//    person's name has no legal suffix, so requiring one is the safe
//    direction. Getting this wrong means a private individual on a
//    cold-call sheet, which is the single worst failure mode in this
//    codebase — see wsibConvictions.mts's isEmployerConviction for a case
//    where the offence TEXT also had to be checked, not just the name.
// 5. If the page renders with JavaScript (empty shell, content assembled
//    client-side), do not write a scraper against a blank page — reach for
//    spaRescue.mts first: sitemap discovery, dynamic-rendering-to-crawlers,
//    and JS-bundle scanning are all generic and already built. See
//    molConvictions.mts for the full rescue chain in use.
// 6. Never invent a fact. If a field cannot be read from the source, leave
//    it undefined — a wrong company name or fabricated phone number is worse
//    than a shorter batch. This applies to city, phone, contact name,
//    everything.
// 7. Return diagnostics, not a throw. A source that throws takes the whole
//    batch down with it (run.mts catches it, but you lose the "why" for this
//    one source). Report what happened via the SourceResult.diagnostics
//    array instead — see lib/diagnose.mts for the shared verdict helpers
//    (classifyHtml, describeVerdict, describeHttpFailure) that turn a raw
//    HTTP response into an actionable note.
// 8. Register it in sources/index.mts (adds it to the `sources` array) AND
//    in config.mts's `enabledSources` (documents intent). The completeness
//    test asserts the two lists match — if you only do one, the test fails
//    and says exactly which one you missed.
// 9. Write tests against real captured data, not assumed shapes. Every
//    working parser in this codebase — ckanPermits, jobbank, wsibConvictions
//    — was wrong on the first attempt against a live page and right after
//    seeing the real payload. Run `npm run inspect` (or `collect.sh` on a
//    machine with real network access) to capture one, then write fixtures
//    from it, the way test/pipeline.test.mts does for every other source.
//
// ── End checklist ───────────────────────────────────────────────────────

import type { RawLead } from '../types.mts';
import type { SourceResult, SourceContext } from './types.mts';
import { fetchRaw, stripHtml, saveRaw } from '../lib/http.mts';
import { classifyHtml, describeVerdict, describeHttpFailure } from '../lib/diagnose.mts';
import { courseFromText } from '../lib/score.mts';
// If this source might render with JS, also import from spaRescue.mts:
// import { fetchAsCrawler, discoverSitemapUrls, bundleUrls } from '../lib/spaRescue.mts';
// If it might return individuals mixed with businesses:
// import { looksLikeBusiness } from './ckanPermits.mts';

const SOURCE_ID = 'template-source';
const INDEX_URL = 'https://example.invalid/replace-me';

export async function fetchTemplateSource(ctx: SourceContext): Promise<SourceResult> {
  const res = await fetchRaw(INDEX_URL);
  const rawPath = ctx.debugDir ? saveRaw(ctx.debugDir, `${SOURCE_ID}.html`, res.body) : undefined;

  if (!res.ok) {
    return {
      leads: [],
      diagnostics: [
        describeHttpFailure(SOURCE_ID, res.status, new URL(INDEX_URL).hostname, {
          bytes: res.bytes,
          rawPath,
        }),
      ],
    };
  }

  const text = stripHtml(res.body);
  const leads: RawLead[] = [];

  // ---- Replace this block with real extraction against the real payload ----
  // for (const row of parseSomehow(text)) {
  //   if (!looksLikeBusiness(row.name)) continue; // if applicable — see step 4
  //   leads.push({
  //     source: SOURCE_ID,
  //     companyName: row.name,
  //     city: row.city,
  //     trigger: {
  //       kind: 'hiring', // or your new TriggerKind
  //       detail: `Explains, in one sentence, why to call them now.`,
  //       date: row.date, // ISO string — never fabricate a date
  //       sourceUrl: row.url ?? INDEX_URL,
  //     },
  //     suggestedCourse: courseFromText(row.description ?? ''),
  //   });
  // }
  // ---------------------------------------------------------------------------

  if (leads.length > 0) {
    return {
      leads,
      diagnostics: [
        {
          sourceId: SOURCE_ID,
          ok: true,
          note: `${leads.length} leads extracted.`,
          hints: [],
          bytes: res.bytes,
          rawPath,
        },
      ],
    };
  }

  const verdict = classifyHtml(res.body, text.length);
  const diagnostic = describeVerdict(SOURCE_ID, verdict, {
    bytes: res.bytes,
    rawPath,
    matched: 0,
  });
  return { leads: [], diagnostics: [diagnostic] };
}
