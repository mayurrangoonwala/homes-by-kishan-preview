// Generic building-permit adapter for CKAN open-data portals.
//
// A company that just pulled a permit for anything above ground level has
// workers going up, which implies Working at Heights and fall protection.
// Permits are genuinely open data, so there is no terms-of-service question.
//
// Weaker than enforcement or hiring — a permit infers future work rather than
// stating a need — hence the lower weight in config.mts. It earns its place on
// volume.
//
// NEVER RUN AGAINST THE LIVE API. Two things are therefore built defensively:
// the dataset is located by search rather than a hardcoded slug (so a rename
// does not break it), and when no row parses, the field names actually present
// are reported so the mapping fix is obvious rather than guesswork.

import type { RawLead } from '../types.mts';
import type { SourceResult, SourceContext } from './types.mts';
import { fetchRaw, saveRaw } from '../lib/http.mts';
import type { SourceDiagnostic } from '../lib/diagnose.mts';

export type CkanPortal = {
  id: string;
  label: string;
  /** CKAN action API root, no trailing slash. */
  api: string;
  /** Preferred dataset slug. Falls back to search if it 404s. */
  packageId: string;
  /** Search terms used when packageId does not resolve. */
  searchTerms: string[];
  city: string;
  datasetUrl: string;
  /**
   * CKAN sort expression, e.g. "ISSUED_DATE desc".
   *
   * Essential, not cosmetic. Toronto's "active permits" dataset returns rows
   * in insertion order, so the first page is the OLDEST records — the first
   * live run pulled 363 permits from 2022, every one of which the staleness
   * filter would then discard. Sorting newest-first is the difference between
   * this source producing leads and producing nothing.
   */
  sort?: string;
};

type CkanResource = { id: string; name: string; datastore_active: boolean };

/**
 * Field-name candidates, in priority order.
 *
 * Portals disagree on capitalisation and naming, and datasets get revised.
 * Keeping the candidates as data means adapting to a real schema is editing a
 * list rather than rewriting the parser.
 */
export const FIELD_CANDIDATES = {
  applicant: [
    'APPLICANT',
    'applicant',
    'BUILDER_NAME',
    'builder_name',
    'COMPANY',
    'company',
    'APPLICANT_NAME',
    'applicant_name',
    'CONTRACTOR',
    'contractor',
  ],
  work: [
    'WORK',
    'work',
    'PERMIT_TYPE',
    'permit_type',
    'DESCRIPTION',
    'description',
    'WORK_TYPE',
    'work_type',
    'PROPOSED_WORK',
  ],
  issued: [
    'ISSUED_DATE',
    'issued_date',
    'ISSUEDDATE',
    'APPLICATION_DATE',
    'application_date',
    'PERMIT_DATE',
  ],
  address: ['STREET_NAME', 'street_name', 'ADDRESS', 'address', 'LOCATION'],
} as const;

/** Permit descriptions implying work at height. Interior-only work is dropped. */
// "demolish" and the storey count were both added after testing against real
// Toronto rows: the live data says "demolish the existing 2 storey dwelling",
// which the original wording ("demolition", "new building") missed entirely.
// A multi-storey build is a height job by definition.
const HEIGHT_RELEVANT =
  /roof|exterior|facade|fa[çc]ade|cladding|scaffold|new building|addition|demolition|demolish|crane|solar|antenna|siding|window replacement|hvac.*roof|\d+\s*stor(?:e?y|ies)/i;

/**
 * Markers that a permit applicant is a business rather than a private
 * individual.
 *
 * Toronto's BUILDER_NAME column mixes the two freely — the first live run
 * returned entries like "ABUZAFAR IQBAL A. QURESHI", a homeowner replacing his
 * own house. A homeowner is not a lead for corporate safety training, and
 * putting one on a call sheet wastes a slot and makes the whole list look
 * untargeted.
 *
 * Requiring a positive business signal, rather than trying to detect person
 * names, is the safer direction: the failure mode is dropping a real company
 * with an unusual name, not cold-calling a private individual at home.
 */
const BUSINESS_MARKER =
  /\b(inc|ltd|limited|corp|corporation|co|company|llp|lp|group|holdings|enterprises|construction|contracting|contractors?|builders?|developments?|homes|roofing|mechanical|electric(al)?|plumbing|hvac|services|solutions|management|industries|systems|associates|partners|restoration|renovations?|exteriors?|siding|windows|glazing|masonry|concrete|steel|scaffold\w*)\b\.?/i;

export function looksLikeBusiness(name: string): boolean {
  if (BUSINESS_MARKER.test(name)) return true;
  // "&" and "+" in a name almost always indicate a firm ("Smith & Sons").
  if (/[&+]/.test(name)) return true;
  return false;
}

/**
 * Tidies a permit description into something a caller can read aloud.
 *
 * Toronto prefixes descriptions with the trade that filed the permit —
 * "HVAC - Proposal to demolish…", "Plumbing - Proposal to…" — which is noise
 * on a call sheet and, worse, makes several permits for one project look like
 * different jobs. Also drops the boilerplate "Proposal to" opener.
 */
export function cleanDescription(text: string): string {
  return text
    .replace(/^\s*(?:hvac|plumbing|drain|electrical|mechanical|part permit)\s*[-–—:]\s*/i, '')
    .replace(/^\s*proposal to\s+/i, '')
    .replace(/^\s*proposed\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/**
 * Title-cases an ALL CAPS applicant name.
 *
 * Toronto stores these in caps. "SKYLINE ROOFING INC" shouted at a caller from
 * a spreadsheet reads like a mail merge; "Skyline Roofing Inc" reads like
 * someone did the work.
 */
export function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())
    // Initialisms stay upper; Inc and Ltd read better title-cased.
    .replace(/\b(Llp|Lp|Ulc)\b/g, (m) => m.toUpperCase());
}

export function parsePermitRows(
  rows: Record<string, unknown>[],
  opts: { source?: string; city?: string; datasetUrl?: string } = {},
): RawLead[] {
  const source = opts.source ?? 'toronto-permits';
  const city = opts.city ?? 'Toronto';
  const datasetUrl =
    opts.datasetUrl ?? 'https://open.toronto.ca/dataset/building-permits-active-permits/';

  const leads: RawLead[] = [];

  for (const row of rows) {
    const applicant = pick(row, FIELD_CANDIDATES.applicant);
    if (!applicant) continue;

    // Homeowners pulling permits on their own house are not leads.
    if (!looksLikeBusiness(applicant)) continue;

    // Match on the work type AND the free-text description. Toronto's WORK
    // column is often a bare category like "Building Permit Related(MS)" while
    // DESCRIPTION carries the detail that says whether anyone goes up a ladder.
    const workType = pick(row, FIELD_CANDIDATES.work) ?? '';
    const description = pick(row, ['DESCRIPTION', 'description']) ?? '';
    const haystack = `${workType} ${description}`;
    if (!HEIGHT_RELEVANT.test(haystack)) continue;

    const issued = pick(row, FIELD_CANDIDATES.issued);
    const address = pick(row, FIELD_CANDIDATES.address);

    // Prefer the specific description over the bare category when describing
    // why to call — "roof replacement" beats "Building Permit Related(MS)".
    const what = cleanDescription(
      HEIGHT_RELEVANT.test(description) ? description : workType,
    );

    leads.push({
      source,
      companyName: tidyName(applicant),
      city,
      trigger: {
        kind: 'construction-permit',
        detail: `Pulled a permit for ${what.toLowerCase().slice(0, 120)}${
          address ? ` on ${tidyName(address)}` : ''
        } — crews working at height`,
        date: issued ? new Date(issued).toISOString() : new Date().toISOString(),
        sourceUrl: datasetUrl,
      },
      suggestedCourse: 'working-at-heights',
    });
  }

  return leads;
}

/**
 * Explains a zero-row result by reporting the schema actually returned.
 *
 * This is the difference between "0 permits" and "the applicant column is
 * called APPLICANT_FULL_NAME" — the second is a one-line fix, the first is an
 * afternoon.
 */
export function explainNoRows(
  sourceId: string,
  rows: Record<string, unknown>[],
): SourceDiagnostic {
  const fields = rows.length > 0 ? Object.keys(rows[0]) : [];

  if (rows.length === 0) {
    return {
      sourceId,
      ok: false,
      note: 'The dataset returned no records at all.',
      hints: ['The dataset may be empty, paginated differently, or renamed.'],
    };
  }

  const hasApplicant = FIELD_CANDIDATES.applicant.some((k) => k in rows[0]);
  const hasWork = FIELD_CANDIDATES.work.some((k) => k in rows[0]);

  const hints: string[] = [];
  if (!hasApplicant) {
    hints.push(
      'No recognised applicant column. Add the real one to FIELD_CANDIDATES.applicant in ckanPermits.mts.',
    );
  }
  if (!hasWork) {
    hints.push(
      'No recognised work-description column. Add the real one to FIELD_CANDIDATES.work.',
    );
  }
  if (hasApplicant && hasWork) {
    hints.push(
      'Columns were found, so every row was filtered out by the height-relevance test. Widen HEIGHT_RELEVANT or check what the work descriptions actually say.',
    );
  }

  return {
    sourceId,
    ok: false,
    note: `${rows.length} records returned but none parsed into leads.`,
    hints,
    sampleFields: fields,
  };
}

/** Resolves the dataset, falling back to search when the slug has changed. */
async function resolveResources(
  portal: CkanPortal,
): Promise<{ resources: CkanResource[]; via: string }> {
  const direct = await fetchRaw(
    `${portal.api}/package_show?id=${encodeURIComponent(portal.packageId)}`,
  );

  if (direct.ok) {
    try {
      const parsed = JSON.parse(direct.body) as { result?: { resources?: CkanResource[] } };
      if (parsed.result?.resources) {
        return { resources: parsed.result.resources, via: `slug "${portal.packageId}"` };
      }
    } catch {
      // Fall through to search.
    }
  }

  for (const term of portal.searchTerms) {
    const search = await fetchRaw(
      `${portal.api}/package_search?q=${encodeURIComponent(term)}&rows=5`,
    );
    if (!search.ok) continue;
    try {
      const parsed = JSON.parse(search.body) as {
        result?: { results?: { name: string; resources?: CkanResource[] }[] };
      };
      for (const pkg of parsed.result?.results ?? []) {
        const active = (pkg.resources ?? []).filter((r) => r.datastore_active);
        if (active.length > 0) {
          return { resources: pkg.resources ?? [], via: `search "${term}" -> ${pkg.name}` };
        }
      }
    } catch {
      // Try the next term.
    }
  }

  return { resources: [], via: 'nothing resolved' };
}

export function ckanPermitSource(portal: CkanPortal) {
  return async (ctx: SourceContext): Promise<SourceResult> => {
    const { resources, via } = await resolveResources(portal);
    const active = resources.filter((r) => r.datastore_active);

    if (active.length === 0) {
      return {
        leads: [],
        diagnostics: [
          {
            sourceId: portal.id,
            ok: false,
            note: `Could not locate a queryable permits dataset (${via}).`,
            hints: [
              `Open ${portal.datasetUrl} and check the dataset still exists under that name.`,
              'Update packageId or searchTerms in the portal config.',
            ],
          },
        ],
      };
    }

    // Try each active resource — portals often expose several years, and only
    // some carry current data.
    const allRows: Record<string, unknown>[] = [];
    for (const resource of active.slice(0, 3)) {
      const sortParam = portal.sort ? `&sort=${encodeURIComponent(portal.sort)}` : '';
      let res = await fetchRaw(
        `${portal.api}/datastore_search?id=${resource.id}&limit=1000${sortParam}`,
      );

      // A sort on a column this resource does not have is a 409. Retrying
      // unsorted still yields data — stale data, but the diagnostics will say
      // so, which beats the source failing outright.
      if (!res.ok && sortParam) {
        res = await fetchRaw(`${portal.api}/datastore_search?id=${resource.id}&limit=1000`);
      }
      if (!res.ok) continue;
      if (ctx.debugDir) {
        saveRaw(ctx.debugDir, `${portal.id}-${resource.id.slice(0, 8)}.json`, res.body);
      }
      try {
        const parsed = JSON.parse(res.body) as {
          result?: { records?: Record<string, unknown>[] };
        };
        allRows.push(...(parsed.result?.records ?? []));
      } catch {
        // Skip an unparseable resource.
      }
    }

    const leads = parsePermitRows(allRows, {
      source: portal.id,
      city: portal.city,
      datasetUrl: portal.datasetUrl,
    });

    if (leads.length === 0) {
      const diag = explainNoRows(portal.id, allRows);
      diag.note = `${diag.note} (resolved via ${via})`;
      return { leads, diagnostics: [diag] };
    }

    return {
      leads,
      diagnostics: [
        {
          sourceId: portal.id,
          ok: true,
          note: `${leads.length} height-relevant permits from ${allRows.length} records (via ${via}).`,
          hints: [],
        },
      ],
    };
  };
}
