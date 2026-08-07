# SEO/GEO lead generation — the parts that are not code

The site is the asset. It is not the programme. This is what has to happen
around it, roughly in priority order.

## 1. Google Business Profile comes first

For a local service business this outranks everything in this repo. The local
pack sits above the organic results for almost every "safety training [city]"
query, and eligibility requires a verified address and service-area setup.

Blocked on Syon supplying an address. Until then the site is competing for the
organic results below the fold while the three most valuable slots on the page
go to competitors by default.

## 2. Query architecture

Three tiers, deliberately built in this order:

**Buying intent — `/[city]/[course]/`, 96 pages.** `forklift training
mississauga`, `working at heights toronto`, `whmis certification brampton`.
Low individual volume, high conversion, low competition. This is the tier that
pays, and it is why the matrix exists.

**Research intent — `/courses/[course]/`, 8 pages.** `what is jhsc
certification`, `how long is whmis valid`. Higher volume, converts poorly
directly, but it is where AI citation happens and it feeds the tier above
through internal links.

**Not built: the compliance long tail.** `do i need working at heights
training`, `ontario safety training requirements for small business`,
`wsib first aid requirements`. This is the strongest GEO surface available —
these are exactly the questions people now ask an assistant rather than a
search box — and none of it exists yet. It needs a content surface the current
build does not have. Highest-value next increment.

## 3. What actually earns AI citation

Ranking and being cited are different problems. From what consistently
distinguishes cited sources:

- **Answer in the first sentence.** Assistants extract self-contained
  passages. Prose that builds to its point over a paragraph gets paraphrased
  without attribution. The `AnswerBlock` component enforces this.
- **Labelled facts, not narrative.** "Validity: 3 years" is extractable.
  "Your certificate will remain valid for a period of three years" is not,
  reliably.
- **Entity clarity.** Consistent name, phone, and eventually address, matching
  across the site, JSON-LD, and every external directory. Inconsistency makes a
  retrieval pipeline uncertain which entity you are, and uncertainty loses the
  citation.
- **Being cited elsewhere.** Assistants lean heavily on sources that
  corroborate. Industry directories, association listings and local press
  matter more for GEO than they did for classic SEO.

`llms.txt` is generated and served, but treat it as cheap insurance rather than
a mechanism — no major engine commits to reading it.

## 4. Measurement

Nothing above is defensible without this, and none of it exists yet.

| Question | How you answer it |
| --- | --- |
| Which pages produce leads? | `course` / `city` / `sourcePath` on the form payload |
| Which queries produce impressions? | Search Console, filtered by page directory |
| Is AI traffic arriving? | Referrer analysis — `chatgpt.com`, `perplexity.ai`, `copilot.microsoft.com` |
| Are we cited when we should be? | Manual monthly checks: ask each assistant the 20 core queries and record whether Syon appears |

That last row has no tooling. It is a recurring manual task and worth doing —
it is the only direct read on whether the GEO work is landing.

## 5. Sequencing

1. Verify CONTENT-REVIEW.md. Nothing launches before this.
2. Google Business Profile — needs the address.
3. Launch the site with redirects mapped from the current URLs.
4. Wire analytics and the lead endpoint. Without these, launch is unmeasurable.
5. Search Console and Bing Webmaster Tools, submit sitemap.
6. Then, and only then, expand: compliance long-tail content, more cities as
   coverage genuinely grows, review collection.

## 6. Honest expectations

New pages on a domain with little authority do not rank quickly. Realistically
this is a three-to-six month curve for the city × course pages to establish,
faster for anything where Syon already has brand recognition, and slower in
Toronto than in Milton because competition scales with market size.

The two things that would move it fastest are both off-site: a verified Google
Business Profile, and genuine reviews. Neither is a website problem.

Do not expand the city list to chase volume. Twelve real service areas that
convert beat forty that read as doorway pages — that pattern is a documented
spam-policy risk, and the recovery from a manual action costs more than the
traffic was ever worth.
