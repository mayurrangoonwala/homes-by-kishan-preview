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
import { classifyHtml, describeVerdict, describeHttpFailure } from '../src/lib/diagnose.mts';
import {
  parseBulletin,
  extractCompanyName,
  bulletinLinks,
} from '../src/sources/molConvictions.mts';
import {
  parsePermitRows,
  explainNoRows,
  looksLikeBusiness,
} from '../src/sources/ckanPermits.mts';
import { discoverFeeds, parseFeed, looksLikeFeed } from '../src/lib/feed.mts';
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

describe('fetch diagnosis', () => {
  test('recognises a JavaScript shell as unfixable by parsing', () => {
    const shell =
      '<html><head>' +
      '<script src="/a.js"></script><script src="/b.js"></script>' +
      '<script src="/c.js"></script><script src="/d.js"></script>' +
      '</head><body><div id="root"></div></body></html>' +
      // Padding so it is not classified as merely "empty".
      `<!--${'x'.repeat(2000)}-->`;

    assert.equal(classifyHtml(shell), 'js-shell');

    const d = describeVerdict('jobbank', 'js-shell', { bytes: shell.length, matched: 0 });
    assert.equal(d.ok, false);
    assert.ok(
      d.hints.some((h) => /data feed|open data|Network tab/i.test(h)),
      'must point at finding a data feed, not at fixing the parser',
    );
  });

  test('recognises a block page', () => {
    const blocked = `<html><body><h1>Access Denied</h1>${'p'.repeat(1000)}</body></html>`;
    assert.equal(classifyHtml(blocked), 'blocked');
    const d = describeVerdict('mol-convictions', 'blocked', { bytes: 1000, matched: 0 });
    assert.ok(d.note.includes('not a parser problem'));
  });

  test('real content with no matches is reported as a parser fix', () => {
    const d = describeVerdict('mol-convictions', 'content', { bytes: 50000, matched: 0 });
    assert.equal(d.ok, false);
    assert.ok(/parser fix/i.test(d.note));
  });

  test('real content with matches is a pass', () => {
    const d = describeVerdict('mol-convictions', 'content', { bytes: 50000, matched: 7 });
    assert.equal(d.ok, true);
    assert.equal(d.hints.length, 0);
  });

  test('a page of real prose is classified as content', () => {
    const prose = `<html><body><article>${'The Ministry of Labour reported that a company was fined. '.repeat(40)}</article></body></html>`;
    assert.equal(classifyHtml(prose), 'content');
  });
});

describe('CKAN schema reporting', () => {
  test('names the fields present when nothing parses', () => {
    const rows = [{ APPLICANT_FULL_NAME: 'Skyline Roofing', PROPOSED_WORK: 'Roof replacement' }];
    const d = explainNoRows('toronto-permits', rows);

    assert.equal(d.ok, false);
    assert.deepEqual(d.sampleFields, ['APPLICANT_FULL_NAME', 'PROPOSED_WORK']);
    assert.ok(
      d.hints.some((h) => h.includes('FIELD_CANDIDATES.applicant')),
      'must say exactly which list to add the real column name to',
    );
  });

  test('distinguishes an empty dataset from a mapping problem', () => {
    const d = explainNoRows('toronto-permits', []);
    assert.ok(/no records at all/i.test(d.note));
  });

  test('when columns are recognised, blames the height filter instead', () => {
    const rows = [{ APPLICANT: 'Interior Fitouts Ltd', WORK: 'Interior alterations' }];
    const d = explainNoRows('toronto-permits', rows);
    assert.ok(
      d.hints.some((h) => /HEIGHT_RELEVANT/.test(h)),
      'columns were found, so the filter is the remaining suspect',
    );
  });
});

describe('company-name extraction', () => {
  test('keeps a trailing full stop on the legal suffix', () => {
    assert.equal(
      extractCompanyName('Precision Metal Works Inc. was fined $75,000.'),
      'Precision Metal Works Inc.',
    );
  });

  test('does not truncate at a trade word before the legal suffix', () => {
    // The regression this guards: "Roofing" in the suffix list truncated the
    // name to "Northgate Roofing" and silently dropped the legal entity.
    assert.equal(
      extractCompanyName('Northgate Roofing Ltd. was convicted under the OHSA.'),
      'Northgate Roofing Ltd.',
    );
  });

  test('does not truncate Incorporated to Inc', () => {
    assert.equal(
      extractCompanyName('Vertex Fabrication Incorporated pleaded guilty.'),
      'Vertex Fabrication Incorporated',
    );
  });

  test('falls back to the pre-verb pattern when there is no legal suffix', () => {
    assert.equal(
      extractCompanyName('Skyline Contracting was fined after a fall.'),
      'Skyline Contracting',
    );
  });

  test('returns undefined rather than guessing', () => {
    assert.equal(extractCompanyName('a worker was injured on site'), undefined);
  });
});

describe('bulletin link following', () => {
  test('picks out conviction bulletin links and ignores the rest', () => {
    const html = `
      <a href="/page/court-bulletins-convictions-june-2026">June</a>
      <a href="/page/court-bulletin-may-2026">May</a>
      <a href="/page/about-ontario">About</a>
      <a href="https://twitter.com/ontario">Twitter</a>
    `;
    const links = bulletinLinks(html, 'https://www.ontario.ca/page/court-bulletins-convictions');

    assert.equal(links.length, 2);
    assert.ok(links.every((l) => /court-bulletin/.test(l)));
    assert.ok(links.every((l) => l.startsWith('https://www.ontario.ca')), 'links are absolute');
  });

  test('excludes the index page itself and anchors', () => {
    const base = 'https://www.ontario.ca/page/court-bulletins-convictions';
    const html = `<a href="${base}">self</a><a href="${base}#top">anchor</a>`;
    assert.equal(bulletinLinks(html, base).length, 0);
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

describe('HTTP failure diagnosis', () => {
  test('403 is reported as a refusal, not a moved page', () => {
    const d = describeHttpFailure('mol-convictions', 403, 'ontario.ca');
    assert.ok(/refused/i.test(d.note));
    assert.ok(d.hints.some((h) => /browser/i.test(h)));
    assert.ok(!d.hints.some((h) => /moved|renamed/i.test(h)));
  });

  test('404 is reported as moved', () => {
    const d = describeHttpFailure('mol-convictions', 404, 'ontario.ca');
    assert.ok(/moved or been renamed/i.test(d.note));
  });

  test('429 points at the throttle', () => {
    const d = describeHttpFailure('jobbank', 429, 'jobbank.gc.ca');
    assert.ok(d.hints.some((h) => /THROTTLE_MS/.test(h)));
  });

  test('5xx says there is nothing to fix locally', () => {
    const d = describeHttpFailure('jobbank', 503, 'jobbank.gc.ca');
    assert.ok(d.hints.some((h) => /nothing to fix/i.test(h)));
  });
});

describe('Toronto permits — against real rows from the live dataset', () => {
  // These rows are copied verbatim from the first live run's captured payload,
  // so the schema here is the real one rather than an assumption.
  const homeownerRow = {
    _id: 1,
    PERMIT_TYPE: 'Mechanical(MS)',
    STRUCTURE_TYPE: 'SFD - Detached',
    WORK: 'Building Permit Related(MS)',
    STREET_NAME: 'PLATEAU',
    APPLICATION_DATE: '2022-03-26',
    ISSUED_DATE: '2022-05-26',
    DESCRIPTION:
      'HVAC - Proposal to construct a new 2 storey single family dwelling and demolish the existing 2 storey single family dwelling',
    BUILDER_NAME: 'ABUZAFAR IQBAL A. QURESHI',
  };

  const contractorRow = {
    ...homeownerRow,
    _id: 2,
    BUILDER_NAME: 'SKYLINE ROOFING & EXTERIORS INC',
    ISSUED_DATE: daysAgo(5).slice(0, 10),
  };

  test('drops homeowners pulling permits on their own house', () => {
    const leads = parsePermitRows([homeownerRow]);
    assert.equal(leads.length, 0, 'a private individual is not a lead');
  });

  test('keeps contractors', () => {
    const leads = parsePermitRows([contractorRow]);
    assert.equal(leads.length, 1);
  });

  test('title-cases the shouted company name', () => {
    const leads = parsePermitRows([contractorRow]);
    assert.equal(leads[0].companyName, 'Skyline Roofing & Exteriors Inc');
  });

  test('matches on DESCRIPTION when WORK is a bare category', () => {
    // WORK here is "Building Permit Related(MS)", which says nothing about
    // height; the height signal is in DESCRIPTION.
    const leads = parsePermitRows([contractorRow]);
    assert.ok(
      /demolish|new 2 storey/i.test(leads[0].trigger.detail),
      'the reason to call should quote the useful description, not the category',
    );
  });

  test('carries the real issued date through, so staleness filtering works', () => {
    const leads = parsePermitRows([contractorRow]);
    assert.equal(withinSpec(leads[0]), true, 'a recent permit is in spec');

    const old = parsePermitRows([{ ...contractorRow, ISSUED_DATE: '2022-05-26' }]);
    assert.equal(withinSpec(old[0]), false, 'a 2022 permit must be filtered out');
  });

  test('business detection', () => {
    assert.equal(looksLikeBusiness('SKYLINE ROOFING INC'), true);
    assert.equal(looksLikeBusiness('VERTEX CONSTRUCTION'), true);
    assert.equal(looksLikeBusiness('SMITH & SONS'), true);
    assert.equal(looksLikeBusiness('ABUZAFAR IQBAL A. QURESHI'), false);
    assert.equal(looksLikeBusiness('JOHN SMITH'), false);
  });
});

describe('newsroom link following (news.ontario.ca)', () => {
  const base = 'https://news.ontario.ca/mlitsd/en';

  test('prefers releases whose slug shows enforcement', () => {
    const html = `
      <a href="/mlitsd/en/2026/08/company-fined-75000-after-worker-injured.html">A</a>
      <a href="/mlitsd/en/2026/08/ontario-investing-in-skills-training.html">B</a>
      <a href="/mlitsd/en/2026/07/roofing-firm-convicted-after-fall.html">C</a>
    `;
    const links = bulletinLinks(html, base);

    assert.equal(links.length, 2, 'the funding announcement is not followed');
    assert.ok(links.every((l) => /fined|convicted/.test(l)));
  });

  test('falls back to dated releases when no slug shows enforcement', () => {
    const html = `
      <a href="/mlitsd/en/2026/08/some-release.html">A</a>
      <a href="/mlitsd/en/about.html">About</a>
    `;
    const links = bulletinLinks(html, base);
    assert.equal(links.length, 1);
    assert.ok(links[0].includes('/2026/08/'));
  });

  test('stays on ontario.ca hosts', () => {
    const html = `
      <a href="https://twitter.com/ONgov/status/123-convicted">tweet</a>
      <a href="/mlitsd/en/2026/08/firm-fined.html">real</a>
    `;
    const links = bulletinLinks(html, base);
    assert.equal(links.length, 1);
    assert.ok(links[0].startsWith('https://news.ontario.ca'));
  });

  test('parses a conviction out of a real-shaped release headline', () => {
    const release =
      'Precision Metal Works Inc. was fined $75,000 on July 14, 2026 after a worker fell from a roof at a Mississauga construction project.';
    const leads = parseBulletin(release, `${base}/2026/07/x.html`);

    assert.equal(leads.length, 1);
    assert.equal(leads[0].companyName, 'Precision Metal Works Inc.');
    assert.equal(leads[0].suggestedCourse, 'working-at-heights');
    assert.ok(leads[0].trigger.detail.includes('$75,000'));
  });
});

describe('feed discovery and parsing', () => {
  test('finds the feed URL in a JavaScript shell head', () => {
    // This is the shape the newsroom actually returns: an empty body, but a
    // server-rendered head that still declares the feed.
    const shell = `<!DOCTYPE html><html><head>
      <link rel="stylesheet" href="/a.css">
      <link rel="alternate" type="application/rss+xml" title="News" href="/mlitsd/en/rss.xml">
    </head><body><div id="app"></div></body></html>`;

    const feeds = discoverFeeds(shell, 'https://news.ontario.ca/mlitsd/en');
    assert.deepEqual(feeds, ['https://news.ontario.ca/mlitsd/en/rss.xml']);
  });

  test('ignores stylesheets and non-feed alternates', () => {
    const html = `
      <link rel="alternate" hreflang="fr" href="/fr/page">
      <link rel="stylesheet" href="/a.css">`;
    assert.deepEqual(discoverFeeds(html, 'https://news.ontario.ca/'), []);
  });

  test('parses RSS items including CDATA titles', () => {
    const rss = `<?xml version="1.0"?><rss><channel>
      <item>
        <title><![CDATA[Roofing Company Fined $75,000 After Worker Falls]]></title>
        <link>https://news.ontario.ca/mlitsd/en/2026/08/a.html</link>
        <description>Northgate Roofing Ltd. was fined after a worker fell from a roof.</description>
        <pubDate>Mon, 03 Aug 2026 14:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Ontario Investing in Skills Training</title>
        <link>https://news.ontario.ca/mlitsd/en/2026/08/b.html</link>
        <description>A funding announcement.</description>
        <pubDate>Tue, 04 Aug 2026 09:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;

    const items = parseFeed(rss);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'Roofing Company Fined $75,000 After Worker Falls');
    assert.ok(items[0].description?.includes('Northgate Roofing'));
    assert.equal(items[0].link, 'https://news.ontario.ca/mlitsd/en/2026/08/a.html');
  });

  test('parses Atom entries with href-attribute links', () => {
    const atom = `<feed>
      <entry>
        <title>Firm Convicted After Fall</title>
        <link rel="alternate" href="https://news.ontario.ca/x.html"/>
        <summary>Vertex Construction Group pleaded guilty.</summary>
        <published>2026-08-01T10:00:00Z</published>
      </entry>
    </feed>`;

    const items = parseFeed(atom);
    assert.equal(items.length, 1);
    assert.equal(items[0].link, 'https://news.ontario.ca/x.html');
    assert.ok(items[0].description?.includes('Vertex'));
  });

  test('only the enforcement item yields a lead', () => {
    // The funding announcement must produce nothing — this is what stops the
    // feed strategy filling a batch with press releases.
    const enforcement = parseBulletin(
      'Northgate Roofing Ltd. was fined $75,000 after a worker fell from a roof.',
      'https://news.ontario.ca/x',
    );
    const funding = parseBulletin(
      'Ontario Investing in Skills Training. The government announced new funding.',
      'https://news.ontario.ca/y',
    );

    assert.equal(enforcement.length, 1);
    assert.equal(enforcement[0].suggestedCourse, 'working-at-heights');
    assert.equal(funding.length, 0);
  });

  test('recognises a feed body regardless of content type', () => {
    assert.equal(looksLikeFeed('<?xml version="1.0"?><rss>', ''), true);
    assert.equal(looksLikeFeed('<!DOCTYPE html><html>', 'text/html'), false);
  });
});
