// Fetch diagnostics.
//
// The parsers in sources/ were written without access to the live pages — the
// build environment's egress policy blocks ontario.ca, jobbank.gc.ca and the
// Toronto CKAN API. Rather than guess harder at page shapes, each source
// reports what it actually received so a single local run identifies the
// problem instead of several rounds of trial and error.
//
// The distinction that matters when a parser returns nothing:
//
//   - the request was blocked            -> not a parser problem
//   - the page is a JavaScript shell     -> scraping HTML will never work,
//                                           the source needs a data feed
//   - real content, no matches           -> a genuine parser fix
//
// Reporting those as one undifferentiated "0 rows" wastes everyone's time.

export type SourceDiagnostic = {
  sourceId: string;
  ok: boolean;
  /** One-line conclusion, printed under the source name. */
  note: string;
  /** Concrete next actions. Printed indented beneath the note. */
  hints: string[];
  rawPath?: string;
  bytes?: number;
  /** For JSON sources: the keys actually present, so field mapping is trivial. */
  sampleFields?: string[];
};

export type Verdict =
  | 'blocked'
  | 'js-shell'
  | 'empty'
  | 'content';

const BLOCK_MARKERS = [
  'access denied',
  'captcha',
  'unusual traffic',
  'are you a robot',
  'request blocked',
  'cloudflare',
  'forbidden',
  'temporarily unavailable',
];

/**
 * Classifies a fetched HTML payload.
 *
 * The JS-shell check is the important one. A page that renders results client
 * side returns plenty of bytes and a valid 200, so it looks healthy while
 * containing no data at all. Distinguishing it from a parser bug is the
 * difference between "fix a regex" and "this source needs a different
 * approach entirely".
 */
export function classifyHtml(html: string, textLength?: number): Verdict {
  const lower = html.slice(0, 4000).toLowerCase();

  if (html.length < 500) return 'empty';
  if (BLOCK_MARKERS.some((m) => lower.includes(m))) return 'blocked';

  const text = textLength ?? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  const scriptCount = (html.match(/<script/gi) ?? []).length;

  // A content page carries far more visible text than markup overhead. A shell
  // is mostly script tags with a nearly empty body.
  const textRatio = text / html.length;
  if (textRatio < 0.05 && scriptCount > 3) return 'js-shell';
  if (text < 400) return 'js-shell';

  return 'content';
}

/**
 * Turns a non-2xx into an actionable diagnosis.
 *
 * A 403 and a 404 mean completely different things — one is being refused,
 * the other has moved — and "HTTP error" tells you neither.
 */
export function describeHttpFailure(
  sourceId: string,
  status: number,
  host: string,
  extra: { bytes: number; rawPath?: string } = { bytes: 0 },
): SourceDiagnostic {
  const base = { sourceId, ok: false as const, bytes: extra.bytes, rawPath: extra.rawPath };

  if (status === 404) {
    return {
      ...base,
      note: `HTTP 404 from ${host} — the page has moved or been renamed.`,
      hints: [
        'Find the current URL in a browser and update it in the source file.',
        'Government pages are reorganised regularly; this is the expected failure over time.',
      ],
    };
  }

  if (status === 403 || status === 401) {
    return {
      ...base,
      note: `HTTP ${status} from ${host} — the request was refused, not merely unmatched.`,
      hints: [
        'Load the same URL in a browser. If it works there, the refusal is aimed at automated requests.',
        'If you are on a corporate or VPN connection, try again on a normal one — the block may be local rather than at the source.',
        'If it is the source refusing, use their published data download instead of the web page.',
      ],
    };
  }

  if (status === 429) {
    return {
      ...base,
      note: `HTTP 429 from ${host} — rate limited.`,
      hints: ['Raise THROTTLE_MS in lib/http.mts and run again in a few minutes.'],
    };
  }

  if (status >= 500) {
    return {
      ...base,
      note: `HTTP ${status} from ${host} — their server is having problems.`,
      hints: ['Nothing to fix here. Try again later.'],
    };
  }

  return {
    ...base,
    note: `HTTP ${status} from ${host}.`,
    hints: ['Unexpected status — send the saved raw response.'],
  };
}

export function describeVerdict(
  sourceId: string,
  verdict: Verdict,
  extra: { bytes: number; rawPath?: string; matched: number },
): SourceDiagnostic {
  const base = { sourceId, bytes: extra.bytes, rawPath: extra.rawPath };

  switch (verdict) {
    case 'blocked':
      return {
        ...base,
        ok: false,
        note: 'The request was blocked or challenged — this is not a parser problem.',
        hints: [
          'Try the same URL in a browser to confirm it loads for a human.',
          'If it loads fine, the block is on the automated request — slow the rate down or use the published data download instead of the web page.',
        ],
      };

    case 'js-shell':
      return {
        ...base,
        ok: false,
        note: 'Page returned markup but almost no readable text — the results are rendered by JavaScript.',
        hints: [
          'Scraping this HTML will never work, no matter how the parser is written.',
          'Find the underlying data feed: look for an "open data", "download", or XML/CSV export link on the site.',
          'Open the page in a browser, check the Network tab, and find the request that returns the results as JSON.',
        ],
      };

    case 'empty':
      return {
        ...base,
        ok: false,
        note: 'Response was too small to contain anything useful.',
        hints: ['Check the URL is still correct — it has probably moved.'],
      };

    case 'content':
      return {
        ...base,
        ok: extra.matched > 0,
        note:
          extra.matched > 0
            ? `Real content, ${extra.matched} rows extracted.`
            : 'Real content received, but the parser matched nothing — this IS a parser fix.',
        hints:
          extra.matched > 0
            ? []
            : [
                'The page loaded properly, so the extraction patterns need adjusting to the real shape.',
                'Send the saved raw file and the patterns can be rewritten against it directly.',
              ],
      };
  }
}
