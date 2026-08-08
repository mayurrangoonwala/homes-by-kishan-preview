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

  /**
   * Home base. Syon is set up in Mississauga.
   *
   * Distance is a cost, not a qualifier: Raj will travel anywhere in Ontario
   * to close a client. So location down-ranks a lead, it never drops one — an
   * earlier version hard-filtered to twelve GTA cities and was silently
   * discarding perfectly good leads from the rest of the province.
   *
   * Every source is Ontario-scoped by construction (a provincial ministry,
   * an Ontario-filtered job search, a Toronto municipal dataset), so there is
   * no need to check the province at all.
   */
  homeBase: 'Mississauga',

  /**
   * Employee-count band from the agreed spec. Most free sources do not publish
   * headcount, so this is applied only where a source supplies it — see the
   * headcount note in README.md.
   */
  employeeRange: { min: 5, max: 50 },

  /** A trigger older than this is stale — the buying window has closed. */
  maxTriggerAgeDays: 60,

  /**
   * How many leads in a batch may come from outside the GTA and Golden
   * Horseshoe.
   *
   * The scoring bonus alone only nudges: a run where the distant leads happen
   * to score well could hand Sandeep a batch of ten scattered across the
   * province, which is a bad day's calling even if each lead is individually
   * fine. This makes the focus a guarantee while keeping the door open for
   * standout leads worth the drive.
   *
   * Set to config.batchSize to remove the cap entirely.
   */
  maxOutsideCorePerBatch: 3,
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
      // Enforcement notices describe the incident, not the course: "a worker
      // fell from a roof" never contains the words "working at heights". These
      // patterns are what let a conviction map to something to actually pitch.
      /\broofs?\b/i,
      /fell from|fall from (?:a |the )?(?:height|roof|ladder|scaffold)/i,
      /\bladder\b/i,
      /fall(?:ing)? (?:hazard|from height)/i,
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
 * Travel tiers, measured from Mississauga.
 *
 * A same-day round trip from home base costs Raj a couple of hours; Sudbury
 * costs him a day and a hotel. Both are worth doing for a real client, so
 * both appear — but when two leads are otherwise equal, the near one should be
 * called first, and that is all this encodes.
 *
 * Deliberately coarse. Real drive times would need a geocoding service, which
 * costs money this project does not have, and the ranking barely changes.
 */
export const travelTiers: { bonus: number; cities: string[] }[] = [
  {
    // Home turf — a short drive, easy to service repeatedly.
    bonus: 25,
    cities: [
      'Mississauga', 'Brampton', 'Toronto', 'Etobicoke', 'Oakville', 'Milton',
      'Vaughan', 'Woodbridge', 'Concord', 'North York', 'Scarborough',
    ],
  },
  {
    // Greater Golden Horseshoe — comfortable same-day return.
    bonus: 12,
    cities: [
      'Hamilton', 'Burlington', 'Markham', 'Richmond Hill', 'Newmarket',
      'Pickering', 'Ajax', 'Whitby', 'Oshawa', 'Kitchener', 'Waterloo',
      'Cambridge', 'Guelph', 'Barrie', 'St. Catharines', 'Niagara Falls',
      'Brantford', 'Aurora', 'King City', 'Bolton', 'Georgetown',
    ],
  },
  {
    // Everywhere else in Ontario — a longer trip, still worth closing.
    bonus: 0,
    cities: [],
  },
];

export function travelBonus(city?: string): number {
  if (!city) return travelTiers[1].bonus; // unknown: assume mid-range
  const needle = city.trim().toLowerCase();
  for (const tier of travelTiers) {
    if (tier.cities.some((c) => c.toLowerCase() === needle)) return tier.bonus;
  }
  return 0;
}

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
  // High, but below an OHSA conviction: a WSIB prosecution proves a
  // compliance gap rather than an injury, so the training conversation is a
  // step less urgent.
  'wsib-enforcement': 70,
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
  'wsib-convictions',
  'jobbank',
  'toronto-permits',
] as const;
