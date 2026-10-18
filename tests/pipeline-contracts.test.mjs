import assert from 'node:assert/strict';
import test from 'node:test';
import {
  knowledgeSchema,
  conversationSchema,
  strictWireSchema,
  normalizeWireValue,
  validateSchema,
} from '../dist/drawing/excalidraw/contracts.js';
import { ingestConversation } from '../dist/drawing/excalidraw/conversation.js';

const base = {
  id: 'entity',
  kind: 'implementation_entity',
  title: 'Entity',
  description: 'Discussed entity',
  origin: 'user_explicit',
  sourceRefs: [{ messageId: 'm0' }],
  adoptionState: 'confirmed',
};
test('all six implementation entity contracts are representable', () => {
  const entities = [
    { subtype: 'component' },
    { subtype: 'technology', technologyName: 'SQLite' },
    { subtype: 'workflow', steps: [] },
    { subtype: 'interface', contractType: 'event' },
    { subtype: 'task', intendedAction: 'Build', completionState: 'committed' },
    { subtype: 'data_entity', fieldsMentioned: [] },
  ];
  for (const entity of entities) {
    const graph = {
      schemaVersion: '1.0',
      conversationId: 'c',
      snapshotSequence: 0,
      objects: [{ ...base, ...entity }],
      annotations: [],
      relationships: [],
      warnings: [],
    };
    assert.deepEqual(validateSchema(graph, knowledgeSchema), []);
    assert.ok(
      validateSchema({ ...graph, snapshotSequence: 0.5 }, knowledgeSchema)
        .length,
    );
  }
});
test('nullable provider fields normalize to omitted canonical optionals', () => {
  const schema = {
    type: 'object',
    properties: { required: { type: 'string' }, optional: { type: 'string' } },
    required: ['required'],
  };
  const wire = strictWireSchema(schema);
  assert.deepEqual(wire.required, ['required', 'optional']);
  assert.equal(wire.additionalProperties, false);
  assert.deepEqual(
    normalizeWireValue({ required: 'x', optional: null }, schema),
    { required: 'x' },
  );
  assert.ok(validateSchema({ optional: null }, schema).length);
});
test('ordered attributed input accepts snapshots, rejects duplicates and preserves exact content', () => {
  const input = {
    conversationId: 'c',
    snapshotSequence: 9,
    messages: [
      {
        id: 'first',
        sequence: 3,
        speaker: 'user',
        content: '  Keep spacing.  ',
      },
      { id: 'last', sequence: 9, speaker: 'system', content: '' },
    ],
  };
  assert.deepEqual(validateSchema(input, conversationSchema), []);
  assert.deepEqual(ingestConversation(input), input);
  assert.throws(
    () =>
      ingestConversation({
        ...input,
        messages: [input.messages[0], input.messages[0]],
      }),
    /duplicate|increase/,
  );
  assert.throws(
    () => ingestConversation({ ...input, snapshotSequence: 8 }),
    /snapshot/,
  );
});
