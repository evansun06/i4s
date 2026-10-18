import { DEFAULT_TEMPERATURE } from '../agents/prompts.js';
import type { AgentId } from '../core/types.js';

export interface TemperatureSetting {
  readonly target: AgentId | 'all';
  readonly value: number;
}

/**
 * Parses "0.7" (everyone), "yellow 0.9", "@yellow 0.9", or a comma-separated
 * list such as "yellow=0.9, blue=0.2". "reset" in place of a number means
 * the default, 0.5. Returns undefined if anything is off.
 */
export function parseTemperatures(
  spec: string,
  ids: readonly AgentId[],
): TemperatureSetting[] | undefined {
  const settings: TemperatureSetting[] = [];
  for (const part of spec.split(',')) {
    const match = /^(?:@?(\w+)\s*(?:=|\s)\s*)?(\d*\.?\d+|reset)$/i.exec(
      part.trim(),
    );
    if (!match?.[2]) return undefined;
    const value =
      match[2].toLowerCase() === 'reset'
        ? DEFAULT_TEMPERATURE
        : Number(match[2]);
    if (value < 0 || value > 1) return undefined;
    const name = match[1]?.toLowerCase();
    if (name === undefined || name === 'all') {
      settings.push({ target: 'all', value });
      continue;
    }
    const target = ids.find((id) => id === name);
    if (!target) return undefined;
    settings.push({ target, value });
  }
  return settings;
}
