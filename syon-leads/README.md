# Syon Leads

Finds Ontario safety-training leads from free public data and writes a
fortnightly call sheet.

**Zero dependencies, zero cost.** No npm install, no API keys, no
subscriptions. Node 22.6+ only.

```bash
npm run demo    # full pipeline on invented sample data — no network
npm test        # 21 tests
npm run dry     # live sources, print results, write nothing
npm run batch   # live sources, write the call sheet
```

## The idea

Anyone can buy a list of Ontario companies with 5–50 staff. That is a phone
book, and it gets cancelled after two batches.

This finds companies where **something just happened that means they need
training now**:

| Trigger | Why it converts | Weight |
| --- | --- | --- |
| Ministry of Labour conviction or fine | Urgent, funded, board-level problem. Training is the standard remedial step | 100 |
| Hiring for a role needing certification | A stated need with a timeline, announced publicly | 60 |
| Building permit pulled | Crews going up. An inference, not a statement | 35 |
| New incorporation in a relevant sector | Right sector, no evidence of need yet | 15 |

Scores decay to zero across 60 days — a Ministry order from last week is a
different conversation from one eight weeks ago.

Each lead ships with **the course to pitch** and **the reason to call**, so the
opener is "I saw you're hiring lift truck operators" rather than a cold
introduction.

## What comes out

A CSV per batch. Columns run left to right in the order a caller works: who,
how to reach them, what to pitch, why now, where to verify it — then three
empty columns for **Called / Interested / Booked**.

Those three columns are the whole feedback loop. They ship empty on purpose: a
column that is already there gets filled in, one that has to be added does not.
Chase Sandeep for them every fortnight. When the free period ends, "the last
six batches produced four booked jobs" is the entire pricing conversation.

Plus a one-page markdown summary for the email body.

## Guardrails built in

- **Never sends the same company twice.** `data/history.json` is a permanent
  ledger, matched on a normalised name so "Acme Inc." and "ACME Limited" are
  one company. It is committed to git so it cannot be lost with a laptop.
- **Merges duplicates across sources** and scores them *higher* — a company
  appearing in both enforcement and hiring data is a stronger lead than either
  signal alone.
- **Drops anything outside the service area** or past the staleness window.
- **A dead source never kills the batch.** The others still produce a list.
- **Short batches are allowed.** Ten good beats ten padded, and the runner says
  so out loud.

## Honest status

**Verified:** the pipeline. Scoring, recency decay, service-area filtering,
duplicate merging, the never-send-twice ledger, CSV escaping, batch numbering.
21 tests, all passing. This is the part with commercial consequences and it is
correct.

**Not verified:** the three source parsers, against live endpoints. This was
built in a sandbox whose network policy blocks `ontario.ca`,
`jobbank.gc.ca` and the Toronto CKAN API, so the parsers are written against
the documented shape of those pages but have never run on the real HTML.

Expect to recalibrate them on first contact. Run one at a time:

```bash
node --experimental-strip-types src/run.mts --source mol-convictions --dry
```

If a parser returns zero rows, the page shape has moved. The parsers are
deliberately conservative — they skip anything ambiguous rather than guess,
because a wrong company name on a call sheet is worse than a short batch.

## The real limitation: phone numbers

Sandeep specifically asked for **decision-maker phone numbers**. Free public
data mostly will not give you those. It gives you a company, a trigger, and
often a main line.

Paid databases exist precisely because direct-dial numbers are the expensive
part. With zero budget, the realistic answer is: deliver the company plus the
trigger, get the main line from their website, and let the caller ask for the
right person. That is normal cold calling — and a main line with "I saw you
were fined last month for a fall from height" beats a direct dial with nothing
to say.

Worth telling Sandeep plainly rather than letting him discover it.

## Adding sources

Cheapest wins first:

1. **Mississauga, Brampton, Hamilton permit portals.** All run comparable open
   data platforms. `torontoPermits.mts` is a usable template. Toronto alone
   covers a fraction of the service area.
2. **Ontario Business Registry** for new incorporations in relevant sectors.
3. **WSIB classification data** for sector targeting.

Deliberately **not** used: Indeed and LinkedIn. Both prohibit scraping in their
terms of service, and building a client-facing business process on a terms
violation is a liability that outweighs the data.

## Compliance

Calls are made by Syon, so the obligations sit with them. Two things to know:

- Canada's National Do Not Call List **largely exempts business-to-business
  calls**, and CASL governs email and texts rather than phone calls. Worth
  confirming properly rather than taking it from a README.
- Anyone who asks not to be contacted goes on a suppression list applied to
  every future batch. Nothing implements that yet — add it before volume grows.

## Layout

```
src/
  config.mts        Batch size, service area, keyword→course map, weights
  types.mts
  run.mts           CLI
  sources/          One adapter per data source
  lib/score.mts     Scoring, recency, dedupe keys, merging
  lib/history.mts   The permanent ledger
  lib/output.mts    CSV + summary
  fixtures/demo.mts Invented sample leads for --demo
test/               21 tests
data/history.json   Every lead ever sent. Commit this.
```

Tuning lives in `config.mts` — batch size, cities, keyword map, weights.
