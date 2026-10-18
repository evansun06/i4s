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

const provider = {
  async *generate(request) {
    const agent =
      panel.find((candidate) => candidate.systemPrompt === request.system)
        ?.name ?? 'Ruby';
    const text =
      request.kind === 'review'
        ? 'REVISE\nLet’s try one small batch first.'
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
const controller = new ChatController(engine, { wordsPerMinute: 800 });
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
