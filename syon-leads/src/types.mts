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
  /** Company was recently convicted or issued orders by the Ministry of Labour. */
  | 'mol-enforcement'
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
  /** Filled in by Sandeep after calling. This is the feedback loop. */
  outcome?: 'not-called' | 'no-answer' | 'not-interested' | 'interested' | 'booked';
};
