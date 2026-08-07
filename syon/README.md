# Syon Safety — SEO/GEO lead generation site

A statically exported Next.js site built to acquire inbound leads for Syon
Safety Ltd. through search and through generative engines.

**Read [CONTENT-REVIEW.md](./CONTENT-REVIEW.md) before this goes anywhere
near production.** Several regulatory claims are drafted, not verified.

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static export to ./out, plus llms.txt
```

`npm run build` runs `next build` and then regenerates `out/llms.txt` from the
same data the pages use.

## What this produces

121 static pages from two data files:

| Surface | Count | Purpose |
| --- | --- | --- |
| `/` | 1 | Brand and category entry point |
| `/courses/` + `/courses/[course]/` | 9 | Research-intent queries — "what is WHMIS training" |
| `/[city]/` | 12 | Local hubs — "safety training Mississauga" |
| `/[city]/[course]/` | 96 | **The money pages.** Buying-intent queries — "forklift training Mississauga" |
| `/quote/` | 1 | Direct conversion |

Adding a course to `lib/courses.ts` creates its detail page plus 12 city pages.
Adding a city to `lib/cities.ts` creates its hub plus 8 course pages. Sitemap,
JSON-LD, internal links and `llms.txt` all follow automatically.

## Why it is built this way

**The city × course matrix is where the revenue is.** "Forklift training" is a
research query. "Forklift training Mississauga" is typed by someone with a
purchase order. Only the second converts at a rate worth paying for, so the
architecture is organised around producing a genuinely distinct, genuinely
useful page for each of those intersections.

**GEO is not a separate content strategy, it is a formatting discipline.**
Generative engines cite passages that are short, self-contained and factually
framed. So every page opens with an `AnswerBlock` — the question as a heading,
then a single sentence that answers it and still makes sense with no
surrounding context — followed by a `FactTable` of labelled key-value facts.
Both are mirrored into JSON-LD, so the same assertion is available as prose to
a reader, as a triple to a crawler, and as an extractable passage to a
retrieval pipeline.

**AI crawlers are allowed in `robots.ts`, deliberately.** Blocking GPTBot and
friends is a common default and wrong for this business: the entire objective
is to be the source an assistant names when an Ontario employer asks what
training they need. You cannot be cited by a crawler you have blocked.

**Nothing is asserted in markup that is not on the page,** and nothing is
asserted that Syon has not confirmed. That is why there is no review schema and
no address — see CONTENT-REVIEW.md.

## Configuration

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_LEAD_ENDPOINT` | Where the quote form POSTs. **Required for the form to work.** |
| `BASE_PATH` | Set when serving from a subdirectory, e.g. a GitHub Pages project site. Leave unset for the domain root. |

### Lead endpoint

Static export has no server, so the form POSTs JSON to an external handler.
With no endpoint set, the form does not pretend to work — it shows the phone
and email fallback instead.

Payload:

```json
{
  "name": "...", "company": "...", "email": "...", "phone": "...",
  "groupSize": "5-15", "timing": "asap", "notes": "...",
  "course": "forklift-operator", "city": "mississauga",
  "sourcePath": "/mississauga/forklift-operator/",
  "submittedAt": "2026-08-07T00:00:00.000Z"
}
```

`course`, `city` and `sourcePath` are the commercially important fields. Without
them there is no way to tell which of the 96 landing pages produce enquiries,
and the whole matrix has to be judged on aggregate traffic — which is close to
useless for deciding what to build next. Make sure whatever consumes this
persists all three.

`website` is a honeypot. Any submission where it is non-empty is a bot; drop it
server-side.

## Deployment

`npm run build` emits a fully static `./out`. It has no runtime dependencies
and can be served from GitHub Pages, Cloudflare Pages, S3, or anything else.

Before launch:

1. Work through CONTENT-REVIEW.md.
2. Set `NEXT_PUBLIC_LEAD_ENDPOINT`.
3. Confirm `site.origin` in `lib/site.ts` matches the production domain — it is
   baked into every canonical, the sitemap and all JSON-LD.
4. Map redirects from the existing syonsafety.com URLs so current rankings
   survive the cutover.
5. Submit the sitemap in Google Search Console and Bing Webmaster Tools.

## What this does not do

Honest scope boundaries — none of the following is built:

- **No Google Business Profile.** For local search this is probably the single
  highest-leverage thing Syon can do, and it is not a website task. It needs a
  verified address.
- **No analytics.** The proposal scopes conversion tracking; no property exists
  yet, so nothing is wired in. Without it, none of the attribution above is
  visible.
- **No CMS.** Content lives in TypeScript. Fine for a developer, not for Syon
  staff editing copy. The proposal scopes a CMS; this build does not include one.
- **No training-provider API integration.** Sandeep's back end did not exist as
  of 17 July 2026. The catalogue is static data, structured so it can be
  swapped for an API-backed source without touching the page components.
- **No blog or content marketing surface.** The matrix covers commercial
  queries. It does not cover the informational long tail.
