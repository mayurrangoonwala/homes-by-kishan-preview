import type { RawLead } from '../types.mts';
import type { SourceDiagnostic } from '../lib/diagnose.mts';

/**
 * Sources return results plus diagnostics rather than throwing.
 *
 * A source that fails is still informative — knowing *why* it produced nothing
 * is the whole point when the parsers have never been run against the live
 * pages. Throwing collapses "blocked", "JavaScript-rendered" and "parser is
 * wrong" into a single stack trace.
 */
export type SourceResult = {
  leads: RawLead[];
  diagnostics: SourceDiagnostic[];
};

export type SourceContext = {
  /** When set, raw payloads are written here for inspection. */
  debugDir?: string;
};

export type Source = {
  id: string;
  label: string;
  fetch: (ctx: SourceContext) => Promise<SourceResult>;
};
