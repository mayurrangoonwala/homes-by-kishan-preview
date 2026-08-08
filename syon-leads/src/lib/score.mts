import type { RawLead, ScoredLead, CourseSlug } from '../types.mts';
import { config, courseKeywords, weights, travelBonus } from '../config.mts';

/** Normalised company identity, used for dedupe across sources and batches. */
export function leadKey(companyName: string, city?: string): string {
  const name = companyName
    .toLowerCase()
    .replace(
      /\b(inc|incorporated|ltd|limited|corp|corporation|co|company|llp|lp|enterprises|holdings|group|services|the)\b/g,
      '',
    )
    .replace(/[^a-z0-9]/g, '');
  const place = (city ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return `${name}::${place}`;
}

/** First matching keyword wins, so specific phrases are ordered first. */
export function courseFromText(text: string): CourseSlug | undefined {
  for (const { course, patterns } of courseKeywords) {
    if (patterns.some((p) => p.test(text))) return course;
  }
  return undefined;
}

function ageInDays(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 86_400_000;
}

/**
 * Recency multiplier. A Ministry order from last week is a different
 * conversation from one eight weeks ago — the urgency has usually been dealt
 * with by then, internally or by a competitor. Decays linearly to zero across
 * the configured window rather than cutting off sharply, so a batch that is
 * short on fresh triggers can still surface slightly older ones.
 */
function windowFor(kind: string): number {
  return config.maxTriggerAgeDays[kind] ?? config.defaultTriggerAgeDays;
}

function recencyFactor(iso: string, kind: string): number {
  const window = windowFor(kind);
  const age = ageInDays(iso);
  if (age >= window) return 0;
  if (age <= 0) return 1;
  return 1 - age / window;
}

/**
 * Companies that are real but very hard to actually phone.
 *
 * Development permits are frequently pulled by single-purpose entities: a
 * numbered Ontario corporation, or one named after the address it was created
 * to build. They are legitimate businesses, but they usually have no website,
 * no listed number and no staff to train — the training buyer is the general
 * contractor they hired, who is not named on the permit.
 *
 * Down-ranked rather than dropped: the name is still a thread to pull, and on
 * a thin week it beats an empty row. But it should never outrank a company
 * someone can actually ring.
 */
export function looksHardToReach(name: string): boolean {
  const n = name.trim();
  // "2650192 Ontario Inc", "001572247 Ontario Limited"
  if (/^\d{5,}\s+(ontario|canada)\b/i.test(n)) return true;
  // "181b Poplar Plains Road Inc", "108 Clovelly Avenue Inc"
  if (/^\d+[a-z]?\s+\w+.*\b(road|rd|avenue|ave|street|st|drive|dr|crescent|cres|boulevard|blvd|lane|way|place|pl)\b/i.test(n)) {
    return true;
  }
  return false;
}

export function scoreLead(lead: RawLead): ScoredLead {
  const reasons: string[] = [];
  let score = 0;

  const base = weights[lead.trigger.kind] ?? 0;
  const recency = recencyFactor(lead.trigger.date, lead.trigger.kind);
  const triggerScore = Math.round(base * recency);
  score += triggerScore;

  const days = Math.round(ageInDays(lead.trigger.date));
  reasons.push(
    `${lead.trigger.kind} ${Number.isFinite(days) ? `${days}d ago` : '(undated)'} (+${triggerScore})`,
  );

  if (lead.phone) {
    score += weights.hasPhone;
    reasons.push(`has phone (+${weights.hasPhone})`);
  }
  if (lead.contactName) {
    score += weights.hasContactName;
    reasons.push(`named contact (+${weights.hasContactName})`);
  }
  if (lead.website) {
    score += weights.hasWebsite;
    reasons.push(`has website (+${weights.hasWebsite})`);
  }
  if (lead.suggestedCourse) {
    score += weights.specificCourse;
    reasons.push(`maps to ${lead.suggestedCourse} (+${weights.specificCourse})`);
  }

  if (looksHardToReach(lead.companyName)) {
    score -= weights.hardToReachPenalty;
    reasons.push(
      `single-purpose entity, likely no listed contact (-${weights.hardToReachPenalty})`,
    );
  }

  // Distance from Mississauga breaks ties; it never disqualifies.
  const travel = travelBonus(lead.city);
  if (travel > 0) {
    score += travel;
    reasons.push(`near home base (+${travel})`);
  }

  return { ...lead, score, reasons, key: leadKey(lead.companyName, lead.city) };
}

/**
 * Drops leads past the staleness window.
 *
 * Location is deliberately NOT a filter. Raj will travel anywhere in Ontario
 * to sign a client, and every source is already Ontario-scoped, so filtering
 * by city only threw away business. Distance is handled as a scoring bonus in
 * scoreLead instead.
 */
export function withinSpec(lead: RawLead): boolean {
  return recencyFactor(lead.trigger.date, lead.trigger.kind) > 0;
}

/**
 * Collapses the same company appearing from several sources into one lead,
 * keeping the highest score and merging contact details. A company that shows
 * up in both enforcement and hiring data is a stronger lead than either signal
 * alone, so the combined entry keeps both reasons.
 */
/** Corroboration from a genuinely different source. */
const CROSS_SOURCE_BONUS = 20;
/** Repeat activity within one source — real signal, but a weaker one. */
const REPEAT_BONUS = 6;
const REPEAT_BONUS_CAP = 18;

export function mergeDuplicates(leads: ScoredLead[]): ScoredLead[] {
  type Acc = {
    lead: ScoredLead;
    sources: Set<string>;
    repeats: number;
    alsoSeen: string[];
  };

  const byKey = new Map<string, Acc>();

  for (const lead of leads) {
    const acc = byKey.get(lead.key);
    if (!acc) {
      byKey.set(lead.key, {
        lead,
        sources: new Set([lead.source]),
        repeats: 0,
        alsoSeen: [],
      });
      continue;
    }

    acc.sources.add(lead.source);
    acc.repeats += 1;
    acc.alsoSeen.push(lead.trigger.detail);

    acc.lead = {
      ...acc.lead,
      phone: acc.lead.phone ?? lead.phone,
      website: acc.lead.website ?? lead.website,
      contactName: acc.lead.contactName ?? lead.contactName,
      contactTitle: acc.lead.contactTitle ?? lead.contactTitle,
      suggestedCourse: acc.lead.suggestedCourse ?? lead.suggestedCourse,
      // Keep the strongest single trigger as the headline reason to call.
      score: Math.max(acc.lead.score, lead.score),
      trigger:
        lead.score > acc.lead.score ? lead.trigger : acc.lead.trigger,
    };
  }

  const out: ScoredLead[] = [];

  for (const { lead, sources, repeats, alsoSeen } of byKey.values()) {
    let score = lead.score;
    const reasons = [...lead.reasons];

    // Two independent sources agreeing is real corroboration and is worth
    // much more than the same source listing a company twice.
    if (sources.size > 1) {
      score += CROSS_SOURCE_BONUS;
      reasons.push(`corroborated by ${sources.size} sources (+${CROSS_SOURCE_BONUS})`);
    }

    // Repeat activity within one source still means something — a builder
    // with six open permits has more crews at height than one with a single
    // permit — but it is a volume signal, not corroboration, so it is worth
    // less and it saturates. An earlier version added a flat 20 per duplicate
    // and labelled it "multi-source", which let one busy builder accumulate
    // +100 from what is really a single data source.
    if (repeats > 0) {
      const bonus = Math.min(repeats * REPEAT_BONUS, REPEAT_BONUS_CAP);
      score += bonus;
      reasons.push(`${repeats + 1} separate records (+${bonus})`);
    }

    // Two extra examples is plenty of context for a caller; the rest is noise
    // on a spreadsheet.
    for (const detail of alsoSeen.slice(0, 2)) {
      reasons.push(`also: ${detail}`);
    }
    if (alsoSeen.length > 2) {
      reasons.push(`and ${alsoSeen.length - 2} more`);
    }

    out.push({ ...lead, score, reasons });
  }

  return out.sort((a, b) => b.score - a.score);
}

/** True when the lead sits in the GTA / Golden Horseshoe focus area. */
export function isCoreArea(city?: string): boolean {
  return travelBonus(city) > 0;
}

/**
 * Picks the batch, keeping it focused on the GTA without discarding a strong
 * lead from further out.
 *
 * Leads arrive sorted by score. Core-area leads are taken in order; distant
 * ones are taken in order too, but only up to the configured cap. If there
 * are not enough core leads to fill the batch, the remaining slots go to the
 * best distant ones rather than shipping a short batch — a real lead in
 * Sudbury beats an empty row.
 */
export function selectBatch(
  leads: ScoredLead[],
  size: number,
  maxOutsideCore: number,
): ScoredLead[] {
  const core = leads.filter((l) => isCoreArea(l.city));
  const outside = leads.filter((l) => !isCoreArea(l.city));

  const chosen = [
    ...core.slice(0, size),
    ...outside.slice(0, Math.min(maxOutsideCore, size)),
  ];

  // Re-sort so the call sheet is still strongest-first, then trim.
  chosen.sort((a, b) => b.score - a.score);
  const batch = chosen.slice(0, size);

  // Backfill from whatever is left if the cap left the batch short.
  if (batch.length < size) {
    const taken = new Set(batch.map((l) => l.key));
    for (const lead of leads) {
      if (batch.length >= size) break;
      if (!taken.has(lead.key)) batch.push(lead);
    }
    batch.sort((a, b) => b.score - a.score);
  }

  return batch;
}
