import { readFileSync } from 'node:fs';
import { ingestConversation } from '../../dist/drawing/excalidraw/conversation.js';

export const specification = readFileSync(
  new URL('../../docs/excalidraw.md', import.meta.url),
  'utf8',
);
export function bookSwap() {
  return JSON.parse(
    readFileSync(
      new URL('./fixtures/book-swap.expected.json', import.meta.url),
      'utf8',
    ),
  );
}
export function seedConversation() {
  return ingestConversation(
    JSON.parse(
      readFileSync(
        new URL('./fixtures/conversation.seed.json', import.meta.url),
        'utf8',
      ),
    ),
  );
}
export function fakeProvider(extraction, decision, implementation) {
  const calls = [];
  return {
    calls,
    async *generate(request) {
      calls.push(request);
      const result =
        request.kind === 'extract'
          ? extraction
          : request.kind === 'decision'
            ? decision
            : implementation;
      const raw = typeof result === 'string' ? result : JSON.stringify(result);
      yield raw.slice(0, 80);
      yield raw.slice(80);
    },
  };
}
export function baseObject(
  id,
  kind,
  extra,
  messageId = 'm0',
  origin = 'user_explicit',
) {
  return {
    id,
    kind,
    title: id,
    description: `Discussed ${id}`,
    origin,
    sourceRefs: [{ messageId }],
    ...extra,
  };
}
export function proposal(id, messageId = 'm0', origin = 'user_explicit') {
  return baseObject(
    id,
    'proposal',
    {
      proposedBy: [origin === 'user_explicit' ? 'user' : 'blue'],
      state: 'active',
      tradeoffs: [],
    },
    messageId,
    origin,
  );
}
export function inputFrom(messages) {
  return ingestConversation(
    messages.map(([speaker, text], id) =>
      speaker === 'user'
        ? { id, kind: 'user-message', text }
        : { id, kind: 'agent-message', agent: speaker, text },
    ),
    'test',
  );
}
export function graphFor(input, objects, annotations = [], relationships = []) {
  return {
    schemaVersion: '1.0',
    conversationId: input.conversationId,
    snapshotSequence: input.snapshotSequence,
    objects,
    annotations,
    relationships,
    warnings: [],
  };
}

export function presentationDesign(plan) {
  const map = (name) => {
    const ids = new Map(
      plan[name].nodes.map((node, index) => [node.id, `c${index + 1}`]),
    );
    return {
      heading: plan[name].heading,
      nodes: plan[name].nodes.map((node) => {
        const card = { ...node, id: ids.get(node.id) };
        delete card.sourceNodeIds;
        return card;
      }),
      sourceAssignments: Object.fromEntries(
        plan[name].nodes.flatMap((node) =>
          node.sourceNodeIds.map((id) => [id, ids.get(node.id)]),
        ),
      ),
      edges: plan[name].edges,
    };
  };
  return {
    version: '5',
    decision: map('decision'),
    implementation: map('implementation'),
  };
}
