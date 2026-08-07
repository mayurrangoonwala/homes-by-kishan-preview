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

rule "4. Raw payloads captured"

if [ -d debug ]; then
  ls -la debug/ 2>&1 | tee -a "$REPORT"
else
  say "No debug/ directory — every source failed before saving anything."
  say "The section above says why."
fi

rule "5. Payload samples"

# The head of each payload is usually enough to identify the page shape. Full
# files stay on disk for anything that needs a closer look.
if [ -d debug ]; then
  for f in debug/*; do
    [ -f "$f" ] || continue
    say ""
    say "--- $f ($(wc -c < "$f" | tr -d ' ') bytes) ---"
    # Appended to the report only, not echoed — raw HTML on the terminal is
    # noise, and the report is what gets sent back.
    head -c 3000 "$f" >> "$REPORT"
    printf '\n' >> "$REPORT"
  done
  say "(first 3000 bytes of each file included above)"
fi

rule "Done"
say "Report written to: $(pwd)/$REPORT"
say ""
say "Send that file back. If a payload looks truncated or you want to send the"
say "originals, they are in $(pwd)/debug/"
say ""
say "Nothing was sent anywhere and no lead batch was written."
