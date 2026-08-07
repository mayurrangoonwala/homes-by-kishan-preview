// Generic building-permit adapter for CKAN open-data portals.
//
// A company that just pulled a permit for anything above ground level has
// workers going up, which implies Working at Heights and fall protection.
// Permits carry the applicant company name, and they are genuinely open data,
// so there is no terms-of-service question.
//
// This is a weaker signal than enforcement or hiring, because a permit is an
// inference about future work rather than a stated need — hence the lower
// weight in config.mts. It earns its place on volume.
//
// Factored as a factory because adding the next municipality should be a
// config entry, not another file. Toronto is the only portal configured, and
// deliberately so: other Ontario municipalities publish permits on ArcGIS Hub
// or bespoke platforms rather than CKAN, and their endpoints have not been
// confirmed. Guessing a URL that returns 404 is worse than an honest gap —
// see the "adding a portal" note in README.md.

import type { RawLead } from '../types.mts';
import { getJson } from '../lib/http.mts';

export type CkanPortal = {
  id: string;
  label: string;
  /** CKAN action API root, no trailing slash. */
  api: string;
  /** Dataset id or slug holding active permits. */
  packageId: string;
  /** City recorded on every lead from this portal. */
  city: string;
  /** Human-facing dataset page, printed on the call sheet for verification. */
  datasetUrl: string;
};

type CkanPackage = {
  result: { resources: { id: string; name: string; datastore_active: boolean }[] };
};

type CkanRows = { result: { records: Record<string, unknown>[] } };

/**
 * Permit descriptions that imply work at height. Interior-only work is
 * filtered out — a kitchen refit is not a fall-protection lead, and shipping
 * it would dilute the batch.
 */
const HEIGHT_RELEVANT =
  /roof|exterior|facade|cladding|scaffold|new building|addition|demolition|crane|solar|antenna|hvac.*roof/i;

function str(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
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
    // Field names vary between portals and between dataset revisions, so
    // several spellings are tried before giving up on a row.
    const applicant = str(row, 'APPLICANT', 'applicant', 'BUILDER_NAME', 'COMPANY');
    if (!applicant) continue;

    const workType = str(row, 'WORK', 'work', 'PERMIT_TYPE', 'DESCRIPTION') ?? '';
    if (!HEIGHT_RELEVANT.test(workType)) continue;

    const issued = str(row, 'ISSUED_DATE', 'issued_date', 'APPLICATION_DATE');
    const address = str(row, 'STREET_NAME', 'street_name');

    leads.push({
      source,
      companyName: applicant,
      city,
      trigger: {
        kind: 'construction-permit',
        detail: `Pulled a permit for ${workType.toLowerCase()}${
          address ? ` on ${address}` : ''
        } — crews working at height`,
        date: issued ? new Date(issued).toISOString() : new Date().toISOString(),
        sourceUrl: datasetUrl,
      },
      suggestedCourse: 'working-at-heights',
    });
  }

  return leads;
}

/** Builds a fetcher for one CKAN portal. */
export function ckanPermitSource(portal: CkanPortal): () => Promise<RawLead[]> {
  return async () => {
    const pkg = await getJson<CkanPackage>(
      `${portal.api}/package_show?id=${encodeURIComponent(portal.packageId)}`,
    );

    const resource = pkg.result.resources.find((r) => r.datastore_active);
    if (!resource) {
      throw new Error(`No datastore-active resource on ${portal.label} package`);
    }

    const rows = await getJson<CkanRows>(
      `${portal.api}/datastore_search?id=${resource.id}&limit=1000`,
    );

    return parsePermitRows(rows.result.records, {
      source: portal.id,
      city: portal.city,
      datasetUrl: portal.datasetUrl,
    });
  };
}
