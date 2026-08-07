# Syon Leads

Finds Ontario safety-training leads from free public data and writes a
fortnightly call sheet.

**Zero dependencies, zero cost.** No npm install, no API keys, no
subscriptions. Node 22.6+ only.

```bash
npm run demo     # full pipeline on invented sample data — no network
npm test         # 48 tests
npm run inspect  # hit the live sources, diagnose them, write nothing
npm run dry      # live sources, print candidate leads, write nothing
npm run batch    # live sources, write the call sheet
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
- **Honours do-not-contact requests.** See below.
- **Merges duplicates across sources** and scores them *higher* — a company
  appearing in both enforcement and hiring data is a stronger lead than either
  signal alone.
- **Drops anything outside the service area** or past the staleness window.
- **A dead source never kills the batch.** The others still produce a list.
- **Short batches are allowed.** Ten good beats ten padded, and the runner says
  so out loud.

## Honest status

**Verified:** the pipeline. Scoring, recency decay, service-area filtering,
duplicate merging, the never-send-twice ledger, do-not-contact suppression,
CSV escaping, batch numbering, and the diagnostics below. 48 tests, all
passing. This is the part with commercial consequences and it is correct.

**Not verified:** the three source parsers, against live endpoints. This was
built in an environment whose egress policy blocks `ontario.ca`,
`jobbank.gc.ca` and the Toronto CKAN API, so the parsers are written against
the documented shape of those pages but have never run on the real HTML.

## Calibrating the sources

Start here:

```bash
npm run inspect
```

This fetches every source, saves the raw payloads to `debug/`, and says what
it received. It writes no batch, so it cannot produce anything sendable.

The point is that "0 leads" has at least four causes needing four different
fixes, and the output names which one you have:

| Report | Meaning | Fix |
| --- | --- | --- |
| `HTTP 403 — refused` | Blocked, not unmatched | Try a browser; if it works there, use their data download |
| `HTTP 404 — moved` | Page renamed | Update the URL |
| `results are rendered by JavaScript` | HTML has no data in it | **No parser will ever work.** Find the data feed |
| `parser matched nothing` | Real content, patterns wrong | Genuine parser fix — send the raw file |
| `N records but none parsed` | Schema differs | Output lists the real column names; add them to `FIELD_CANDIDATES` |

Built to survive the common failures: the CKAN dataset is located by search as
well as by slug, so a rename does not break it; the MOL source parses the index
and falls back to following linked bulletins; column names are a candidate list
rather than hardcoded.

The parsers stay deliberately conservative — they skip anything ambiguous
rather than guess, because a wrong company name on a call sheet is worse than a
short batch.

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

## Do-not-contact list

Two things suppress a company, and both are checked before the batch is built:

1. **`data/suppression.json`** — standing entries. Someone rang Syon and asked
   to be left alone, or Raj knows a company is an existing customer, a
   competitor, or off-limits for any other reason.

   ```json
   [
     {
       "companyName": "Northgate Roofing Ltd.",
       "reason": "Asked not to be contacted, 2026-08-01",
       "addedAt": "2026-08-01T00:00:00.000Z"
     }
   ]
   ```

   `reason` is required. Unexplained entries get deleted by someone later who
   cannot tell why they are there.

2. **`do-not-contact` in a returned call sheet.** Anything Sandeep marks that
   way in the ledger is suppressed from the next run onward.

Matching is deliberately looser than the sent-history ledger: it ignores the
city (a request applies to the company, not one site) and catches longer
trading names, so "Northgate Roofing" also blocks "Northgate Roofing and Sheet
Metal Ltd". `not-interested` is **not** suppression — that is a no for now, and
worth another look in a year.

## Adding sources

Cheapest wins first:

1. **More permit portals.** `ckanPermitSource()` turns a portal into a source
   from a config object, so a new CKAN municipality is a few lines. Toronto
   alone covers a fraction of the service area, so this is the biggest easy
   gain.

   Only Toronto is configured, on purpose: Mississauga, Brampton and Hamilton
   publish on ArcGIS Hub or bespoke platforms rather than CKAN, and their
   endpoints have not been confirmed from here. Find the real dataset URL
   first — a guessed endpoint that 404s is worse than an honest gap. ArcGIS
   portals need a small adapter alongside `ckanPermits.mts`; the parser and
   height-relevance filter are reusable as-is.
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
  every future batch. Implemented — see "Do-not-contact list" above. The
  process gap that remains is human: Sandeep has to actually report the
  requests, so make that an explicit ask when you send each batch.

## Layout

```
src/
  config.mts        Batch size, service area, keyword→course map, weights
  types.mts
  run.mts           CLI
  sources/          One adapter per data source
    ckanPermits.mts   Reusable CKAN permit adapter + parser
  lib/score.mts     Scoring, recency, dedupe keys, merging
  lib/history.mts   The permanent ledger
  lib/suppression.mts  Do-not-contact list
  lib/output.mts    CSV + summary
  fixtures/demo.mts Invented sample leads for --demo
test/               29 tests
data/history.json     Every lead ever sent. Commit this.
data/suppression.json Do-not-contact list. Commit this.
```

Tuning lives in `config.mts` — batch size, cities, keyword map, weights.
