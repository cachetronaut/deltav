import type { Dimension } from './types.js';

export const defaultDimensions: readonly Dimension[] = [
  { name: 'active_agents', kind: 'concurrent' },
  { name: 'agents_total', kind: 'cumulative' },
  { name: 'delegation_depth', kind: 'concurrent' },
  { name: 'llm_calls', kind: 'cumulative' },
  { name: 'tokens_input', kind: 'cumulative' },
  { name: 'tokens_output', kind: 'cumulative' },
  { name: 'model_cost_usd', kind: 'cumulative' },
  { name: 'tool_calls', kind: 'cumulative' },
  { name: 'connector_calls', kind: 'cumulative' },
  { name: 'runtime_seconds', kind: 'cumulative' },
  { name: 'wall_clock_seconds', kind: 'cumulative' },
  { name: 'artifacts', kind: 'cumulative' },
];

export function dimensionKind(
  dimension: string,
  dimensions: readonly Dimension[] = defaultDimensions,
): Dimension['kind'] {
  return dimensions.find((candidate) => candidate.name === dimension)?.kind ?? 'cumulative';
}
