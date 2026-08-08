// Sample leads for `--demo`.
//
// These are INVENTED companies. They exist so the output format can be
// inspected and shown to Sandeep before a single live source is calibrated.
// Nothing here is a real business and none of it should ever be sent.

import type { RawLead } from '../types.mts';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export const demoLeads: RawLead[] = [
  {
    source: 'mol-convictions',
    companyName: 'Northgate Roofing Ltd.',
    city: 'Brampton',
    phone: '905-555-0142',
    website: 'https://example.invalid/northgate',
    trigger: {
      kind: 'mol-enforcement',
      detail: 'Fined $75,000 under the OHSA after a fall from height',
      date: daysAgo(6),
      sourceUrl: 'https://www.ontario.ca/page/court-bulletins-convictions',
    },
    suggestedCourse: 'working-at-heights',
  },
  {
    source: 'jobbank',
    companyName: 'Halton Cold Storage Inc.',
    city: 'Milton',
    contactName: 'Operations Manager',
    contactTitle: 'Operations Manager',
    trigger: {
      kind: 'hiring',
      detail: 'Hiring — posting matched "lift truck operator", so they have staff who need certifying',
      date: daysAgo(2),
      sourceUrl: 'https://www.jobbank.gc.ca/jobsearch/jobsearch',
    },
    suggestedCourse: 'forklift-operator',
  },
  {
    source: 'jobbank',
    companyName: 'Halton Cold Storage Limited',
    city: 'Milton',
    phone: '905-555-0177',
    trigger: {
      kind: 'hiring',
      detail: 'Second posting in two weeks — warehouse team is expanding',
      date: daysAgo(9),
    },
    suggestedCourse: 'forklift-operator',
  },
  {
    source: 'toronto-permits',
    companyName: 'Vertex Construction Group',
    city: 'Toronto',
    trigger: {
      kind: 'construction-permit',
      detail: 'Pulled a permit for new building on Dufferin St — crews working at height',
      date: daysAgo(11),
      sourceUrl: 'https://open.toronto.ca/dataset/building-permits-active-permits/',
    },
    suggestedCourse: 'working-at-heights',
  },
  {
    source: 'mol-convictions',
    companyName: 'Precision Metal Works Inc.',
    city: 'Mississauga',
    phone: '905-555-0119',
    contactName: 'Dana Whitfield',
    contactTitle: 'Plant Manager',
    trigger: {
      kind: 'mol-enforcement',
      detail: 'Convicted under the OHSA following a confined space incident',
      date: daysAgo(21),
    },
    suggestedCourse: 'confined-space',
  },
  {
    source: 'jobbank',
    companyName: 'Kitchener Precision Tooling',
    city: 'Kitchener',
    trigger: {
      kind: 'hiring',
      detail: 'Hiring — posting matched "WHMIS", so they are onboarding new staff',
      date: daysAgo(4),
    },
    suggestedCourse: 'whmis',
  },
  {
    source: 'toronto-permits',
    // Outside the GTA. Kept, flagged, and ranked below nearer leads —
    // Raj travels anywhere in Ontario to sign a client.
    companyName: 'Sudbury Steel Erectors',
    city: 'Sudbury',
    trigger: {
      kind: 'construction-permit',
      detail: 'Permit for exterior cladding',
      date: daysAgo(3),
    },
    suggestedCourse: 'working-at-heights',
  },
  {
    source: 'jobbank',
    // Stale — past the 60-day window. This one IS dropped: the buying
    // window has closed regardless of where the company is.
    companyName: 'Oakville Facilities Services',
    city: 'Oakville',
    trigger: {
      kind: 'hiring',
      detail: 'Old posting for a safety coordinator',
      date: daysAgo(95),
    },
    suggestedCourse: 'health-and-safety-awareness',
  },
];
