import { readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { agentIds } from '../agents/identity.js';

export function parsePalette(source: string): ReadonlyMap<string, string> {
  const colors = new Map<string, string>();
  for (const line of source.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const channels = match.slice(1, 4).map(Number);
    if (channels.some((channel) => channel < 0 || channel > 255)) {
      throw new Error('Palette contains an invalid RGB channel.');
    }
    colors.set(
      match[4]!,
      `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`,
    );
  }
  return colors;
}

export const palette = parsePalette(
  readFileSync(
    new URL('../assets/pallette/idiots.gpl', import.meta.url),
    'utf8',
  ),
);

function color(name: string): string {
  const value = palette.get(name);
  if (!value) throw new Error(`Missing palette color: ${name}`);
  return value;
}

export const theme = {
  background: color('BG reference'),
  bright: color('UI bright'),
  text: color('UI text'),
  muted: color('UI dim'),
  border: color('UI border'),
  panel: color('UI panel'),
  agents: Object.fromEntries(
    agentIds.map((id) => {
      const title = id[0]!.toUpperCase() + id.slice(1);
      return [
        id,
        {
          base: color(`${title} Base`),
          light: color(`${title} Light`),
          glow: color(`${title} Glow`),
          panel: color(`${title} Panel`),
        },
      ];
    }),
  ) as Record<
    (typeof agentIds)[number],
    {
      base: string;
      light: string;
      glow: string;
      panel: string;
    }
  >,
};

/** Strip terminal controls from user/model text before rendering it. */
export function visibleText(text: string): string {
  return Array.from(stripVTControlCharacters(text))
    .filter((char) => char === '\n' || (char >= ' ' && char !== '\x7f'))
    .join('');
}

export function ansiColor(text: string, hex: string): string {
  if (process.env.NO_COLOR !== undefined) return text;
  const rgb = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `\x1b[38;2;${rgb.join(';')}m${text}\x1b[39m`;
}

const style = (hex: string) => (text: string) =>
  ansiColor(stripVTControlCharacters(text), hex);
export const promptTheme = {
  prefix: {
    idle: ansiColor('?', theme.muted),
    done: ansiColor('✓', theme.bright),
  },
  style: {
    message: style(theme.bright),
    answer: style(theme.text),
    highlight: style(theme.agents.blue.light),
    help: style(theme.muted),
    error: style(theme.agents.red.light),
    description: style(theme.muted),
    disabled: style(theme.muted),
    defaultAnswer: style(theme.muted),
    key: style(theme.text),
    keysHelpTip: (keys: [string, string][]) =>
      ansiColor(
        keys.map(([key, action]) => `${key} ${action}`).join(' · '),
        theme.muted,
      ),
  },
};
