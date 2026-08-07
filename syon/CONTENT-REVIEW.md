# Content review — required before launch

Everything in this file is a **draft claim written by the build, not information
supplied by Syon**. Syon must confirm each item before the site goes live.

This matters more than it would on a normal marketing site. Syon sells
regulatory compliance. A wrong validity period or a misattributed regulation on
a page that ranks for "is WHMIS training mandatory in Ontario" is a claim a
customer may rely on, and one a competitor or a regulator can point at. None of
it should be published on the strength of a draft.

## How to review

Each course in `lib/courses.ts` has four fields that make regulatory claims:

| Field | What it asserts |
| --- | --- |
| `regulation` | The Ontario regulation the training maps to |
| `validity` | How long certification lasts |
| `mandatory` | Whether the law requires it for the stated audience |
| `audience` | Who specifically is required to take it |

Correct them in `lib/courses.ts`. Every page, the JSON-LD, the sitemap and
`llms.txt` regenerate from that one file.

## Claims requiring sign-off

| Course | Claim drafted | Confirmed? |
| --- | --- | --- |
| Working at Heights | CPO-approved; valid 3 years; required under O. Reg. 213/91 | ☐ |
| Working at Heights | Syon is an approved CPO training provider — **this is asserted throughout and must be true** | ☐ |
| WHMIS 2015 | No fixed statutory expiry; annual review is practice; O. Reg. 860 | ☐ |
| Forklift operator | No provincial licence exists; 3-year refresher is convention; CSA B335 | ☐ |
| JHSC certification | Part 1 three days, Part 2 two days; 20+ worker threshold; OHSA s.9 | ☐ |
| JHSC certification | Refresher required every 3 years to stay current | ☐ |
| First Aid and CPR | Two days; valid 3 years; meets WSIB Regulation 1101 | ☐ |
| First Aid and CPR | Which certifying body issues the certificate — **not stated anywhere yet** | ☐ |
| Confined space | O. Reg. 632/05; written rescue plan required before entry | ☐ |
| Awareness training | Mandatory for all workers and supervisors; O. Reg. 297/13 | ☐ |
| Fall protection | 3 m threshold in industrial establishments; O. Reg. 851; CSA B354 | ☐ |

## Business facts not yet supplied

| Item | Status | Consequence if left unresolved |
| --- | --- | --- |
| Street address | **Missing.** `site.address` is `null` | `LocalBusiness` schema is materially weaker, and a Google Business Profile — the single biggest local ranking factor — cannot be verified without one |
| Accreditation and approval numbers | Missing | These are the strongest trust signals available in this sector and are currently absent from every page |
| Pricing | Missing | Pages say "request a quote" throughout. Published from-prices typically improve conversion on comparison-stage queries |
| Real course durations | Drafted from industry norms | Any that differ from Syon's actual delivery must be corrected |
| Which cities Syon genuinely serves | **Assumed.** 12 cities in `lib/cities.ts` | Pages for areas Syon cannot service read as doorway pages to Google and are a spam-policy risk. Cut any that are not real |
| Certifying bodies and partner logos | Missing | Named accreditation is what separates this from a directory listing |

## Deliberate omissions

These were left out on purpose. Do not "fix" them by inventing values.

- **No `aggregateRating` or `review` markup.** Review schema without genuine
  collected reviews is a structured-data violation and risks a manual action.
  Add it once Syon has real reviews, sourced through a review platform.
- **No street address in JSON-LD.** A placeholder address is worse than none.
- **No specific student numbers, pass rates or "trusted by X companies"
  claims.** None were supplied, and unverifiable social proof is the fastest
  way to lose the trust the rest of the site is trying to build.
