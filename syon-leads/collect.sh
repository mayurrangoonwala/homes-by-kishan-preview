#!/usr/bin/env bash
# One command that does the whole calibration run and bundles the result into a
# single file to send back.
#
# The parsers in src/sources/ have never been run against the live pages: the
# environment they were written in blocks ontario.ca, jobbank.gc.ca and the
# Toronto open-data API at the network gateway. This script collects everything
# needed to fix them in one pass, so it is one round trip rather than several.
#
#   bash collect.sh
#
# Writes syon-leads-report.txt. Sends nothing anywhere, writes no lead batch.

set -uo pipefail

cd "$(dirname "$0")" || exit 1

REPORT="syon-leads-report.txt"
: > "$REPORT"

say() { echo "$@" | tee -a "$REPORT"; }
rule() { say ""; say "======================================================"; say "$1"; say "======================================================"; }

say "Syon leads — calibration report"
say "Generated: $(date)"

rule "1. Environment"

NODE_V="$(node --version 2>/dev/null || echo 'NOT INSTALLED')"
say "node: $NODE_V"
say "npm:  $(npm --version 2>/dev/null || echo 'NOT INSTALLED')"
say "os:   $(uname -srm)"

# Node 22.6 introduced the type stripping this project relies on to run with
# no build step and no dependencies.
MAJOR="$(echo "$NODE_V" | sed 's/^v//' | cut -d. -f1)"
MINOR="$(echo "$NODE_V" | sed 's/^v//' | cut -d. -f2)"
if [ -z "$MAJOR" ] || [ "$MAJOR" = "NOT" ]; then
  say ""
  say "STOP: Node is not installed. Run: brew install node"
  say "Then run this script again."
  exit 1
fi
if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 6 ]; }; then
  say ""
  say "STOP: Node $NODE_V is too old — this needs v22.6 or newer."
  say "Run: brew upgrade node   (or: brew install node)"
  say "Then run this script again."
  exit 1
fi

rule "2. Test suite (proves the pipeline works locally)"
npm test 2>&1 | tail -20 | tee -a "$REPORT"

rule "3. Source diagnosis (the part that needs fixing)"
say "Running npm run inspect — this hits the live sources and writes no batch."
say ""
npm run inspect 2>&1 | tee -a "$REPORT"

rule "4. Candidate leads (dry run — writes nothing)"

# The point of the whole exercise. Diagnostics say whether the plumbing works;
# this says whether the output is worth sending to a client. A source can
# report success and still produce leads nobody would call.
say "Top candidates from whichever sources are working:"
say ""
npm run dry 2>&1 | tail -40 | tee -a "$REPORT"

rule "5. Raw payloads captured"

if [ -d debug ]; then
  ls -la debug/ 2>&1 | tee -a "$REPORT"
else
  say "No debug/ directory — every source failed before saving anything."
  say "The section above says why."
fi

rule "6. Payload samples"

# The head of each payload is usually enough to identify the page shape. Full
# files stay on disk for anything that needs a closer look.
if [ -d debug ]; then
  for f in debug/*; do
    [ -f "$f" ] || continue
    say ""
    say "--- $f ($(wc -c < "$f" | tr -d ' ') bytes) ---"
    # Printed AND appended. An earlier version wrote to the report only, which
    # meant anyone pasting their terminal output sent back empty sample
    # sections — the file is not always what gets shared.
    SIZE=$(wc -c < "$f" | tr -d ' ')
    if [ "$SIZE" -lt 4000 ]; then
      # Small enough to include whole; usually the most diagnostic case.
      cat "$f" | tee -a "$REPORT"
    else
      head -c 1500 "$f" | tee -a "$REPORT"
    fi
    say ""
  done
  say "(files under 4KB shown whole; larger files truncated to 1500 bytes)"
fi

rule "7. Job Bank result markup"

# jobbank-sample.html is ~280KB, far too large to paste, and the first bytes
# are all <head>. This pulls out just the markup that wraps a job result,
# which is the only part needed to write the parser.
if [ -f debug/jobbank-sample.html ]; then
  node -e '
const fs = require("fs");
const h = fs.readFileSync("debug/jobbank-sample.html", "utf8");


// Job Bank job links look like /jobsearch/jobposting/<id>. Anchoring on that
// finds the real result rows regardless of what the wrapper element is called
// — the first attempt guessed at class names and returned the search toolbar.
const links = [...h.matchAll(/href="[^"]*jobposting\/\d+[^"]*"/gi)];
console.log(`job posting links found: ${links.length}`);

if (links.length > 0) {
  // Print the markup surrounding the first few, which is where the employer
  // name and location live.
  let n = 0;
  for (const m of links) {
    if (n >= 3) break;
    const i = m.index ?? 0;
    console.log("----- context around link " + (n + 1) + " -----");
    console.log(h.slice(Math.max(0, i - 700), i + 900).replace(/\s+/g, " "));
    n++;
  }
} else {
  console.log("No jobposting links. Searching for employer markers instead:");
  for (const marker of ["business", "employer", "noc", "location", "jobtitle"]) {
    const re = new RegExp('class="[^"]*' + marker + '[^"]*"', "i");
    const m = h.match(re);
    if (m && m.index !== undefined) {
      console.log(`--- ${m[0]} at ${m.index} ---`);
      console.log(h.slice(Math.max(0, m.index - 300), m.index + 700).replace(/\s+/g, " "));
    }
  }
}
' 2>&1 | tee -a "$REPORT"
else
  say "No Job Bank payload captured."
fi

rule "Done"
say "Report written to: $(pwd)/$REPORT"
say ""
say "Send that file back. If a payload looks truncated or you want to send the"
say "originals, they are in $(pwd)/debug/"
say ""
say "Nothing was sent anywhere and no lead batch was written."
