import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleProvider } from '../dist/drawing/excalidraw/provider.js';
import { generateStructured } from '../dist/drawing/excalidraw/model.js';
import { normalizeWireValue } from '../dist/drawing/excalidraw/contracts.js';
import { strictWireSchema } from '../dist/drawing/excalidraw/contracts.js';
import { modelWireSchema } from '../dist/drawing/excalidraw/wireSchema.js';

const schema = {
  type: 'object',
  properties: { value: { type: 'string' }, optional: { type: 'string' } },
  required: ['value'],
  additionalProperties: false,
};
const request = {
  kind: 'extract',
  prompt: 'Extract.',
  system: 'Return schema-conforming JSON.',
  schema,
  maxOutputTokens: 100,
};
test('provider sends strict schemas and preserves response text for stage artifacts', async (t) => {
  let sent;
  const measurements = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        usage: {
          prompt_tokens: 123,
          completion_tokens: 45,
          private_field: 'sensitive-body-marker',
        },
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '{"value":"result","optional":null}' },
          },
        ],
      }),
    );
  });
  const raw = await generateStructured(
    new OpenAICompatibleProvider({
      apiKey: 'test-placeholder',
      model: 'test-model',
      onComplete: (value) => measurements.push(value),
    }),
    request,
  );
  assert.equal(sent.response_format.type, 'json_schema');
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.deepEqual(sent.response_format.json_schema.schema.required, [
    'value',
    'optional',
  ]);
  assert.equal(sent.max_completion_tokens, 100);
  assert.equal(sent.reasoning_effort, 'low');
  assert.equal(raw, '{"value":"result","optional":null}');
  assert.deepEqual(normalizeWireValue(JSON.parse(raw), schema), {
    value: 'result',
  });
  assert.equal(measurements.length, 1);
  const { elapsedMs, ...measurement } = measurements[0];
  assert.ok(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0);
  assert.deepEqual(measurement, {
    kind: 'extract',
    httpStatus: 200,
    inputTokens: 123,
    outputTokens: 45,
  });
});

function enumCount(value) {
  if (!value || typeof value !== 'object') return 0;
  return (
    (value.enum?.length ?? 0) +
    Object.entries(value)
      .filter(([name]) => name !== 'enum')
      .reduce((sum, [, item]) => sum + enumCount(item), 0)
  );
}

test('large repair wire schemas stay below enum limits with identical expanded constraints', async (t) => {
  const allowed = Array.from(
    { length: 70 },
    (_, index) => `knowledge-${index}`,
  );
  const large = {
    type: 'object',
    additionalProperties: false,
    required: ['nodes'],
    properties: {
      nodes: {
        type: 'array',
        minItems: 20,
        maxItems: 20,
        items: {
          anyOf: Array.from({ length: 20 }, (_, index) => ({
            type: 'object',
            additionalProperties: false,
            required: ['id', 'status'],
            properties: {
              id: { type: 'string', enum: [`node-${index}`] },
              status: { type: 'string', enum: ['confirmed'] },
              primaryObjectId: { type: 'string', enum: allowed },
              description: { type: 'string', maxLength: 200 },
            },
          })),
        },
      },
    },
  };
  const original = structuredClone(large);
  const wire = modelWireSchema(large);
  assert.ok(enumCount(strictWireSchema(large)) > 1000);
  assert.ok(enumCount(wire) < 1000);
  const expand = (value) => {
    if (Array.isArray(value)) return value.map(expand);
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) return expand(wire.$defs[value.$ref.split('/').at(-1)]);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([name]) => name !== '$defs')
        .map(([name, item]) => [name, expand(item)]),
    );
  };
  assert.deepEqual(expand(wire), strictWireSchema(large));
  assert.deepEqual(large, original);
  assert.ok(
    JSON.stringify(wire).length <
      JSON.stringify(strictWireSchema(large)).length,
  );
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(
      JSON.parse(options.body).response_format.json_schema.schema,
      wire,
    );
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
      }),
    );
  });
  await generateStructured(
    new OpenAICompatibleProvider({
      apiKey: 'test-placeholder',
      model: 'test-model',
    }),
    { ...request, schema: large },
  );
});
test('provider failures and truncated/refused output fail without exposing response bodies', async (t) => {
  const options = [
    new Response('sensitive-body-marker', { status: 401 }),
    new Response('sensitive-body-marker', { status: 400 }),
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '{}' } }],
      }),
    ),
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { refusal: 'refused' } }],
      }),
    ),
  ];
  for (const response of options) {
    const measurements = [];
    t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(
      generateStructured(
        new OpenAICompatibleProvider({
          apiKey: 'test-placeholder',
          model: 'test-model',
          onComplete: (value) => measurements.push(value),
        }),
        request,
      ),
      (error) => {
        assert.equal(error.message.includes('sensitive-body-marker'), false);
        return true;
      },
    );
    assert.equal(measurements.length, 1);
    assert.equal(measurements[0].httpStatus, response.status);
    assert.doesNotMatch(JSON.stringify(measurements), /sensitive-body-marker/);
    t.mock.restoreAll();
  }
});
