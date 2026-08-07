import type { RawLead, ScoredLead, CourseSlug } from '../types.mts';
import { config, courseKeywords, weights } from '../config.mts';

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
function recencyFactor(iso: string): number {
  const age = ageInDays(iso);
  if (age >= config.maxTriggerAgeDays) return 0;
  if (age <= 0) return 1;
  return 1 - age / config.maxTriggerAgeDays;
}

export function scoreLead(lead: RawLead): ScoredLead {
  const reasons: string[] = [];
  let score = 0;

  const base = weights[lead.trigger.kind] ?? 0;
  const recency = recencyFactor(lead.trigger.date);
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

  return { ...lead, score, reasons, key: leadKey(lead.companyName, lead.city) };
}

/** Drops leads outside the service area or past the staleness window. */
export function withinSpec(lead: RawLead): boolean {
  if (recencyFactor(lead.trigger.date) <= 0) return false;
  if (!lead.city) return true; // unknown city is not disqualifying on its own
  const area = config.serviceArea.map((c) => c.toLowerCase());
  return area.includes(lead.city.toLowerCase());
}

/**
 * Collapses the same company appearing from several sources into one lead,
 * keeping the highest score and merging contact details. A company that shows
 * up in both enforcement and hiring data is a stronger lead than either signal
 * alone, so the combined entry keeps both reasons.
 */
export function mergeDuplicates(leads: ScoredLead[]): ScoredLead[] {
  const byKey = new Map<string, ScoredLead>();

  for (const lead of leads) {
    const existing = byKey.get(lead.key);
    if (!existing) {
      byKey.set(lead.key, lead);
      continue;
    }
    byKey.set(lead.key, {
      ...existing,
      phone: existing.phone ?? lead.phone,
      website: existing.website ?? lead.website,
      contactName: existing.contactName ?? lead.contactName,
      contactTitle: existing.contactTitle ?? lead.contactTitle,
      suggestedCourse: existing.suggestedCourse ?? lead.suggestedCourse,
      // Two independent signals is materially stronger than one.
      score: Math.max(existing.score, lead.score) + 20,
      reasons: [...existing.reasons, `also: ${lead.trigger.detail}`, 'multi-source (+20)'],
    });
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score);
}
