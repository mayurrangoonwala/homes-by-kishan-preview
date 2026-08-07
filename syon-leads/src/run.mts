// Batch runner.
//
//   node --experimental-strip-types src/run.mts
//   node --experimental-strip-types src/run.mts --source jobbank --dry
//
// Pulls every enabled source, scores, merges duplicates, drops anything ever
// sent before, and writes the top N as a call sheet plus a summary.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sources } from './sources/index.mts';
import { config } from './config.mts';
import { scoreLead, withinSpec, mergeDuplicates } from './lib/score.mts';
import { History } from './lib/history.mts';
import { writeBatch } from './lib/output.mts';
import type { RawLead, ScoredLead } from './types.mts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_PATH = join(root, 'data', 'history.json');
const OUT_DIR = join(root, 'out');

const args = process.argv.slice(2);
const only = args.includes('--source')
  ? args[args.indexOf('--source') + 1]
  : undefined;
const dry = args.includes('--dry');
/** Runs the full pipeline on invented sample leads — no network required. */
const demo = args.includes('--demo');

/** Batch names continue the Syon-leads-00N series already in use with Sandeep. */
function nextBatchName(history: History): string {
  const n = Math.floor(history.count / config.batchSize) + 2;
  return `Syon-leads-${String(n).padStart(3, '0')}`;
}

async function main(): Promise<void> {
  const history = new History(demo ? join(root, 'out', 'demo-history.json') : HISTORY_PATH);
  const raw: RawLead[] = [];

  if (demo) {
    const { demoLeads } = await import('./fixtures/demo.mts');
    raw.push(...demoLeads);
    console.log(`DEMO MODE — ${raw.length} invented sample leads, no network calls.`);
    console.log('These are not real companies. Do not send this batch.\n');
  } else {
    const active = sources.filter((s) => !only || s.id === only);

    if (active.length === 0) {
      console.error(`No source matching "${only}". Known: ${sources.map((s) => s.id).join(', ')}`);
      process.exit(1);
    }

    console.log(`Sourcing leads from ${active.length} source(s)…\n`);

    for (const source of active) {
      try {
        const found = await source.fetch();
        raw.push(...found);
        console.log(`  ${source.label}: ${found.length} raw`);
      } catch (err) {
        // A dead source must not take the batch down with it — the others
        // still produce a usable list, and a short batch beats no batch.
        console.warn(`  ${source.label}: FAILED — ${(err as Error).message}`);
      }
    }
  }

  if (raw.length === 0) {
    console.error('\nNo leads from any source. Nothing written.');
    process.exit(1);
  }

  const inSpec = raw.filter(withinSpec);
  const scored: ScoredLead[] = inSpec.map(scoreLead);
  const merged = mergeDuplicates(scored);
  const fresh = history.filterUnseen(merged);
  const batch = fresh.slice(0, config.batchSize);

  console.log('');
  console.log(`  ${raw.length} raw`);
  console.log(`  ${inSpec.length} in service area and within ${config.maxTriggerAgeDays}d`);
  console.log(`  ${merged.length} after merging duplicate companies`);
  console.log(`  ${fresh.length} never sent before`);
  console.log(`  ${batch.length} in this batch`);

  if (batch.length < config.batchSize) {
    console.warn(
      `\n  Note: only ${batch.length} of ${config.batchSize}. Send the short batch — padding it with weak leads is how the list loses credibility.`,
    );
  }

  if (dry) {
    console.log('\n--dry: nothing written. Top candidates:\n');
    batch.forEach((l, i) => {
      console.log(`  ${i + 1}. [${l.score}] ${l.companyName} — ${l.trigger.detail}`);
      console.log(`      ${l.reasons.join(', ')}`);
    });
    return;
  }

  const name = nextBatchName(history);
  const { csvPath, summaryPath } = writeBatch(batch, name, OUT_DIR, history);
  history.record(batch, name);
  history.save();

  console.log(`\nWrote ${csvPath}`);
  console.log(`Wrote ${summaryPath}`);
  console.log(`History now holds ${history.count} sent leads.`);
}

await main();
