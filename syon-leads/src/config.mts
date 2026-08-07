// Everything tunable lives here.
//
// The spec below is the one Sandeep confirmed on 17 July 2026: businesses of
// 5 to 50 employees, decision-maker phone number preferred, delivered as a
// numbered batch.

import type { CourseSlug } from './types.mts';

export const config = {
  /** Batch size. Sandeep asked for a maximum of 10 per fortnight. */
  batchSize: 10,

  /** Cadence in days. Used to name batches and to warn on early runs. */
  cadenceDays: 14,

  /** Service area. A lead outside this is dropped, not down-ranked. */
  serviceArea: [
    'Toronto',
    'Mississauga',
    'Brampton',
    'Hamilton',
    'Vaughan',
    'Markham',
    'Oakville',
    'Burlington',
    'Milton',
    'Richmond Hill',
    'Oshawa',
    'Kitchener',
    'Etobicoke',
    'Scarborough',
    'North York',
    'Concord',
    'Woodbridge',
  ],

  /**
   * Employee-count band from the agreed spec. Most free sources do not publish
   * headcount, so this is applied only where a source supplies it — see the
   * headcount note in README.md.
   */
  employeeRange: { min: 5, max: 50 },

  /** A trigger older than this is stale — the buying window has closed. */
  maxTriggerAgeDays: 60,
} as const;

/**
 * Keyword -> course mapping.
 *
 * This is the core of the whole system. A job posting that says "must have
 * valid forklift certification" is a company telling you, in public, that they
 * have an untrained or expanding workforce. Matching that phrase to the
 * forklift course turns a cold call into "I saw you're hiring lift truck
 * operators."
 *
 * Order matters: the first match wins, so the most specific phrases go first.
 */
export const courseKeywords: { course: CourseSlug; patterns: RegExp[] }[] = [
  {
    course: 'working-at-heights',
    patterns: [
      /working[- ]at[- ]heights/i,
      /\bWAH\b/,
      /fall arrest/i,
      /scaffold/i,
      /roofer|roofing/i,
    ],
  },
  {
    course: 'forklift-operator',
    patterns: [
      /fork ?lift/i,
      /lift truck/i,
      /counterbalance/i,
      /\breach truck\b/i,
      /\bpallet jack\b/i,
      /warehouse associate/i,
    ],
  },
  {
    course: 'confined-space',
    patterns: [/confined space/i, /tank entry/i, /\bvault entry\b/i],
  },
  {
    course: 'whmis',
    patterns: [/\bWHMIS\b/i, /\bGHS\b/, /hazardous material/i, /safety data sheet/i],
  },
  {
    course: 'first-aid-cpr',
    patterns: [/first aid/i, /\bCPR\b/, /\bAED\b/],
  },
  {
    course: 'fall-protection',
    patterns: [
      /fall protection/i,
      /elevated work platform/i,
      /\bEWP\b/,
      /scissor lift/i,
      /boom lift/i,
      /aerial lift/i,
    ],
  },
  {
    course: 'jhsc-certification',
    patterns: [/joint health and safety/i, /\bJHSC\b/, /health and safety committee/i],
  },
  {
    course: 'health-and-safety-awareness',
    patterns: [/health and safety/i, /\bOHSA\b/, /safety coordinator/i],
  },
];

/**
 * Scoring weights.
 *
 * Enforcement outranks everything by a wide margin: a company that was just
 * ordered or fined by the Ministry of Labour has an active, funded, urgent
 * problem, and is the single warmest cold call available in this sector. A
 * hiring signal is next — a real need with a known timeline. A construction
 * permit is a good inference but only an inference. A new incorporation is the
 * weakest: relevant sector, no evidence of an actual need yet.
 */
export const weights: Record<string, number> = {
  'mol-enforcement': 100,
  hiring: 60,
  'construction-permit': 35,
  'new-business': 15,

  /** Added when the lead already carries something dialable. */
  hasPhone: 25,
  hasContactName: 15,
  hasWebsite: 5,

  /** Added when the trigger maps to a specific course, not a generic one. */
  specificCourse: 20,
};

/** Sources are ordered by value; the runner reports per-source yield. */
export const enabledSources = [
  'mol-convictions',
  'jobbank',
  'toronto-permits',
] as const;
