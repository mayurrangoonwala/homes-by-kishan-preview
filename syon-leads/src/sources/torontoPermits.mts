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
  // Sort by the insertion counter, not by a date.
  //
  // The obvious choice, ISSUED_DATE desc, is wrong: many rows are permits that
  // have been applied for but not yet issued, so ISSUED_DATE is null — and
  // Postgres orders NULLs FIRST on a descending sort. A live run returned 1000
  // consecutive rows with a null issue date and a null builder name, and the
  // source reported zero leads while looking perfectly healthy.
  //
  // _id is a monotonic insertion counter: never null, and newest-first
  // correlates with recency without depending on the ordering semantics of a
  // nullable column.
  sort: '_id desc',
};

export const fetchTorontoPermits = ckanPermitSource(torontoPortal);
