// Toronto Open Data — building permits.
//
// A company that just pulled a permit for anything above ground level has
// workers going up. That implies Working at Heights and fall protection, and
// permits carry the applicant company name.
//
// This is a weaker signal than enforcement or hiring, because a permit is an
// inference about future work rather than a stated need — hence the lower
// weight in config.mts. It earns its place by volume and by being genuinely
// open: Toronto publishes permits under an open licence through a standard
// CKAN API, so there is no terms-of-service question.
//
// Mississauga, Brampton and Hamilton all run comparable open data portals.
// Adding them is the cheapest way to widen coverage once this one is verified
// working — the shape is close enough that this adapter is a usable template.
//
// UNVERIFIED AGAINST THE LIVE ENDPOINT — the sandbox blocks the host. The CKAN
// call sequence below is standard (package_show to find the active resource,
// then datastore_search) but the field names in the permit dataset must be
// confirmed on first run.

import type { RawLead } from '../types.mts';
import { getJson } from '../lib/http.mts';

const CKAN = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';
const PACKAGE_ID = 'building-permits-active-permits';

type CkanPackage = {
  result: {
    resources: { id: string; name: string; datastore_active: boolean }[];
  };
};

type CkanRows = {
  result: {
    records: Record<string, unknown>[];
  };
};

/** Permit types that imply work at height. Filters out interior-only work. */
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

export function parsePermitRows(rows: Record<string, unknown>[]): RawLead[] {
  const leads: RawLead[] = [];

  for (const row of rows) {
    // Field names vary between dataset revisions, so several are tried.
    const applicant = str(row, 'APPLICANT', 'applicant', 'BUILDER_NAME', 'COMPANY');
    if (!applicant) continue;

    const workType = str(row, 'WORK', 'work', 'PERMIT_TYPE', 'DESCRIPTION') ?? '';
    if (!HEIGHT_RELEVANT.test(workType)) continue;

    const issued = str(row, 'ISSUED_DATE', 'issued_date', 'APPLICATION_DATE');
    const address = str(row, 'STREET_NAME', 'street_name');

    leads.push({
      source: 'toronto-permits',
      companyName: applicant,
      city: 'Toronto',
      trigger: {
        kind: 'construction-permit',
        detail: `Pulled a permit for ${workType.toLowerCase()}${
          address ? ` on ${address}` : ''
        } — crews working at height`,
        date: issued ? new Date(issued).toISOString() : new Date().toISOString(),
        sourceUrl: 'https://open.toronto.ca/dataset/building-permits-active-permits/',
      },
      suggestedCourse: 'working-at-heights',
    });
  }

  return leads;
}

export async function fetchTorontoPermits(): Promise<RawLead[]> {
  const pkg = await getJson<CkanPackage>(
    `${CKAN}/package_show?id=${encodeURIComponent(PACKAGE_ID)}`,
  );

  const resource = pkg.result.resources.find((r) => r.datastore_active);
  if (!resource) {
    throw new Error('No datastore-active resource on the Toronto permits package');
  }

  const rows = await getJson<CkanRows>(
    `${CKAN}/datastore_search?id=${resource.id}&limit=1000`,
  );

  return parsePermitRows(rows.result.records);
}
