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
};

export const fetchTorontoPermits = ckanPermitSource(torontoPortal);
