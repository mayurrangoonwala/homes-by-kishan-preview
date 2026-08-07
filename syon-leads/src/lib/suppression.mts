import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ScoredLead } from '../types.mts';
import { leadKey } from './score.mts';

/**
 * The do-not-contact list.
 *
 * Two things feed it:
 *
 *  1. Explicit entries in data/suppression.json — someone rang Syon and asked
 *     to be left alone, or Raj knows a company is a customer, a competitor,
 *     or off-limits for any other reason.
 *  2. Anyone Sandeep marked `do-not-contact` in a returned call sheet.
 *
 * This is deliberately separate from the sent-history ledger. History answers
 * "have we already used this lead", suppression answers "are we allowed to
 * contact them at all" — and the second must survive even if the history file
 * is ever cleared or rebuilt.
 *
 * Matching is intentionally broader than exact identity. A company that asked
 * not to be called should not reappear because a different source spelled the
 * name slightly differently, so this matches on the normalised key AND on a
 * name-substring check, and it ignores the city — a request not to be
 * contacted applies to the company, not to one of its sites.
 */

export type SuppressionEntry = {
  /** Company name as recorded. Matched loosely — see matches(). */
  companyName: string;
  /** Why they are suppressed. Required: an unexplained entry gets removed later. */
  reason: string;
  addedAt: string;
};

/** Normalised name with the city component stripped off the key. */
function nameKey(companyName: string): string {
  return leadKey(companyName, '').replace(/::$/, '');
}

export class Suppression {
  private entries: SuppressionEntry[] = [];
  private keys = new Set<string>();
  private path: string;

  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) {
      this.entries = JSON.parse(readFileSync(path, 'utf8')) as SuppressionEntry[];
    }
    this.reindex();
  }

  private reindex(): void {
    this.keys = new Set(this.entries.map((e) => nameKey(e.companyName)));
  }

  /**
   * Adds keys sourced from returned call sheets. Kept in memory only — the
   * ledger remains the record for those, and duplicating them into the file
   * would make it impossible to tell a standing policy entry from a one-off
   * call outcome.
   */
  addRuntimeKeys(keys: string[]): void {
    for (const k of keys) this.keys.add(k);
  }

  matches(companyName: string): boolean {
    const key = nameKey(companyName);
    if (this.keys.has(key)) return true;

    // Substring guard: catches "Northgate Roofing" against a suppressed
    // "Northgate Roofing and Sheet Metal", which the normalised key misses.
    if (key.length >= 6) {
      for (const suppressed of this.keys) {
        if (suppressed.length >= 6 && (suppressed.includes(key) || key.includes(suppressed))) {
          return true;
        }
      }
    }
    return false;
  }

  filter(leads: ScoredLead[]): { kept: ScoredLead[]; removed: ScoredLead[] } {
    const kept: ScoredLead[] = [];
    const removed: ScoredLead[] = [];
    for (const lead of leads) {
      (this.matches(lead.companyName) ? removed : kept).push(lead);
    }
    return { kept, removed };
  }

  add(companyName: string, reason: string): void {
    if (this.matches(companyName)) return;
    this.entries.push({ companyName, reason, addedAt: new Date().toISOString() });
    this.reindex();
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.entries, null, 2), 'utf8');
  }

  get count(): number {
    return this.entries.length;
  }
}
