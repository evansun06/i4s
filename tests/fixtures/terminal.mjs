// Manual terminal smoke test: npm run build && node tests/fixtures/terminal.mjs
// No credentials, network, or writes to the user's sessions.
import React from 'react';
import { render } from 'ink';
import { setTimeout as delay } from 'node:timers/promises';
import { App } from '../../dist/ui/app.js';
import { ChatController } from '../../dist/ui/controller.js';
import { Orchestrator } from '../../dist/core/orchestrator.js';
import { panel } from '../../dist/agents/panel.js';
import { loadSprites } from '../../dist/ui/sprites.js';
import { createDrawingPipeline } from '../../dist/drawing/pipeline.js';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const provider = {
  async *generate(request) {
    const agent =
      panel.find((candidate) => candidate.systemPrompt === request.system)
        ?.name ?? 'Ruby';
    const text =
      request.kind === 'review'
        ? request.prompt.includes('Ruby:') && agent === 'Lemon'
          ? 'WITHDRAW'
          : 'KEEP'
        : request.prompt.includes('ask me') &&
            !request.prompt.includes('(asked the user;')
          ? 'SPEAK\nQUESTION: What would make this demo successful for you?'
          : `SPEAK\n${agent} here. I’d start with a dozen muffins and see who comes back.`;
    for (const chunk of text.match(/.{1,12}|\n/g) ?? []) {
      await delay(60, undefined, { signal: request.signal });
      yield chunk;
    }
  },
};
const engine = new Orchestrator({ agents: panel, provider, callLimit: 100 });
const temporary = await mkdtemp(join(tmpdir(), 'i4s-terminal-draw-'));
const pipelineDirectory = join(temporary, 'pipeline');
await mkdir(join(pipelineDirectory, 'src'), { recursive: true });
await writeFile(
  join(pipelineDirectory, 'package.json'),
  JSON.stringify({ type: 'module' }),
);
await copyFile(
  new URL('./draw-pipeline.mjs', import.meta.url),
  join(pipelineDirectory, 'src/cli.ts'),
);
const sessionFile = join(temporary, 'session.json');
const controller = new ChatController(engine, {
  wordsPerMinute: 800,
  save: async () => {
    await writeFile(
      sessionFile,
      JSON.stringify({
        version: 1,
        title: 'terminal-demo',
        discussion: engine.save(),
      }),
    );
  },
  draw: createDrawingPipeline({
    sessionFile,
    outputDirectory: join(temporary, 'runs'),
    entry: join(pipelineDirectory, 'src/cli.ts'),
    openAiKey: async () => 'sk-test-fake',
  }),
});
try {
  await render(
    React.createElement(App, {
      controller,
      sprites: loadSprites(),
      providerLabel: 'Local test provider · no API calls',
    }),
    {
      alternateScreen: true,
      incrementalRendering: true,
      exitOnCtrlC: false,
      maxFps: 30,
    },
  ).waitUntilExit();
} finally {
  await controller.close();
}
