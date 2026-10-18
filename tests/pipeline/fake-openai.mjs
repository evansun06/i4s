// Explicit child-process integration-test provider. No production fallback.
import { readFile } from 'node:fs/promises';
import { defaultPresentation } from '../../dist/drawing/excalidraw/rendering/presentation.js';
import { presentationDesign } from './helpers.mjs';
const knowledge = JSON.parse(
  await readFile(
    new URL('./fixtures/step1-knowledge.json', import.meta.url),
    'utf8',
  ),
);
const planning = JSON.parse(
  await readFile(
    new URL('./fixtures/step2-planning.json', import.meta.url),
    'utf8',
  ),
);
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.openai.com/v1/chat/completions')
    throw new Error('Unexpected test URL.');
  const request = JSON.parse(options.body);
  const kind = request.response_format.json_schema.name;
  const presentationInput =
    kind === 'presentation'
      ? JSON.parse(
          request.messages[1].content
            .split('<validatedInput>')[1]
            .split('</validatedInput>')[0],
        )
      : undefined;
  if (!['extract', 'decision', 'implementation', 'presentation'].includes(kind))
    throw new Error(`Unexpected model stage: ${kind}`);
  const response = structuredClone(
    kind === 'presentation'
      ? presentationDesign(
          defaultPresentation(
            presentationInput.planningGraphs,
            presentationInput.knowledge,
          ),
        )
      : kind === 'extract'
        ? knowledge
        : kind === 'decision'
          ? planning.planningGraphs.decisionGraph
          : planning.planningGraphs.implementationGraph,
  );
  if (kind !== 'extract' && kind !== 'presentation')
    response.nodes.forEach((node) => {
      node.annotations = [];
    });
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { content: JSON.stringify(response) },
          finish_reason: 'stop',
        },
      ],
    }),
    { status: 200 },
  );
};
