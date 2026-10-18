import { agentIds, identities, resolveAgent } from '../agents/identity.js';
import type { AgentId } from '../core/types.js';
import { parseTemperatures, type TemperatureSetting } from './temperature.js';

export const commands = [
  { name: '/help', help: 'Commands and keyboard controls' },
  { name: '/pause', help: 'Pause the room and playback' },
  { name: '/resume', help: 'Resume the room and playback' },
  { name: '/budget', help: '<calls> Add to the call allowance' },
  { name: '/temp', help: '[agent|all] [0–1|reset] Boldness' },
  { name: '/think', help: '[agents] <message> Think deeply' },
  { name: '/new', help: '<message> Set the pending question aside' },
  { name: '/queue', help: 'Show queued messages' },
  { name: '/unqueue', help: 'Remove the latest queued message' },
  { name: '/quit', help: 'Save and exit' },
] as const;

export const helpText =
  commands.map(({ name, help }) => `${name}  ${help}`).join('\n') +
  '\n\nTab complete · ↑↓ suggestions/history · Esc dismiss · PgUp/PgDn scroll · Ctrl+End live · Ctrl+C quit';

export interface Completion {
  readonly label: string;
  readonly help: string;
  readonly value: string;
  readonly cursor: number;
}

export function complete(input: string, cursor = input.length): Completion[] {
  const before = input.slice(0, cursor);
  const token = /\S*$/.exec(before)?.[0] ?? '';
  const prefix = before.slice(0, before.length - token.length);
  let options: { name: string; help: string }[] = [];
  if (!prefix && token.startsWith('/')) options = [...commands];
  else if (token.startsWith('@')) {
    options = agentIds.flatMap((id) => [
      { name: `@${identities[id].name.toLowerCase()}`, help: id },
      { name: `@${id}`, help: identities[id].name },
    ]);
  } else if (/^\/(temp|think)\s/i.test(before)) {
    const args = prefix.trim().split(/\s+/).slice(1);
    const command = before.split(/\s/)[0]?.toLowerCase();
    if (args.every((arg) => resolveAgent(arg) || arg === 'all')) {
      options =
        command === '/temp' && args.length
          ? [{ name: 'reset', help: 'Normal boldness (0.5)' }]
          : [
              ...agentIds.flatMap((id) => [
                { name: identities[id].name.toLowerCase(), help: id },
                { name: id, help: identities[id].name },
              ]),
              { name: 'all', help: 'All four agents' },
              ...(command === '/temp'
                ? [{ name: 'reset', help: 'Normal boldness (0.5)' }]
                : []),
            ];
    }
  }
  return options
    .filter(({ name }) => name.startsWith(token.toLowerCase()))
    .map(({ name, help }) => {
      const completed = prefix + name + ' ';
      return {
        label: name,
        help,
        value: completed + input.slice(cursor),
        cursor: completed.length,
      };
    });
}

export type Command =
  | {
      kind: 'message';
      text: string;
      answer: boolean;
      deep?: readonly AgentId[];
    }
  | { kind: 'help' | 'pause' | 'resume' | 'queue' | 'unqueue' | 'quit' }
  | { kind: 'budget'; by: number }
  | { kind: 'temp'; settings: readonly TemperatureSetting[] }
  | { kind: 'error'; text: string };

export function parseCommand(input: string): Command {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/'))
    return { kind: 'message', text: trimmed, answer: true };
  const [head = '', ...words] = trimmed.split(/\s+/);
  const name = head.toLowerCase();
  const args = words.join(' ');
  for (const simple of [
    'help',
    'pause',
    'resume',
    'queue',
    'unqueue',
    'quit',
  ] as const) {
    if (name === `/${simple}`)
      return args
        ? { kind: 'error', text: `/${simple} takes no arguments.` }
        : { kind: simple };
  }
  if (name === '/budget') {
    const by = Number(args);
    return Number.isSafeInteger(by) && by > 0
      ? { kind: 'budget', by }
      : {
          kind: 'error',
          text: 'Use /budget <positive whole number of calls>.',
        };
  }
  if (name === '/temp') {
    const normalized = args.replace(
      /@?\b(ruby|lemon|jade|bleu)\b/gi,
      (name) => resolveAgent(name) ?? name,
    );
    const settings = args ? parseTemperatures(normalized, agentIds) : [];
    return settings
      ? { kind: 'temp', settings }
      : { kind: 'error', text: 'Use /temp [agent|all] <0–1|reset>.' };
  }
  if (name === '/new')
    return args
      ? { kind: 'message', text: args, answer: false }
      : { kind: 'error', text: 'Use /new <message> to set a question aside.' };
  if (name === '/think') {
    const deep: AgentId[] = [];
    while (words[0]) {
      const id = resolveAgent(words[0]);
      if (id) deep.push(id);
      else if (words[0].toLowerCase() !== 'all') break;
      words.shift();
    }
    return words.length
      ? {
          kind: 'message',
          text: words.join(' '),
          answer: true,
          deep: deep.length ? [...new Set(deep)] : agentIds,
        }
      : { kind: 'error', text: 'Use /think [agents] <message>.' };
  }
  return { kind: 'error', text: `Unknown command ${head}. Type /help.` };
}
