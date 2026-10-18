// Test-only subprocess. No providers, network, credentials, or user-session writes.
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({
  options: {
    'session-file': { type: 'string' },
    out: { type: 'string' },
    'progress-json': { type: 'boolean' },
    'reuse-extraction': { type: 'boolean' },
  },
});
const session = JSON.parse(await readFile(values['session-file'], 'utf8'));
await mkdir(values.out, { recursive: true });
const directory = await mkdtemp(join(values.out, 'run-'));
const progress = (event) =>
  process.stderr.write(`I4S_DRAW ${JSON.stringify(event)}\n`);
progress({ type: 'run', directory });
await writeFile(
  join(directory, 'input.log.json'),
  JSON.stringify(session.discussion.log),
);
if (session.title === 'fail') {
  process.stderr.write('A controlled pipeline failure.\n');
  process.exit(1);
}
if (session.title === 'reuse') {
  if (!values['reuse-extraction'])
    throw new Error('Extraction reuse was not enabled.');
  progress({ type: 'reuse', stage: 'extract' });
  progress({ type: 'call', stage: 'implementation' });
} else progress({ type: 'call', stage: 'extract' });
if (session.title === 'terminal-demo')
  await new Promise((resolve) => setTimeout(resolve, 1500));
if (session.title === 'wait')
  await new Promise((resolve) => setTimeout(resolve, 30_000));
const maps = ['decision', 'implementation'].map((name) => ({
  name,
  heading: name === 'decision' ? 'Decision Map' : 'Implementation Map',
  cards: [
    {
      id: 'private-id',
      label: name === 'decision' ? 'Choose local storage' : 'Storage module',
      body: ['Uses local transactional storage.'],
      status: 'confirmed',
      note: false,
    },
  ],
  edges: [],
}));
if (session.title === 'terminal-demo') {
  for (const map of maps) {
    const labels =
      map.name === 'decision'
        ? [
            'Choose local storage',
            'Keep the UI same-origin',
            'Use an outbox',
            'Require version checks',
            'Deploy one image',
            'Leave provider selection open',
          ]
        : [
            'HTTP API',
            'PostgreSQL storage',
            'Outbox worker',
            'Identity boundary',
            'Delivery milestones',
            'Open provider setup',
          ];
    map.cards = labels.map((label, index) => ({
      id: `private-${index}`,
      label,
      body: [
        'A concrete implementation unit with clearly defined responsibilities.',
        'The accepted requirements motivate this part of the plan.',
        'Why: keep the architecture readable and preserve outstanding choices.',
      ],
      status: index === 5 ? 'undecided' : 'confirmed',
      note: index === 5,
    }));
    map.edges = labels.slice(0, 4).map((_, index) => ({
      source: `private-${index}`,
      target: `private-${index + 1}`,
      label: map.name === 'decision' ? '' : 'connects to',
      kind: map.name === 'decision' ? 'reading-order' : 'relationship',
    }));
  }
}
await writeFile(
  join(directory, 'terminal-maps.json'),
  JSON.stringify({ version: 1, maps }),
);
await writeFile(
  join(directory, 'completion.json'),
  JSON.stringify({ status: 'completed', callsUsed: 1 }),
);
await writeFile(
  join(directory, 'project-plan.excalidraw'),
  JSON.stringify({ type: 'excalidraw' }),
);
await writeFile(
  join(directory, 'edit.html'),
  '<!doctype html><a href="https://excalidraw.com">Go online to edit</a>',
);
