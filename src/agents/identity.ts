import type { AgentId } from '../core/types.js';

export const identities = {
  red: { name: 'Ruby', asset: 'ruby' },
  yellow: { name: 'Lemon', asset: 'lemon' },
  green: { name: 'Jade', asset: 'jade' },
  blue: { name: 'Bleu', asset: 'bleu' },
} as const satisfies Record<AgentId, { name: string; asset: string }>;

export const agentIds = Object.keys(identities) as AgentId[];

export function resolveAgent(name: string): AgentId | undefined {
  const value = name.replace(/^@/, '').toLowerCase();
  return agentIds.find(
    (id) => id === value || identities[id].name.toLowerCase() === value,
  );
}
