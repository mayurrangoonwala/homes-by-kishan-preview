// Extracts the markup that wraps a Job Bank search result.
//
// Lives in a file rather than inline in collect.sh because the previous
// version was a single-quoted `node -e` string containing single quotes of its
// own, which terminated the shell quote and produced a syntax error at the
// point in the report where the answer was supposed to be.
//
//   node scripts/inspect-jobbank.mjs [path-to-saved-html]

import { readFileSync, existsSync } from 'node:fs';

const path = process.argv[2] ?? 'debug/jobbank-sample.html';

if (!existsSync(path)) {
  console.log(`No Job Bank payload at ${path}.`);
  process.exit(0);
}

const html = readFileSync(path, 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

// Job postings link to /jobsearch/jobposting/<id>. Anchoring on that finds the
// real result rows whatever the wrapper element is called — an earlier attempt
// guessed at class names and returned the search toolbar.
const links = [...html.matchAll(/href="[^"]*jobposting\/\d+[^"]*"/gi)];
console.log(`job posting links found: ${links.length}`);

if (links.length > 0) {
  links.slice(0, 3).forEach((m, i) => {
    const at = m.index ?? 0;
    console.log(`----- context around link ${i + 1} -----`);
    console.log(squash(html.slice(Math.max(0, at - 700), at + 900)));
  });
} else {
  console.log('No jobposting links. Context around likely markers instead:');
  for (const marker of ['employer', 'business', 'noc', 'jobtitle', 'resultJob']) {
    const re = new RegExp(`class="[^"]*${marker}[^"]*"`, 'i');
    const m = html.match(re);
    if (m && m.index !== undefined) {
      console.log(`--- ${m[0]} at ${m.index} ---`);
      console.log(squash(html.slice(Math.max(0, m.index - 300), m.index + 700)));
    }
  }

  // Last resort: the results count is in the page metadata, which at least
  // confirms whether the search returned anything at all.
  const count = html.match(/View (\d+) job postings/i);
  if (count) console.log(`\nPage reports ${count[1]} postings exist.`);
}
