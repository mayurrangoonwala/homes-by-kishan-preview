import type { Source } from './types.mts';
import { fetchMolConvictions } from './molConvictions.mts';
import { fetchJobBank } from './jobbank.mts';
import { fetchTorontoPermits } from './torontoPermits.mts';

export type { Source, SourceResult, SourceContext } from './types.mts';

export const sources: Source[] = [
  {
    id: 'mol-convictions',
    label: 'Ontario MOL convictions',
    fetch: fetchMolConvictions,
  },
  { id: 'jobbank', label: 'Job Bank Canada', fetch: fetchJobBank },
  {
    id: 'toronto-permits',
    label: 'Toronto building permits',
    fetch: fetchTorontoPermits,
  },
];
