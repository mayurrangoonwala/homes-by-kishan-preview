// Run: node --experimental-strip-types --test test/
//
// Two different kinds of test live here, and the distinction matters.
//
// The PIPELINE tests verify logic that is entirely ours — scoring, recency
// decay, service-area filtering, duplicate merging, the never-send-twice
// ledger, CSV quoting. This is the part with commercial consequences if it is
// wrong, and it is fully verified.
//
// The PARSER tests pin the behaviour of the source scrapers. Most now use
// fixtures copied verbatim from live captures — Job Bank article markup,
// Toronto permit rows, WSIB conviction text — so they test the real shapes
// rather than assumed ones. The exception is the Ontario newsroom, which is a
// JavaScript application whose data endpoint has not been found; those tests
// pin intent rather than verified behaviour.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scoreLead,
  withinSpec,
  mergeDuplicates,
  leadKey,
  courseFromText,
  looksHardToReach,
} from '../src/lib/score.mts';
import { travelBonus, weights, enabledSources } from '../src/config.mts';
import { ALL_TRIGGER_KINDS } from '../src/types.mts';
import { sources } from '../src/sources/index.mts';
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
  cleanDescription,
  recentPermitsSql,
} from '../src/sources/ckanPermits.mts';
import { parseResults, parseLocation } from '../src/sources/jobbank.mts';
import { discoverFeeds, parseFeed, looksLikeFeed } from '../src/lib/feed.mts';
import { extractReleases, candidateEndpoints } from '../src/lib/newsApi.mts';
import {
  bundleUrls,
  extractApiCandidates,
  parseRobots,
  isAllowed,
  parseSitemapLocs,
  extractInlineState,
} from '../src/lib/spaRescue.mts';
import {
  wsibConvictionLinks,
  isEmployerConviction,
  filterToEmployers,
} from '../src/sources/wsibConvictions.mts';
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
  // Raj travels anywhere in Ontario to sign a client, so location must never
  // disqualify a lead — an earlier version hard-filtered to twelve GTA cities
  // and silently threw away business from the rest of the province.
  test('keeps leads regardless of how far away they are', () => {
    assert.equal(withinSpec(lead({ city: 'Thunder Bay' })), true);
    assert.equal(withinSpec(lead({ city: 'Mississauga' })), true);
    assert.equal(withinSpec(lead({ city: undefined })), true);
  });

  test('drops triggers past the staleness window', () => {
    assert.equal(
      withinSpec(lead({ trigger: { kind: 'hiring', detail: 'x', date: daysAgo(90) } })),
      false,
    );
  });
});

describe('travel distance ranks, it does not filter', () => {
  test('home turf outranks the Golden Horseshoe outranks the rest', () => {
    assert.ok(travelBonus('Mississauga') > travelBonus('Hamilton'));
    assert.ok(travelBonus('Hamilton') > travelBonus('Thunder Bay'));
  });

  test('is case and whitespace insensitive', () => {
    assert.equal(travelBonus('  mississauga '), travelBonus('Mississauga'));
  });

  test('an unknown city is assumed mid-range rather than penalised', () => {
    assert.ok(travelBonus(undefined) > travelBonus('Thunder Bay'));
  });

  test('a nearer lead outscores an identical far one', () => {
    const near = scoreLead(lead({ city: 'Mississauga' }));
    const far = scoreLead(lead({ city: 'Thunder Bay' }));
    assert.ok(near.score > far.score);
    assert.ok(near.reasons.some((r) => r.includes('near home base')));
  });

  test('but a strong far lead still beats a weak near one', () => {
    // The whole point: a Sudbury company that was just fined is worth the
    // drive; a Mississauga permit is not more valuable just for being close.
    const farStrong = scoreLead(
      lead({
        city: 'Sudbury',
        trigger: { kind: 'mol-enforcement', detail: 'Fined $75,000', date: daysAgo(2) },
      }),
    );
    const nearWeak = scoreLead(
      lead({
        city: 'Mississauga',
        trigger: { kind: 'construction-permit', detail: 'Permit', date: daysAgo(30) },
      }),
    );
    assert.ok(farStrong.score > nearWeak.score);
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
    assert.ok(merged[0].reasons.some((r) => r.includes('corroborated by 2 sources')));
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

describe('merging distinguishes corroboration from volume', () => {
  function permitLead(detail: string) {
    return scoreLead(
      lead({
        source: 'toronto-permits',
        companyName: 'Yorkwind Holdings Inc',
        city: 'Toronto',
        trigger: { kind: 'construction-permit', detail, date: daysAgo(10) },
      }),
    );
  }

  test('six permits from ONE source do not read as six sources', () => {
    // The regression: a flat +20 per duplicate labelled "multi-source" let a
    // single busy builder accumulate +100 from one data source.
    const merged = mergeDuplicates([
      permitLead('permit A'), permitLead('permit B'), permitLead('permit C'),
      permitLead('permit D'), permitLead('permit E'), permitLead('permit F'),
    ]);

    assert.equal(merged.length, 1);
    assert.ok(
      !merged[0].reasons.some((r) => /corroborated/.test(r)),
      'one source is not corroboration',
    );
    assert.ok(merged[0].reasons.some((r) => /6 separate records/.test(r)));

    const single = permitLead('permit A');
    assert.ok(
      merged[0].score - single.score <= 18,
      'repeat bonus must saturate rather than scale linearly',
    );
  });

  test('two different sources DO count as corroboration', () => {
    const merged = mergeDuplicates([
      scoreLead(lead({ source: 'toronto-permits', companyName: 'Acme Ltd', city: 'Toronto' })),
      scoreLead(lead({ source: 'mol-convictions', companyName: 'Acme Limited', city: 'Toronto',
        trigger: { kind: 'mol-enforcement', detail: 'Fined', date: daysAgo(3) } })),
    ]);

    assert.equal(merged.length, 1);
    assert.ok(merged[0].reasons.some((r) => /corroborated by 2 sources/.test(r)));
  });

  test('cross-source corroboration outweighs repeat volume', () => {
    const volume = mergeDuplicates([
      permitLead('a'), permitLead('b'), permitLead('c'), permitLead('d'),
    ])[0];

    const corroborated = mergeDuplicates([
      scoreLead(lead({ source: 'toronto-permits', companyName: 'Beta Ltd', city: 'Toronto',
        trigger: { kind: 'construction-permit', detail: 'x', date: daysAgo(10) } })),
      scoreLead(lead({ source: 'jobbank', companyName: 'Beta Ltd', city: 'Toronto',
        trigger: { kind: 'construction-permit', detail: 'y', date: daysAgo(10) } })),
    ])[0];

    assert.ok(corroborated.score > volume.score);
  });

  test('the strongest trigger becomes the headline reason to call', () => {
    const merged = mergeDuplicates([
      scoreLead(lead({ source: 'toronto-permits', companyName: 'Acme Ltd',
        trigger: { kind: 'construction-permit', detail: 'a permit', date: daysAgo(40) } })),
      scoreLead(lead({ source: 'mol-convictions', companyName: 'Acme Ltd',
        trigger: { kind: 'mol-enforcement', detail: 'Fined $75,000', date: daysAgo(2) } })),
    ]);
    assert.equal(merged[0].trigger.detail, 'Fined $75,000');
  });

  test('extra records are summarised, not dumped', () => {
    const merged = mergeDuplicates([
      permitLead('a'), permitLead('b'), permitLead('c'), permitLead('d'), permitLead('e'),
    ]);
    const alsos = merged[0].reasons.filter((r) => r.startsWith('also:'));
    assert.equal(alsos.length, 2, 'two examples is enough context for a caller');
    assert.ok(merged[0].reasons.some((r) => /and 2 more/.test(r)));
  });
});

describe('permit description cleanup', () => {
  test('strips the trade prefix that makes one project look like many', () => {
    assert.equal(
      cleanDescription('HVAC - Proposal to demolish existing dwelling and construct a fourplex'),
      'demolish existing dwelling and construct a fourplex',
    );
    assert.equal(
      cleanDescription('Plumbing  - Proposal to construct a new 5 storey condominium'),
      'construct a new 5 storey condominium',
    );
  });

  test('leaves an already-clean description alone', () => {
    assert.equal(cleanDescription('Roof replacement'), 'Roof replacement');
  });
});

describe('newsroom JSON API', () => {
  test('extracts releases from a root-level array', () => {
    const out = extractReleases([
      { title: 'Firm Fined $75,000', url: '/a', publishedAt: '2026-08-01' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Firm Fined $75,000');
  });

  test('handles the common wrapper keys', () => {
    for (const key of ['results', 'data', 'items', 'releases']) {
      const out = extractReleases({ [key]: [{ title: 'X' }] });
      assert.equal(out.length, 1, `should unwrap ${key}`);
    }
  });

  test('handles one level of nesting', () => {
    const out = extractReleases({ data: { results: [{ title: 'Nested' }] } });
    assert.equal(out[0].title, 'Nested');
  });

  test('accepts alternative field names', () => {
    const out = extractReleases([
      { headline: 'H', excerpt: 'E', permalink: '/p', releaseDate: '2026-08-01' },
    ]);
    assert.equal(out[0].title, 'H');
    assert.equal(out[0].summary, 'E');
    assert.equal(out[0].url, '/p');
    assert.equal(out[0].published, '2026-08-01');
  });

  test('skips rows with nothing title-shaped rather than inventing one', () => {
    assert.equal(extractReleases([{ id: 1, body: 'no title here' }]).length, 0);
  });

  test('survives junk without throwing', () => {
    assert.deepEqual(extractReleases(null), []);
    assert.deepEqual(extractReleases('a string'), []);
    assert.deepEqual(extractReleases({ unrelated: 5 }), []);
  });

  test('candidate endpoints carry the convictions type filter', () => {
    const urls = candidateEndpoints();
    assert.ok(urls.length >= 3);
    assert.ok(urls.every((u) => u.includes('types=2007')));
    assert.ok(urls.every((u) => u.startsWith('https://news.ontario.ca')));
  });
});

describe('WSIB convictions', () => {
  test('scores below an OHSA conviction', () => {
    // A WSIB prosecution proves a compliance gap; an OHSA conviction usually
    // means someone got hurt. Conflating them would put the weaker signal at
    // the top of the call sheet.
    const wsib = scoreLead(
      lead({ trigger: { kind: 'wsib-enforcement', detail: 'x', date: daysAgo(2) } }),
    );
    const mol = scoreLead(
      lead({ trigger: { kind: 'mol-enforcement', detail: 'x', date: daysAgo(2) } }),
    );
    const hiring = scoreLead(
      lead({ trigger: { kind: 'hiring', detail: 'x', date: daysAgo(2) } }),
    );

    assert.ok(mol.score > wsib.score, 'OHSA outranks WSIB');
    assert.ok(wsib.score > hiring.score, 'but WSIB still outranks a job posting');
  });

  test('parses with WSIB framing rather than OHSA framing', () => {
    const leads = parseBulletin(
      'Northgate Roofing Ltd. was fined $12,000 for failing to register with the WSIB.',
      'https://www.wsib.ca/en/convictions',
      {
        source: 'wsib-convictions',
        kind: 'wsib-enforcement',
        rationale: 'just penalised for a compliance failure',
      },
    );

    assert.equal(leads.length, 1);
    assert.equal(leads[0].source, 'wsib-convictions');
    assert.equal(leads[0].trigger.kind, 'wsib-enforcement');
    assert.ok(leads[0].trigger.detail.includes('$12,000'));
    assert.ok(
      !leads[0].trigger.detail.includes('OHSA'),
      'must not claim an OHSA conviction it does not have evidence of',
    );
  });

  test('the Ministry source keeps its own framing by default', () => {
    const leads = parseBulletin(
      'Vertex Construction Group was fined $75,000 after a worker fell.',
      'https://news.ontario.ca/x',
    );
    assert.equal(leads[0].source, 'mol-convictions');
    assert.equal(leads[0].trigger.kind, 'mol-enforcement');
  });

  test('only follows conviction links on the WSIB domain', () => {
    const html = `
      <a href="/en/convictions/company-fined-2026">A</a>
      <a href="/en/about-us">B</a>
      <a href="https://twitter.com/wsib/convictions">C</a>
    `;
    const links = wsibConvictionLinks(html, 'https://www.wsib.ca/en/convictions');
    assert.equal(links.length, 1);
    assert.ok(links[0].startsWith('https://www.wsib.ca'));
  });
});

describe('single-purpose entities are down-ranked, not dropped', () => {
  test('recognises numbered Ontario corporations', () => {
    assert.equal(looksHardToReach('2650192 Ontario Inc'), true);
    assert.equal(looksHardToReach('001572247 Ontario Limited'), true);
  });

  test('recognises address-named entities', () => {
    assert.equal(looksHardToReach('181b Poplar Plains Road Inc'), true);
    assert.equal(looksHardToReach('108 Clovelly Avenue Inc'), true);
  });

  test('leaves real trading names alone', () => {
    assert.equal(looksHardToReach('Greenbilt Homes Ltd'), false);
    assert.equal(looksHardToReach('Scottsdale Contracting Inc'), false);
    assert.equal(looksHardToReach('Nicks Developments Inc'), false);
    assert.equal(looksHardToReach('Yorkwind Holdings Inc'), false);
  });

  test('a contactable company outranks an identical shell', () => {
    const real = scoreLead(lead({ companyName: 'Scottsdale Contracting Inc' }));
    const shell = scoreLead(lead({ companyName: '2650192 Ontario Inc' }));
    assert.ok(real.score > shell.score);
    assert.ok(shell.reasons.some((r) => /single-purpose entity/.test(r)));
  });

  test('but a shell with a fresh conviction still beats a stale real company', () => {
    // Down-ranked, not disqualified: the name is still a thread to pull.
    const shellStrong = scoreLead(
      lead({
        companyName: '2650192 Ontario Inc',
        trigger: { kind: 'mol-enforcement', detail: 'Fined', date: daysAgo(1) },
      }),
    );
    const realWeak = scoreLead(
      lead({
        companyName: 'Scottsdale Contracting Inc',
        trigger: { kind: 'construction-permit', detail: 'Permit', date: daysAgo(50) },
      }),
    );
    assert.ok(shellStrong.score > realWeak.score);
  });
});

describe('permit query asks for recent permits explicitly', () => {
  test('filters and orders on the date, not on insertion order', () => {
    const sql = recentPermitsSql('abc-123', '2026-05-01');
    assert.ok(sql.includes('FROM "abc-123"'));
    assert.ok(sql.includes("COALESCE(\"ISSUED_DATE\", \"APPLICATION_DATE\") >= '2026-05-01'"));
    assert.ok(/ORDER BY COALESCE.*DESC/.test(sql));
  });

  test('COALESCE lets an unissued permit qualify on its application date', () => {
    // Sorting on ISSUED_DATE alone put NULLs first; sorting on _id returned
    // year-old backfills. Both produced zero usable leads on live runs.
    const sql = recentPermitsSql('abc-123', '2026-05-01');
    assert.ok(sql.includes('COALESCE'), 'must not depend on ISSUED_DATE alone');
  });
});

describe('WSIB filters out personal convictions', () => {
  test('drops individual benefit fraud', () => {
    assert.equal(
      isEmployerConviction(
        'pleaded guilty to knowingly making a false or misleading statement to the WSIB in connection with his claim for benefits',
      ),
      false,
    );
  });

  test('keeps employer registration and payroll offences', () => {
    assert.equal(isEmployerConviction('failing to register with the WSIB as an employer'), true);
    assert.equal(isEmployerConviction('understating payroll to reduce premiums'), true);
  });

  test('a person named in a conviction never reaches the call sheet', () => {
    // Two gates: the offence text, and whether the name looks like a business.
    const leads = filterToEmployers([
      {
        source: 'wsib-convictions',
        companyName: 'Mahmoud Mohamed El Hacene',
        trigger: {
          kind: 'wsib-enforcement',
          detail: 'Fined $5,000 — false statement in connection with his claim for benefits',
          date: daysAgo(10),
        },
      },
      {
        source: 'wsib-convictions',
        companyName: 'Northgate Roofing Ltd.',
        trigger: {
          kind: 'wsib-enforcement',
          detail: 'Fined $12,000 — failing to register as an employer',
          date: daysAgo(10),
        },
      },
    ]);

    assert.equal(leads.length, 1);
    assert.equal(leads[0].companyName, 'Northgate Roofing Ltd.');
  });
});

describe('freshness windows differ by trigger kind', () => {
  test('a conviction outlives a job posting', () => {
    const oldConviction = lead({
      trigger: { kind: 'wsib-enforcement', detail: 'x', date: daysAgo(70) },
    });
    const oldPosting = lead({
      trigger: { kind: 'hiring', detail: 'x', date: daysAgo(70) },
    });

    // A flat 60-day window binned every WSIB conviction on the live run,
    // because regulators publish monthly and the batch was already 65 days old.
    assert.equal(withinSpec(oldConviction), true);
    assert.equal(withinSpec(oldPosting), false);
  });

  test('everything eventually goes stale', () => {
    assert.equal(
      withinSpec(lead({ trigger: { kind: 'mol-enforcement', detail: 'x', date: daysAgo(200) } })),
      false,
    );
  });
});

describe('Job Bank parsing, against the real markup', () => {
  // Copied from the live capture, trimmed of the sign-in modal.
  const article = (id: string, title: string, biz: string, loc: string, date: string) =>
    `<article id="article-${id}" class="action-buttons">` +
    `<a href="/jobsearch/jobposting/${id};jsessionid=E42.jobsearch76?source=searchresults" class="resultJobItem">` +
    `<h3 class="title"><span class="flag"><span class="new"> New </span></span>` +
    `<span class="job-source job-source-icon-25"><span class="wb-inv">indeed.com</span></span>` +
    `<span class="noctitle"> ${title} </span></h3>` +
    `<ul class="list-unstyled"><li class="date">${date} </li>` +
    `<li class="business">${biz}</li>` +
    `<li class="location"><span class="fas" aria-hidden="true"></span> ` +
    `<span class="wb-inv">Location</span> ${loc} </li>` +
    `<li class="salary">Salary $18.00 hourly</li></ul></a></article>`;

  const page =
    article('50029982', 'forklift operator', 'B&amp;J Global Inc', 'Mississauga (ON)', 'August 07, 2026') +
    article('50024544', 'forklift operator', 'ITALPASTA Limited', 'Brampton (ON)', 'August 06, 2026');

  test('extracts employer, city and posting date', () => {
    const leads = parseResults(page, 'forklift', 'https://x');
    assert.equal(leads.length, 2);
    assert.equal(leads[0].companyName, 'B&J Global Inc', 'entities are decoded');
    assert.equal(leads[0].city, 'Mississauga');
    assert.equal(leads[1].companyName, 'ITALPASTA Limited');
    assert.equal(leads[1].city, 'Brampton');
  });

  test('uses the posting date, not the run date', () => {
    // Without this a stale posting looks current and never ages out.
    const leads = parseResults(page, 'forklift', 'https://x');
    assert.equal(leads[0].trigger.date.slice(0, 10), '2026-08-07');
  });

  test('maps the job title to a course', () => {
    const leads = parseResults(page, 'forklift', 'https://x');
    assert.equal(leads[0].suggestedCourse, 'forklift-operator');
    assert.ok(leads[0].trigger.detail.includes('forklift operator'));
  });

  test('links to the posting, without the session id', () => {
    const leads = parseResults(page, 'forklift', 'https://x');
    assert.equal(
      leads[0].trigger.sourceUrl,
      'https://www.jobbank.gc.ca/jobsearch/jobposting/50029982',
    );
  });

  test('strips the location furniture', () => {
    assert.equal(parseLocation('Location Mississauga (ON)'), 'Mississauga');
    assert.equal(parseLocation('Location Richmond Hill (ON)'), 'Richmond Hill');
    assert.equal(parseLocation(undefined), undefined);
  });

  test('ignores page furniture that is not a result', () => {
    const junk = '<div class="results"><button>Advanced</button></div>';
    assert.equal(parseResults(junk, 'forklift', 'https://x').length, 0);
  });
});

describe('conviction parsing artefacts from the live run', () => {
  test('keeps the number on a numbered corporation', () => {
    // A live run produced the useless name "Ontario Corp." because the match
    // began at the first capital letter.
    assert.equal(
      extractCompanyName('2545345 Ontario Corp. was fined $5,000.'),
      '2545345 Ontario Corp.',
    );
  });

  test('only accepts a city when the province follows', () => {
    // "of Schedule" in legislative boilerplate was shipping "Schedule" as a city.
    const withProvince = parseBulletin(
      'Northgate Roofing Ltd. of Brampton, Ontario was fined $50,000.',
      'https://x',
    );
    assert.equal(withProvince[0].city, 'Brampton');

    const boilerplate = parseBulletin(
      'Vertex Construction Group was fined $50,000 under section 2 of Schedule 1.',
      'https://x',
    );
    assert.equal(boilerplate[0].city, undefined, 'no city rather than a wrong one');
  });
});

describe('newsroom API discovery from the app bundle', () => {
  test('finds scripts with unquoted src attributes', () => {
    // Regression: the real newsroom shell writes src=/js/app.js with no
    // quotes at all. A quotes-only pattern found zero scripts against a real
    // capture, silently disabling discovery on the one page it exists for.
    const shell =
      '<head><script src=/js/chunk-vendors.abc123.js></script>' +
      '<script src=/js/app.def456.js></script></head>';
    const urls = bundleUrls(shell, 'https://news.ontario.ca');
    assert.equal(urls.length, 2);
    assert.ok(urls.includes('https://news.ontario.ca/js/app.def456.js'));
  });

  test('also handles quoted attributes', () => {
    const shell = '<script src="/js/app.js"></script>';
    assert.deepEqual(bundleUrls(shell, 'https://news.ontario.ca'), [
      'https://news.ontario.ca/js/app.js',
    ]);
  });

  test('drops third-party bundles', () => {
    const shell =
      '<script src=/js/app.js></script>' +
      '<script src=https://www.googletagmanager.com/gtm.js></script>';
    const urls = bundleUrls(shell, 'https://news.ontario.ca');
    assert.equal(urls.length, 1);
    assert.ok(!urls.some((u) => u.includes('googletagmanager')));
  });

  test('pulls a rooted API path out of minified JS', () => {
    const js = 'var e={baseURL:"/api/v2/releases"},t="/js/chunk.js";';
    const found = extractApiCandidates(js, 'https://news.ontario.ca');
    assert.ok(found.includes('https://news.ontario.ca/api/v2/releases'));
    assert.ok(!found.some((u) => u.endsWith('chunk.js')), 'must skip asset paths');
  });

  test('pulls an absolute API host out of minified JS', () => {
    const js = 'const n="https://api.news.ontario.ca/v1/releases";';
    const found = extractApiCandidates(js, 'https://news.ontario.ca');
    assert.ok(found.includes('https://api.news.ontario.ca/v1/releases'));
  });

  test('ignores plain asset paths', () => {
    const js = 'var a="/images/logo.png",b="/fonts/font.woff2";';
    assert.deepEqual(extractApiCandidates(js, 'https://news.ontario.ca'), []);
  });
});

describe('robots.txt parsing', () => {
  test('collects Sitemap directives regardless of user-agent block', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /admin/',
      'Sitemap: https://example.com/sitemap.xml',
      '',
      'User-agent: Googlebot',
      'Disallow: /private/',
      'Sitemap: https://example.com/sitemap-news.xml',
    ].join('\n');

    const parsed = parseRobots(robots);
    assert.deepEqual(parsed.sitemaps, [
      'https://example.com/sitemap.xml',
      'https://example.com/sitemap-news.xml',
    ]);
  });

  test('collects Disallow only under * and Googlebot blocks', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /admin/',
      '',
      'User-agent: BadBot',
      'Disallow: /everything/',
      '',
      'User-agent: Googlebot',
      'Disallow: /crawler-only/',
    ].join('\n');

    const parsed = parseRobots(robots);
    assert.deepEqual(parsed.disallow, ['/admin/', '/crawler-only/']);
    assert.ok(!parsed.disallow.includes('/everything/'), 'irrelevant UA block ignored');
  });

  test('ignores comments and blank lines', () => {
    const robots = '# a comment\n\nUser-agent: *\n# another\nDisallow: /x/\n';
    assert.deepEqual(parseRobots(robots).disallow, ['/x/']);
  });

  test('isAllowed does prefix matching, empty rule disallows nothing', () => {
    assert.equal(isAllowed(['/admin/'], '/admin/users'), false);
    assert.equal(isAllowed(['/admin/'], '/public/page'), true);
    assert.equal(isAllowed([''], '/anything'), true);
  });
});

describe('sitemap parsing', () => {
  test('extracts <loc> entries from a plain sitemap', () => {
    const xml =
      '<?xml version="1.0"?><urlset>' +
      '<url><loc>https://x.com/a</loc></url>' +
      '<url><loc>https://x.com/b</loc></url>' +
      '</urlset>';
    assert.deepEqual(parseSitemapLocs(xml), ['https://x.com/a', 'https://x.com/b']);
  });

  test('extracts <loc> entries from a sitemap index the same way', () => {
    const xml =
      '<sitemapindex><sitemap><loc>https://x.com/sitemap-1.xml</loc></sitemap></sitemapindex>';
    assert.deepEqual(parseSitemapLocs(xml), ['https://x.com/sitemap-1.xml']);
  });

  test('tolerates whitespace inside the tag', () => {
    const xml = '<url><loc>\n  https://x.com/a  \n</loc></url>';
    assert.deepEqual(parseSitemapLocs(xml), ['https://x.com/a']);
  });
});

describe('inline hydration state extraction', () => {
  test('extracts window.__NUXT__', () => {
    const html = '<script>window.__NUXT__={"data":{"releases":[{"title":"X"}]}}</script>';
    const state = extractInlineState(html) as any;
    assert.equal(state.data.releases[0].title, 'X');
  });

  test('extracts window.__INITIAL_STATE__', () => {
    const html = '<script>window.__INITIAL_STATE__={"a":1}</script>';
    assert.deepEqual(extractInlineState(html), { a: 1 });
  });

  test('extracts __NEXT_DATA__', () => {
    const html = '<script id="__NEXT_DATA__">{"props":{"a":1}}</script>';
    assert.deepEqual(extractInlineState(html), { props: { a: 1 } });
  });

  test('returns undefined when none of the known patterns are present', () => {
    // This is the actual newsroom shell: none of these frameworks' hydration
    // markers are present, which is why this strategy alone does not rescue it.
    const shell = '<html><body><div id=app></div></body></html>';
    assert.equal(extractInlineState(shell), undefined);
  });
});

describe('source registry completeness', () => {
  // These exist to fail loudly, in CI, the moment someone adds a new trigger
  // kind or a new source and forgets a step — rather than silently shipping a
  // lead that scores zero, or a source nobody remembered to register.

  test('every TriggerKind has a scoring weight', () => {
    for (const kind of ALL_TRIGGER_KINDS) {
      assert.ok(
        typeof weights[kind] === 'number',
        `TriggerKind "${kind}" has no entry in weights (config.mts) — it will silently score 0`,
      );
    }
  });

  test('every TriggerKind has a positive weight', () => {
    // A weight of 0 is indistinguishable from a missing entry in the batch
    // output, so it is worth asserting explicitly rather than just presence.
    for (const kind of ALL_TRIGGER_KINDS) {
      assert.ok((weights[kind] ?? 0) > 0, `TriggerKind "${kind}" has weight 0`);
    }
  });

  test('every registered source has a non-empty id and label', () => {
    for (const source of sources) {
      assert.ok(source.id.length > 0);
      assert.ok(source.label.length > 0);
    }
  });

  test('no two registered sources share an id', () => {
    const ids = sources.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate source id would silently shadow one source in --source filtering');
  });

  test('enabledSources in config lists every registered source id', () => {
    // The two lists exist for different reasons (one is the actual registry,
    // one documents intent in config.mts) and are easy to let drift apart.
    const registered = new Set(sources.map((s) => s.id));
    for (const id of enabledSources) {
      assert.ok(registered.has(id), `enabledSources lists "${id}" but no source with that id is registered in sources/index.mts`);
    }
    for (const source of sources) {
      assert.ok(
        (enabledSources as readonly string[]).includes(source.id),
        `source "${source.id}" is registered but missing from enabledSources in config.mts`,
      );
    }
  });
});
