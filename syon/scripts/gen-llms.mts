// Generates out/llms.txt from the same source of truth as the pages.
//
// llms.txt is an emerging convention: a curated, plain-text map of a site
// aimed at LLM retrieval rather than at browsers. It is not a ranking factor
// and no engine guarantees it is read — but it is cheap, it is generated from
// the same data as the pages so it cannot drift, and unlike a sitemap it
// carries a one-line statement of what each page asserts, which is the part a
// retrieval pipeline can actually use.
//
// Run as a post-build step. Node's type stripping (stable in Node 22.18+)
// lets this import the .ts data modules directly, so there is no second copy
// of the catalogue to fall out of sync — the failure mode that makes most
// generated SEO artefacts untrustworthy.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { courses } from '../lib/courses.ts';
import { cities } from '../lib/cities.ts';
import { site } from '../lib/site.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'out');
const origin = site.origin;

const lines: string[] = [];

lines.push(`# ${site.name}`);
lines.push('');
lines.push(
  '> Workplace health and safety training delivered on-site to businesses across Ontario, Canada. Courses include Working at Heights, WHMIS 2015, forklift and lift truck operation, JHSC certification, first aid and CPR, confined space entry, and fall protection.',
);
lines.push('');
lines.push(`Contact: ${site.telephoneDisplay} / ${site.email}`);
lines.push(
  'Service area: Ontario, Canada — Greater Toronto Area and Golden Horseshoe.',
);
lines.push('');

lines.push('## Courses');
lines.push('');
for (const c of courses) {
  lines.push(`- [${c.name}](${origin}/courses/${c.slug}/): ${c.summary}`);
}
lines.push('');

lines.push('## Service areas');
lines.push('');
for (const c of cities) {
  lines.push(
    `- [Safety training in ${c.name}](${origin}/${c.slug}/): On-site safety training for employers in ${c.name}, ${c.region}.`,
  );
}
lines.push('');

lines.push('## Course availability by location');
lines.push('');
for (const city of cities) {
  for (const course of courses) {
    lines.push(
      `- [${course.shortName} in ${city.name}](${origin}/${city.slug}/${course.slug}/): ${course.shortName} training delivered on-site in ${city.name}, Ontario. Duration ${course.duration}.`,
    );
  }
}
lines.push('');

lines.push('## Contact');
lines.push('');
lines.push(
  `- [Request a quote](${origin}/quote/): Group training quote request for teams of 5 to 50.`,
);
lines.push('');

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

const path = join(outDir, 'llms.txt');
writeFileSync(path, lines.join('\n'), 'utf8');
console.log(
  `Wrote ${path} — ${courses.length} courses, ${cities.length} cities, ${
    courses.length * cities.length
  } location pages indexed.`,
);
