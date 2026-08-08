import { ckanPermitSource, type CkanPortal } from './ckanPermits.mts';

export const torontoPortal: CkanPortal = {
  id: 'toronto-permits',
  label: 'Toronto building permits',
  api: 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action',
  packageId: 'building-permits-active-permits',
  // Used when the slug above no longer resolves, which is the usual failure
  // mode for open-data portals — datasets get renamed far more often than
  // they get withdrawn.
  searchTerms: ['building permits active', 'building permits', 'permits'],
  city: 'Toronto',
  datasetUrl: 'https://open.toronto.ca/dataset/building-permits-active-permits/',
  // Confirmed against the live schema: ISSUED_DATE exists and the default
  // ordering is oldest-first. Without this the first page is permits from
  // 2022, all of which the staleness filter discards.
  sort: 'ISSUED_DATE desc',
};

export const fetchTorontoPermits = ckanPermitSource(torontoPortal);
