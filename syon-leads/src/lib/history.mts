import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HistoryEntry, ScoredLead } from '../types.mts';

/**
 * The permanent ledger of every lead ever sent.
 *
 * This is the most important file in the project and the least interesting.
 * Sending the same company twice is the fastest way to lose the account — it
 * says the list is generated blind. It is also where call outcomes live, which
 * is the only evidence that any of this works when the free period ends.
 *
 * Stored as JSON and committed to git so the ledger is versioned and cannot be
 * silently lost with a laptop.
 */
export class History {
  private entries: HistoryEntry[] = [];
  private path: string;

  // Written as an explicit field rather than a TypeScript parameter property:
  // Node's strip-only type stripping does not support parameter properties,
  // and keeping this runnable with zero build step and zero dependencies is
  // worth more than the shorthand.
  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) {
      this.entries = JSON.parse(readFileSync(path, 'utf8')) as HistoryEntry[];
    }
  }

  /** True if this company has ever been sent, in any previous batch. */
  hasSeen(key: string): boolean {
    return this.entries.some((e) => e.key === key);
  }

  filterUnseen(leads: ScoredLead[]): ScoredLead[] {
    return leads.filter((l) => !this.hasSeen(l.key));
  }

  record(leads: ScoredLead[], batch: string): void {
    const sentAt = new Date().toISOString();
    for (const lead of leads) {
      this.entries.push({
        key: lead.key,
        companyName: lead.companyName,
        batch,
        sentAt,
        outcome: 'not-called',
      });
    }
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.entries, null, 2), 'utf8');
  }

  get count(): number {
    return this.entries.length;
  }

  /**
   * Conversion stats from recorded outcomes. This is the number that justifies
   * charging for the service later, so it is worth chasing Sandeep for the
   * outcome column every fortnight.
   */
  stats(): { sent: number; called: number; interested: number; booked: number } {
    const sent = this.entries.length;
    const called = this.entries.filter(
      (e) => e.outcome && e.outcome !== 'not-called',
    ).length;
    const interested = this.entries.filter((e) => e.outcome === 'interested').length;
    const booked = this.entries.filter((e) => e.outcome === 'booked').length;
    return { sent, called, interested, booked };
  }
}
