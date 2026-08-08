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
import { scoreLead, withinSpec, mergeDuplicates, selectBatch, isCoreArea } from './lib/score.mts';
import { History } from './lib/history.mts';
import { Suppression } from './lib/suppression.mts';
import { writeBatch } from './lib/output.mts';
import type { RawLead, ScoredLead } from './types.mts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_PATH = join(root, 'data', 'history.json');
const SUPPRESSION_PATH = join(root, 'data', 'suppression.json');
const OUT_DIR = join(root, 'out');

const args = process.argv.slice(2);
const only = args.includes('--source')
  ? args[args.indexOf('--source') + 1]
  : undefined;
const dry = args.includes('--dry');
/** Runs the full pipeline on invented sample leads — no network required. */
const demo = args.includes('--demo');
/**
 * Saves every raw payload to debug/ and prints a diagnosis per source.
 * Implies --dry: inspection must never be able to write a sendable batch.
 */
const inspect = args.includes('--inspect');

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

    const debugDir = inspect ? join(root, 'debug') : undefined;

    for (const source of active) {
      try {
        const result = await source.fetch({ debugDir });
        raw.push(...result.leads);

        console.log(`  ${source.label}: ${result.leads.length} raw`);

        // Diagnostics are the point of this whole exercise: they say whether
        // an empty result means blocked, JavaScript-rendered, or genuinely a
        // parser bug — three problems with three different fixes.
        for (const d of result.diagnostics) {
          const mark = d.ok ? 'ok' : '!!';
          console.log(`    [${mark}] ${d.note}`);
          if (d.bytes !== undefined) console.log(`         ${d.bytes} bytes received`);
          if (d.sampleFields?.length) {
            console.log(`         fields present: ${d.sampleFields.join(', ')}`);
          }
          for (const hint of d.hints) console.log(`         -> ${hint}`);
          if (d.rawPath) console.log(`         raw saved: ${d.rawPath}`);
        }
      } catch (err) {
        // A dead source must not take the batch down with it — the others
        // still produce a usable list, and a short batch beats no batch.
        console.warn(`  ${source.label}: FAILED — ${(err as Error).message}`);
      }
    }
  }

  if (inspect) {
    console.log('\n--inspect: nothing written. Raw payloads are in debug/.');
    console.log('Send those files plus this output and the parsers can be fixed directly.');
    return;
  }

  if (raw.length === 0) {
    console.error('\nNo leads from any source. Nothing written.');
    process.exit(1);
  }

  // Suppression is applied before the history filter, so a company that asked
  // not to be contacted is removed even if it has never been sent.
  const suppression = new Suppression(SUPPRESSION_PATH);
  suppression.addRuntimeKeys(history.doNotContactKeys());

  const inSpec = raw.filter(withinSpec);
  const scored: ScoredLead[] = inSpec.map(scoreLead);
  const merged = mergeDuplicates(scored);
  const { kept, removed } = suppression.filter(merged);
  const fresh = history.filterUnseen(kept);
  const batch = selectBatch(fresh, config.batchSize, config.maxOutsideCorePerBatch);

  console.log('');
  console.log(`  ${raw.length} raw`);
  console.log(`  ${inSpec.length} with a trigger still inside its freshness window`);
  console.log(`  ${merged.length} after merging duplicate companies`);
  console.log(`  ${kept.length} after do-not-contact suppression (${removed.length} removed)`);
  console.log(`  ${fresh.length} never sent before`);
  console.log(`  ${batch.length} in this batch`);
  const outside = batch.filter((l) => !isCoreArea(l.city));
  if (outside.length > 0) {
    console.log(
      `    (${outside.length} from outside the GTA: ${outside.map((l) => l.city ?? '?').join(', ')})`,
    );
  }

  if (removed.length > 0) {
    console.log(`\n  Suppressed: ${removed.map((l) => l.companyName).join(', ')}`);
  }

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
