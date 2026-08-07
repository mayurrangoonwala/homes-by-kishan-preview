import type { RawLead } from '../types.mts';
import { fetchMolConvictions } from './molConvictions.mts';
import { fetchJobBank } from './jobbank.mts';
import { fetchTorontoPermits } from './torontoPermits.mts';

export type Source = {
  id: string;
  label: string;
  fetch: () => Promise<RawLead[]>;
};

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
