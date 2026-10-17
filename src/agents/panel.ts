import type { AgentDefinition } from '../core/types.js';

export const panel = [
  { id: 'red', name: 'RED', perspective: 'Action and results' },
  { id: 'yellow', name: 'YELLOW', perspective: 'Possibility and enthusiasm' },
  { id: 'green', name: 'GREEN', perspective: 'People and continuity' },
  { id: 'blue', name: 'BLUE', perspective: 'Evidence and precision' },
] as const satisfies readonly AgentDefinition[];
