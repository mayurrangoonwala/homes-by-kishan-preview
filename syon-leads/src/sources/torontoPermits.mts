// Toronto Open Data — active building permits.
//
// UNVERIFIED AGAINST THE LIVE ENDPOINT. The sandbox this was written in blocks
// the host, so the CKAN call sequence below (package_show to locate the active
// resource, then datastore_search) is standard but the permit dataset's field
// names must be confirmed on first run. The parser tries several spellings and
// skips rows it cannot read rather than guessing.

import { ckanPermitSource, type CkanPortal } from './ckanPermits.mts';

export const torontoPortal: CkanPortal = {
  id: 'toronto-permits',
  label: 'Toronto building permits',
  api: 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action',
  packageId: 'building-permits-active-permits',
  city: 'Toronto',
  datasetUrl: 'https://open.toronto.ca/dataset/building-permits-active-permits/',
};

export const fetchTorontoPermits = ckanPermitSource(torontoPortal);
