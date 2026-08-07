import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoredLead } from '../types.mts';
import { History } from './history.mts';

/** RFC 4180 quoting. Company names contain commas and quotes constantly. */
function csvCell(value: string | number | undefined): string {
  const s = value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The call sheet.
 *
 * Column order is deliberately the order a caller works left to right: who to
 * call, how to reach them, what to say, then the three outcome columns they
 * fill in. The outcome columns ship empty on purpose — they are the feedback
 * loop, and a column that is already there gets filled in far more often than
 * one that has to be added.
 */
export function toCsv(leads: ScoredLead[]): string {
  const headers = [
    'Company',
    'City',
    'Phone',
    'Contact',
    'Title',
    'Website',
    'Pitch this course',
    'Why call them now',
    'Verify at',
    'Called? (y/n)',
    'Interested? (y/n)',
    'Booked? (y/n)',
  ];

  const rows = leads.map((l) =>
    [
      l.companyName,
      l.city ?? '',
      l.phone ?? '',
      l.contactName ?? '',
      l.contactTitle ?? '',
      l.website ?? '',
      l.suggestedCourse ?? 'general safety training',
      l.trigger.detail,
      l.trigger.sourceUrl ?? '',
      '',
      '',
      '',
    ]
      .map(csvCell)
      .join(','),
  );

  return [headers.join(','), ...rows].join('\n');
}

/** One-page summary that goes in the email body. */
export function toSummary(
  leads: ScoredLead[],
  batch: string,
  history: History,
): string {
  const stats = history.stats();
  const lines: string[] = [];

  lines.push(`# ${batch}`);
  lines.push('');
  lines.push(`${leads.length} leads, generated ${new Date().toISOString().slice(0, 10)}.`);
  lines.push('');
  lines.push(
    'Each lead below was picked because something happened recently that means they need training now — not because they matched a company size filter. The reason to call is in the sheet.',
  );
  lines.push('');

  const byCourse = new Map<string, number>();
  for (const l of leads) {
    const c = l.suggestedCourse ?? 'general';
    byCourse.set(c, (byCourse.get(c) ?? 0) + 1);
  }

  lines.push('## What is in this batch');
  lines.push('');
  for (const [course, n] of [...byCourse].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${n} x ${course}`);
  }
  lines.push('');

  lines.push('## The list');
  lines.push('');
  leads.forEach((l, i) => {
    lines.push(
      `${i + 1}. **${l.companyName}**${l.city ? ` — ${l.city}` : ''} — ${l.trigger.detail}`,
    );
  });
  lines.push('');

  lines.push('## Please fill in the last three columns');
  lines.push('');
  lines.push(
    'Called / Interested / Booked. It takes two minutes and it is what lets the next batch be better than this one.',
  );
  lines.push('');
  lines.push(
    `Running total: ${stats.sent} leads sent, ${stats.called} called, ${stats.interested} interested, ${stats.booked} booked.`,
  );

  return lines.join('\n');
}

export function writeBatch(
  leads: ScoredLead[],
  batch: string,
  outDir: string,
  history: History,
): { csvPath: string; summaryPath: string } {
  mkdirSync(outDir, { recursive: true });
  const csvPath = join(outDir, `${batch}.csv`);
  const summaryPath = join(outDir, `${batch}.md`);
  writeFileSync(csvPath, toCsv(leads), 'utf8');
  writeFileSync(summaryPath, toSummary(leads, batch, history), 'utf8');
  return { csvPath, summaryPath };
}
