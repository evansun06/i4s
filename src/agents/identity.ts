import type { AgentId } from '../core/types.js';

export const identities = {
  red: { name: 'Ruby', asset: 'ruby' },
  yellow: { name: 'Lemon', asset: 'lemon' },
  green: { name: 'Jade', asset: 'jade' },
  blue: { name: 'Bleu', asset: 'bleu' },
} as const satisfies Record<AgentId, { name: string; asset: string }>;

export const agentIds = Object.keys(identities) as AgentId[];

/** Who each advisor is, for /about; from src/assets/README.md. */
export const about: Record<AgentId, { angle: string; summary: string }> = {
  red: {
    angle: 'Action, priorities, and results',
    summary:
      "Ruby is direct, decisive, and driven by results, embodying the book's dominant Red style. Ruby takes charge, welcomes challenges, and pushes the discussion toward action, but can come across as impatient or bossy when others need more time. Communicate with Ruby by getting to the point and making the desired outcome clear.",
  },
  yellow: {
    angle: 'Possibilities, creativity, and opportunity',
    summary:
      "Lemon is outgoing, optimistic, and persuasive, embodying the book's enthusiastic Yellow style. Lemon brings fresh ideas and contagious energy to the discussion, but can dominate the conversation or lose track of details and follow-through. Communicate with Lemon through an engaging conversation about possibilities, then agree on concrete next steps.",
  },
  green: {
    angle: 'People, trust, and continuity',
    summary:
      "Jade is patient, supportive, and steady, embodying the book's relationship-focused Green style. Jade listens closely and values cooperation and harmony, but may avoid necessary conflict or resist sudden change. Communicate with Jade calmly, make room for concerns, and explain changes one step at a time.",
  },
  blue: {
    angle: 'Evidence, precision, and feasibility',
    summary:
      "Bleu is analytical, methodical, and attentive to detail, embodying the book's careful Blue style. Bleu checks facts, questions assumptions, and values accuracy, but can get caught in perfectionism or delay decisions while looking for more evidence. Communicate with Bleu using clear reasoning, reliable facts, and time to examine the details.",
  },
};

/** /about text for the given advisors, or all four. */
export function aboutText(ids: readonly AgentId[] = agentIds): string {
  return ids
    .map(
      (id) =>
        `${identities[id].name} (${id}) · ${about[id].angle}\n${about[id].summary}`,
    )
    .join('\n\n');
}

export function resolveAgent(name: string): AgentId | undefined {
  const value = name.replace(/^@/, '').toLowerCase();
  return agentIds.find(
    (id) => id === value || identities[id].name.toLowerCase() === value,
  );
}
