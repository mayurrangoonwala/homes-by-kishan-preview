// Run: node --experimental-strip-types --test test/
//
// Two different kinds of test live here, and the distinction matters.
//
// The PIPELINE tests verify logic that is entirely ours — scoring, recency
// decay, service-area filtering, duplicate merging, the never-send-twice
// ledger, CSV quoting. This is the part with commercial consequences if it is
// wrong, and it is fully verified.
//
// The PARSER tests pin the behaviour of the source scrapers against sample
// text. They prove the parsers do something sensible with input of the
// expected shape. They do NOT prove the live pages have that shape — this was
// written in a sandbox with no access to ontario.ca, jobbank.gc.ca or the
// Toronto CKAN API. Expect to recalibrate on first live run.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scoreLead, withinSpec, mergeDuplicates, leadKey, courseFromText } from '../src/lib/score.mts';
import { History } from '../src/lib/history.mts';
import { toCsv } from '../src/lib/output.mts';
import { Suppression } from '../src/lib/suppression.mts';
import { parseBulletin } from '../src/sources/molConvictions.mts';
import { parsePermitRows } from '../src/sources/ckanPermits.mts';
import type { RawLead } from '../src/types.mts';

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

function lead(over: Partial<RawLead> = {}): RawLead {
  return {
    source: 'test',
    companyName: 'Acme Fabrication Inc.',
    city: 'Hamilton',
    trigger: {
      kind: 'hiring',
      detail: 'Hiring forklift operators',
      date: daysAgo(3),
    },
    ...over,
  };
}

describe('lead identity', () => {
  test('ignores legal suffixes and punctuation', () => {
    assert.equal(
      leadKey('Acme Fabrication Inc.', 'Hamilton'),
      leadKey('ACME Fabrication Limited', 'hamilton'),
    );
  });

  test('same name in a different city is a different lead', () => {
    assert.notEqual(
      leadKey('Acme Fabrication', 'Hamilton'),
      leadKey('Acme Fabrication', 'Toronto'),
    );
  });
});

describe('course matching', () => {
  test('maps specific equipment language to the right course', () => {
    assert.equal(courseFromText('must hold a valid forklift licence'), 'forklift-operator');
    assert.equal(courseFromText('experience with fall arrest systems'), 'working-at-heights');
    assert.equal(courseFromText('WHMIS 2015 required'), 'whmis');
    assert.equal(courseFromText('confined space entry permits'), 'confined-space');
  });

  test('specific patterns win over the generic safety catch-all', () => {
    // Contains both "health and safety" and "forklift" — forklift is the
    // actionable pitch, so it must win.
    assert.equal(
      courseFromText('health and safety focus, forklift certification an asset'),
      'forklift-operator',
    );
  });

  test('returns undefined when nothing matches', () => {
    assert.equal(courseFromText('seeking a graphic designer'), undefined);
  });
});

describe('scoring', () => {
  test('enforcement outranks hiring outranks permits', () => {
    const enforcement = scoreLead(
      lead({ trigger: { kind: 'mol-enforcement', detail: 'x', date: daysAgo(1) } }),
    );
    const hiring = scoreLead(
      lead({ trigger: { kind: 'hiring', detail: 'x', date: daysAgo(1) } }),
    );
    const permit = scoreLead(
      lead({ trigger: { kind: 'construction-permit', detail: 'x', date: daysAgo(1) } }),
    );

    assert.ok(enforcement.score > hiring.score);
    assert.ok(hiring.score > permit.score);
  });

  test('recent triggers outscore old ones of the same kind', () => {
    const fresh = scoreLead(lead({ trigger: { kind: 'hiring', detail: 'x', date: daysAgo(2) } }));
    const stale = scoreLead(lead({ trigger: { kind: 'hiring', detail: 'x', date: daysAgo(45) } }));
    assert.ok(fresh.score > stale.score);
  });

  test('contact details raise the score', () => {
    const bare = scoreLead(lead());
    const rich = scoreLead(lead({ phone: '905-555-0100', contactName: 'Dana Singh' }));
    assert.ok(rich.score > bare.score);
  });
});

describe('spec filtering', () => {
  test('drops leads outside the service area', () => {
    assert.equal(withinSpec(lead({ city: 'Thunder Bay' })), false);
    assert.equal(withinSpec(lead({ city: 'Mississauga' })), true);
  });

  test('keeps leads with unknown city', () => {
    assert.equal(withinSpec(lead({ city: undefined })), true);
  });

  test('drops triggers past the staleness window', () => {
    assert.equal(
      withinSpec(lead({ trigger: { kind: 'hiring', detail: 'x', date: daysAgo(90) } })),
      false,
    );
  });
});

describe('duplicate merging', () => {
  test('one company from two sources becomes one stronger lead', () => {
    const a = scoreLead(
      lead({
        source: 'mol-convictions',
        trigger: { kind: 'mol-enforcement', detail: 'Fined $50,000', date: daysAgo(5) },
      }),
    );
    const b = scoreLead(
      lead({
        source: 'jobbank',
        companyName: 'Acme Fabrication Limited', // same company, different suffix
        phone: '905-555-0100',
        trigger: { kind: 'hiring', detail: 'Hiring welders', date: daysAgo(2) },
      }),
    );

    const merged = mergeDuplicates([a, b]);

    assert.equal(merged.length, 1, 'should collapse to a single lead');
    assert.ok(merged[0].score > Math.max(a.score, b.score), 'two signals beat one');
    assert.equal(merged[0].phone, '905-555-0100', 'contact details are merged in');
    assert.ok(merged[0].reasons.some((r) => r.includes('multi-source')));
  });

  test('output is sorted by score, highest first', () => {
    const weak = scoreLead(
      lead({
        companyName: 'Weak Co',
        trigger: { kind: 'new-business', detail: 'x', date: daysAgo(30) },
      }),
    );
    const strong = scoreLead(
      lead({
        companyName: 'Strong Co',
        trigger: { kind: 'mol-enforcement', detail: 'x', date: daysAgo(1) },
      }),
    );
    const merged = mergeDuplicates([weak, strong]);
    assert.equal(merged[0].companyName, 'Strong Co');
  });
});

describe('never send the same company twice', () => {
  test('filters companies already in the ledger, across batches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'syon-'));
    try {
      const path = join(dir, 'history.json');
      const first = new History(path);

      const batch1 = [scoreLead(lead({ companyName: 'Acme Fabrication Inc.' }))];
      assert.equal(first.filterUnseen(batch1).length, 1);

      first.record(batch1, 'Syon-leads-002');
      first.save();

      // Reload from disk — the ledger must survive a restart.
      const reloaded = new History(path);
      const batch2 = [
        scoreLead(lead({ companyName: 'ACME Fabrication Ltd' })), // same company
        scoreLead(lead({ companyName: 'Brand New Co' })),
      ];

      const unseen = reloaded.filterUnseen(batch2);
      assert.equal(unseen.length, 1, 'the repeat must be filtered out');
      assert.equal(unseen[0].companyName, 'Brand New Co');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tracks call outcomes for the value conversation later', () => {
    const dir = mkdtempSync(join(tmpdir(), 'syon-'));
    try {
      const path = join(dir, 'history.json');
      const h = new History(path);
      h.record([scoreLead(lead())], 'Syon-leads-002');
      const stats = h.stats();
      assert.equal(stats.sent, 1);
      assert.equal(stats.booked, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('do-not-contact suppression', () => {
  function suppressionWith(
    entries: { companyName: string; reason: string }[],
  ): { s: Suppression; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'syon-sup-'));
    const path = join(dir, 'suppression.json');
    const s = new Suppression(path);
    for (const e of entries) s.add(e.companyName, e.reason);
    return { s, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test('removes a suppressed company from the batch', () => {
    const { s, cleanup } = suppressionWith([
      { companyName: 'Northgate Roofing Ltd.', reason: 'asked not to be called' },
    ]);
    try {
      const leads = [
        scoreLead(lead({ companyName: 'Northgate Roofing Ltd.' })),
        scoreLead(lead({ companyName: 'Vertex Construction' })),
      ];
      const { kept, removed } = s.filter(leads);
      assert.equal(removed.length, 1);
      assert.equal(kept.length, 1);
      assert.equal(kept[0].companyName, 'Vertex Construction');
    } finally {
      cleanup();
    }
  });

  test('matches across legal suffix differences', () => {
    const { s, cleanup } = suppressionWith([
      { companyName: 'Northgate Roofing Ltd.', reason: 'asked not to be called' },
    ]);
    try {
      assert.equal(s.matches('NORTHGATE Roofing Incorporated'), true);
    } finally {
      cleanup();
    }
  });

  test('suppression ignores city, unlike the sent-history ledger', () => {
    // A request not to be contacted applies to the company, not one site.
    const { s, cleanup } = suppressionWith([
      { companyName: 'Halton Cold Storage', reason: 'existing customer' },
    ]);
    try {
      const leads = [
        scoreLead(lead({ companyName: 'Halton Cold Storage', city: 'Milton' })),
        scoreLead(lead({ companyName: 'Halton Cold Storage', city: 'Toronto' })),
      ];
      assert.equal(s.filter(leads).kept.length, 0);
    } finally {
      cleanup();
    }
  });

  test('catches a longer trading name containing the suppressed one', () => {
    const { s, cleanup } = suppressionWith([
      { companyName: 'Northgate Roofing', reason: 'asked not to be called' },
    ]);
    try {
      assert.equal(s.matches('Northgate Roofing and Sheet Metal Ltd'), true);
    } finally {
      cleanup();
    }
  });

  test('does not suppress unrelated companies', () => {
    const { s, cleanup } = suppressionWith([
      { companyName: 'Northgate Roofing', reason: 'asked not to be called' },
    ]);
    try {
      assert.equal(s.matches('Southgate Plumbing'), false);
      assert.equal(s.matches('Vertex Construction Group'), false);
    } finally {
      cleanup();
    }
  });

  test('survives a reload from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'syon-sup-'));
    try {
      const path = join(dir, 'suppression.json');
      const first = new Suppression(path);
      first.add('Northgate Roofing Ltd.', 'asked not to be called');
      first.save();

      const reloaded = new Suppression(path);
      assert.equal(reloaded.count, 1);
      assert.equal(reloaded.matches('Northgate Roofing Inc'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('honours do-not-contact outcomes recorded in the ledger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'syon-sup-'));
    try {
      const s = new Suppression(join(dir, 'suppression.json'));
      const target = scoreLead(lead({ companyName: 'Northgate Roofing Ltd.' }));

      assert.equal(s.filter([target]).kept.length, 1, 'not suppressed yet');

      // Simulates History.doNotContactKeys() feeding the runtime set.
      s.addRuntimeKeys([target.key]);
      assert.equal(s.filter([target]).kept.length, 0, 'now suppressed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('adding the same company twice is a no-op', () => {
    const { s, cleanup } = suppressionWith([
      { companyName: 'Northgate Roofing Ltd.', reason: 'asked not to be called' },
      { companyName: 'NORTHGATE Roofing Limited', reason: 'duplicate' },
    ]);
    try {
      assert.equal(s.count, 1);
    } finally {
      cleanup();
    }
  });
});

describe('call sheet output', () => {
  test('escapes commas and quotes in company names', () => {
    const csv = toCsv([
      scoreLead(lead({ companyName: 'Smith, Jones & Co "Builders"' })),
    ]);
    const dataLine = csv.split('\n')[1];
    assert.ok(dataLine.startsWith('"Smith, Jones & Co ""Builders"""'));
  });

  test('ships the three feedback columns empty', () => {
    const csv = toCsv([scoreLead(lead())]);
    const [header, row] = csv.split('\n');
    assert.ok(header.endsWith('Called? (y/n),Interested? (y/n),Booked? (y/n)'));
    assert.ok(row.endsWith(',,,'), 'outcome columns must ship blank for filling in');
  });
});

describe('source parsers (shape-pinned, not live-verified)', () => {
  test('extracts company, fine and city from a conviction bulletin', () => {
    const bulletin =
      'Precision Metal Works Inc., a Mississauga-based company, was fined $75,000 ' +
      'on July 14, 2026 after a worker fell from a scaffold. ' +
      'Northgate Roofing Ltd. was convicted on July 2, 2026 under the OHSA following an incident involving fall arrest equipment.';

    const leads = parseBulletin(bulletin, 'https://example.invalid/bulletin');

    assert.equal(leads.length, 2);
    assert.equal(leads[0].companyName, 'Precision Metal Works Inc.');
    assert.ok(leads[0].trigger.detail.includes('$75,000'));
    assert.equal(leads[0].trigger.kind, 'mol-enforcement');
    assert.equal(leads[1].companyName, 'Northgate Roofing Ltd.');
    // "scaffold" and "fall arrest" both map to working at heights.
    assert.equal(leads[0].suggestedCourse, 'working-at-heights');
  });

  test('ignores bulletin text with no conviction language', () => {
    const leads = parseBulletin(
      'The Ministry published updated guidance for employers this month.',
      'https://example.invalid',
    );
    assert.equal(leads.length, 0);
  });

  test('keeps only height-relevant permits', () => {
    const rows = [
      { APPLICANT: 'Skyline Roofing Inc', WORK: 'Roof replacement', ISSUED_DATE: daysAgo(4) },
      { APPLICANT: 'Interior Fitouts Ltd', WORK: 'Interior alterations', ISSUED_DATE: daysAgo(4) },
      { APPLICANT: 'Vertex Construction', WORK: 'New Building', ISSUED_DATE: daysAgo(9) },
    ];

    const leads = parsePermitRows(rows);

    assert.equal(leads.length, 2, 'interior-only work is not a height lead');
    assert.deepEqual(
      leads.map((l) => l.companyName),
      ['Skyline Roofing Inc', 'Vertex Construction'],
    );
    assert.equal(leads[0].suggestedCourse, 'working-at-heights');
  });

  test('skips permit rows with no applicant', () => {
    assert.equal(parsePermitRows([{ WORK: 'Roof replacement' }]).length, 0);
  });
});
