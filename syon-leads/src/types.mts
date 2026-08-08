// Shared shapes for the lead pipeline.
//
// Everything flows: RawLead (from a source) -> ScoredLead (after scoring and
// enrichment) -> a batch written to CSV. Sources know nothing about scoring,
// scoring knows nothing about output.

/** Which course this lead should be pitched. Mirrors the site's course slugs. */
export type CourseSlug =
  | 'working-at-heights'
  | 'whmis'
  | 'forklift-operator'
  | 'jhsc-certification'
  | 'first-aid-cpr'
  | 'confined-space'
  | 'health-and-safety-awareness'
  | 'fall-protection';

export type TriggerKind =
  /** Convicted or ordered by the Ministry of Labour under the OHSA. */
  | 'mol-enforcement'
  /**
   * Convicted by the WSIB under the Workplace Safety and Insurance Act.
   *
   * Deliberately distinct from mol-enforcement. WSIB prosecutes insurance
   * obligations — failing to register, failing to report an injury,
   * misstating payroll — whereas the Ministry prosecutes the safety failures
   * themselves. Both mark a business with a compliance problem and both are
   * worth calling, but only one is direct evidence that someone got hurt,
   * so they must not carry the same weight.
   */
  | 'wsib-enforcement'
  /** Company is hiring for a role that requires certification. */
  | 'hiring'
  /** Company pulled a construction permit — work at height is likely. */
  | 'construction-permit'
  /** Company recently incorporated in a relevant sector. */
  | 'new-business';

export type Trigger = {
  kind: TriggerKind;
  /** Human-readable reason, printed verbatim on the call sheet. */
  detail: string;
  /** ISO date the triggering event occurred. Drives recency scoring. */
  date: string;
  /** Where a human can verify this themselves. Never ship an unverifiable claim. */
  sourceUrl?: string;
};

export type RawLead = {
  source: string;
  companyName: string;
  city?: string;
  website?: string;
  phone?: string;
  contactName?: string;
  contactTitle?: string;
  trigger: Trigger;
  /** Course this trigger implies. Sources set it; scoring may refine it. */
  suggestedCourse?: CourseSlug;
};

export type ScoredLead = RawLead & {
  score: number;
  /** Why it scored what it did — shown to Sandeep so the list is auditable. */
  reasons: string[];
  /** Stable identity used for dedupe across batches. */
  key: string;
};

/** One row of the permanent ledger of everything ever sent. */
export type HistoryEntry = {
  key: string;
  companyName: string;
  batch: string;
  sentAt: string;
  /**
   * Filled in by Sandeep after calling. This is the feedback loop.
   *
   * `not-interested` and `do-not-contact` are deliberately different: the
   * first means no sale this time and the company may be worth another look
   * in a year, the second means they asked to be left alone and must never
   * appear in a batch again.
   */
  outcome?:
    | 'not-called'
    | 'no-answer'
    | 'not-interested'
    | 'interested'
    | 'booked'
    | 'do-not-contact';
};
