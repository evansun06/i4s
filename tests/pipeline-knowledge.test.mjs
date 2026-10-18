import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileKnowledge } from '../dist/drawing/excalidraw/step1/reconcile.js';
import { validateKnowledge } from '../dist/drawing/excalidraw/step1/validate.js';
import {
  baseObject,
  proposal,
  graphFor,
  inputFrom,
  bookSwap,
  seedConversation,
} from './pipeline/helpers.mjs';

test('missing annotation evidence flags agent-message coverage without inventing an opinion', () => {
  const input = inputFrom([
    ['user', 'Plan a cleanup.'],
    ['green', 'Which park should we clean?'],
  ]);
  const goal = baseObject('cleanup', 'goal', {
    priority: 'unspecified',
    successCriteria: [],
    state: 'active',
  });
  const result = validateKnowledge(graphFor(input, [goal]), input);
  assert.equal(result.validationReport.passed, true);
  assert.ok(
    result.validationReport.issues.some(
      (i) =>
        i.code === 'annotation_message_coverage' && i.message.includes('m1'),
    ),
  );
  assert.deepEqual(result.knowledgeGraph.annotations, []);
});

test('non-verbatim excerpts reconcile to their original cited messages with explicit warnings', () => {
  const input = seedConversation();
  const graph = bookSwap().knowledgeGraph;
  const object = graph.objects[0];
  const ref = object.sourceRefs[0];
  ref.excerpt = 'A shortened ... quote';
  const original = structuredClone(graph);
  const repaired = reconcileKnowledge(
    { knowledgeGraph: graph, objectRedirects: [] },
    input,
  );
  assert.deepEqual(graph, original);
  const output = repaired.knowledgeGraph.objects.find(
    (o) => o.id === object.id,
  );
  assert.equal(output.sourceRefs[0].messageId, ref.messageId);
  assert.equal(
    output.sourceRefs[0].excerpt,
    input.messages.find((m) => m.id === ref.messageId).content,
  );
  assert.ok(
    repaired.issues.some(
      (i) => i.code === 'source_excerpt_repaired' && i.severity === 'warning',
    ),
  );
  assert.equal(
    validateKnowledge(repaired.knowledgeGraph, input).validationReport.passed,
    true,
  );
  ref.messageId = 'nonexistent';
  const unknown = reconcileKnowledge(
    { knowledgeGraph: graph, objectRedirects: [] },
    input,
  );
  assert.ok(
    validateKnowledge(
      unknown.knowledgeGraph,
      input,
    ).validationReport.issues.some((i) => i.code === 'source_reference'),
  );
});

test('explicit selection and a later switch remain one decision with history', () => {
  const expected = bookSwap().knowledgeGraph;
  const input = seedConversation();
  const decision = expected.objects.find((o) => o.id === 'decision_storage');
  decision.selectedProposalId = 'proposal_csv';
  decision.options[0].disposition = 'selected';
  decision.options[1].disposition = 'considered';
  const reconciled = reconcileKnowledge(
    { knowledgeGraph: expected, objectRedirects: [] },
    input,
  );
  const result = validateKnowledge(reconciled.knowledgeGraph, input);
  assert.equal(
    result.validationReport.passed,
    true,
    JSON.stringify(result.validationReport),
  );
  const current = result.knowledgeGraph.objects.find(
    (o) => o.id === decision.id,
  );
  assert.equal(current.selectedProposalId, 'proposal_sqlite');
  assert.deepEqual(
    current.history.map((h) => h.selectedProposalId),
    ['proposal_csv', 'proposal_sqlite'],
  );
  assert.equal(
    result.knowledgeGraph.objects.filter((o) => o.id === decision.id).length,
    1,
  );
});

test('identity redirects merge aliases and remap all specialized references without title matching', () => {
  const input = inputFrom([
    [
      'user',
      'The API is the same component as the server. Track its risk and budget.',
    ],
  ]);
  const canonical = baseObject('component_api', 'implementation_entity', {
    subtype: 'component',
    adoptionState: 'confirmed',
  });
  const alias = { ...canonical, id: 'the_server', title: 'Server' };
  const distinct = { ...canonical, id: 'gateway', title: 'Server' };
  const risk = baseObject('risk', 'risk', {
    severity: 'unknown',
    likelihood: 'unknown',
    impact: 'Unknown',
    affectedObjectIds: ['the_server'],
  });
  const constraint = baseObject('budget', 'constraint', {
    constraintKind: 'budget',
    flexibility: 'unknown',
    expression: 'Unknown',
    appliesToObjectIds: ['the_server'],
  });
  const question = baseObject('q', 'open_question', {
    question: 'How?',
    state: 'open',
    blocking: 'unknown',
    relatedObjectIds: ['the_server'],
    answerSourceRefs: [],
  });
  const annotation = {
    id: 'a',
    agent: 'blue',
    targetObjectId: 'the_server',
    stance: 'neutral',
    reasoning: 'Discussed',
    conditions: [],
    sourceRefs: [{ messageId: 'm0' }],
    state: 'current',
  };
  const relation = {
    id: 'r',
    sourceObjectId: 'the_server',
    targetObjectId: 'risk',
    relation: 'addresses',
    origin: 'user_explicit',
    sourceRefs: [{ messageId: 'm0' }],
  };
  const graph = graphFor(
    input,
    [canonical, alias, distinct, risk, constraint, question],
    [annotation],
    [relation],
  );
  const result = reconcileKnowledge(
    {
      knowledgeGraph: graph,
      objectRedirects: [
        { fromObjectId: 'the_server', toObjectId: 'component_api' },
      ],
    },
    input,
  );
  assert.deepEqual(result.issues, []);
  assert.equal(
    result.knowledgeGraph.objects.some((o) => o.id === 'the_server'),
    false,
  );
  assert.ok(result.knowledgeGraph.objects.some((o) => o.id === 'gateway'));
  assert.equal(
    result.knowledgeGraph.annotations[0].targetObjectId,
    'component_api',
  );
  assert.equal(
    result.knowledgeGraph.relationships[0].sourceObjectId,
    'component_api',
  );
  assert.deepEqual(
    result.knowledgeGraph.objects.find((o) => o.id === 'risk')
      .affectedObjectIds,
    ['component_api'],
  );
  assert.deepEqual(
    result.knowledgeGraph.objects.find((o) => o.id === 'budget')
      .appliesToObjectIds,
    ['component_api'],
  );
  assert.deepEqual(
    result.knowledgeGraph.objects.find((o) => o.id === 'q').relatedObjectIds,
    ['component_api'],
  );
  assert.equal(graph.annotations[0].targetObjectId, 'the_server');
  assert.deepEqual(
    reconcileKnowledge(
      { knowledgeGraph: result.knowledgeGraph, objectRedirects: [] },
      input,
    ).knowledgeGraph,
    result.knowledgeGraph,
  );
});

test('decision alias merging preserves options and remaps proposal history and selection', () => {
  const input = inputFrom([
    ['user', 'Use A.'],
    ['user', 'Actually, choose B.'],
  ]);
  const decision = (id, p, sequence) =>
    baseObject(
      id,
      'decision',
      {
        question: 'Which?',
        category: 'other',
        state: 'resolved',
        options: [
          {
            proposalId: p,
            disposition: 'selected',
            dispositionSourceRefs: [{ messageId: `m${sequence}` }],
          },
        ],
        selectedProposalId: p,
        authority: 'explicit_user',
        history: [
          {
            sequence,
            selectedProposalId: p,
            changeType: 'selected',
            authority: 'explicit_user',
            sourceRefs: [{ messageId: `m${sequence}` }],
          },
        ],
      },
      `m${sequence}`,
    );
  const result = reconcileKnowledge(
    {
      knowledgeGraph: graphFor(input, [
        proposal('a'),
        proposal('b', 'm1'),
        decision('early', 'a', 0),
        decision('choice', 'b', 1),
      ]),
      objectRedirects: [{ fromObjectId: 'early', toObjectId: 'choice' }],
    },
    input,
  );
  assert.equal(
    validateKnowledge(result.knowledgeGraph, input).validationReport.passed,
    true,
  );
  const merged = result.knowledgeGraph.objects.find((o) => o.id === 'choice');
  assert.equal(merged.selectedProposalId, 'b');
  assert.equal(merged.options.length, 2);
  assert.equal(merged.history.length, 2);
});

test('ambiguous agreement and agent consensus do not establish user commitments', () => {
  const input = inputFrom([
    ['blue', 'I propose A.'],
    ['red', 'Also consider B for another question.'],
    ['user', 'Sounds good.'],
  ]);
  const graph = graphFor(input, [
    proposal('a', 'm0', 'agent_explicit'),
    baseObject(
      'choice',
      'decision',
      {
        question: 'Which?',
        category: 'other',
        state: 'open',
        options: [
          {
            proposalId: 'a',
            disposition: 'considered',
            dispositionSourceRefs: [{ messageId: 'm0' }],
          },
        ],
        authority: 'not_decided',
        history: [],
        unresolvedReason: 'Ambiguous user referent.',
      },
      'm0',
      'agent_explicit',
    ),
  ]);
  assert.equal(validateKnowledge(graph, input).validationReport.passed, true);
  graph.objects[1].state = 'resolved';
  graph.objects[1].selectedProposalId = 'a';
  graph.objects[1].options[0].disposition = 'selected';
  assert.equal(validateKnowledge(graph, input).validationReport.passed, false);
});

test('speaker attribution, exact evidence, revision chains, unknown ratings and questions validate', () => {
  const input = seedConversation(),
    graph = bookSwap().knowledgeGraph;
  assert.equal(validateKnowledge(graph, input).validationReport.passed, true);
  assert.equal(
    graph.objects.find((o) => o.id === 'risk_reservations').severity,
    'unknown',
  );
  const variants = [
    (g) => {
      g.annotations[0].agent = 'blue';
    },
    (g) => {
      g.annotations[0].sourceRefs = [
        { messageId: 'm1', excerpt: 'invented quote' },
      ];
    },
    (g) => {
      g.annotations[0].revisesAnnotationId = g.annotations[0].id;
    },
    (g) => {
      g.objects.find((o) => o.id === 'decision_storage').history[0].sequence =
        999;
    },
    (g) => {
      g.objects.find((o) => o.id === 'question_backup').state = 'answered';
    },
  ];
  for (const mutate of variants) {
    const copy = structuredClone(graph);
    mutate(copy);
    assert.equal(validateKnowledge(copy, input).validationReport.passed, false);
  }
});

test('invalid or cross-kind identity merges fail; uncertain concepts remain separate', () => {
  const input = inputFrom([['user', 'A and B may refer to different things.']]);
  const graph = graphFor(input, [proposal('a'), proposal('b')]);
  const cyclic = reconcileKnowledge(
    {
      knowledgeGraph: graph,
      objectRedirects: [
        { fromObjectId: 'a', toObjectId: 'b' },
        { fromObjectId: 'b', toObjectId: 'a' },
      ],
    },
    input,
  );
  assert.ok(cyclic.issues.some((i) => i.code === 'redirect_cycle'));
  const invalid = reconcileKnowledge(
    {
      knowledgeGraph: graph,
      objectRedirects: [{ fromObjectId: 'a', toObjectId: 'missing' }],
    },
    input,
  );
  assert.ok(invalid.issues.some((i) => i.code === 'redirect_reference'));
  const unchanged = reconcileKnowledge(
    { knowledgeGraph: graph, objectRedirects: [] },
    input,
  );
  assert.equal(unchanged.knowledgeGraph.objects.length, 2);
});

test('genuine multiple selections preserve both choices, while single-choice ambiguity fails', () => {
  const input = inputFrom([['user', 'Include both workshops and a dinner.']]);
  const options = ['workshops', 'dinner'].map((id) => ({
    proposalId: id,
    disposition: 'selected',
    dispositionSourceRefs: [{ messageId: 'm0' }],
  }));
  const decision = baseObject('activities', 'decision', {
    question: 'Which activities?',
    category: 'product',
    state: 'resolved',
    selectionMode: 'multiple',
    selectedProposalIds: ['workshops', 'dinner'],
    options,
    authority: 'explicit_user',
    history: [
      {
        sequence: 0,
        selectedProposalIds: ['workshops', 'dinner'],
        changeType: 'selected',
        authority: 'explicit_user',
        sourceRefs: [{ messageId: 'm0' }],
      },
    ],
  });
  const graph = graphFor(input, [
    proposal('workshops'),
    proposal('dinner'),
    decision,
  ]);
  const reconciled = reconcileKnowledge(
    { knowledgeGraph: graph, objectRedirects: [] },
    input,
  );
  assert.equal(
    validateKnowledge(reconciled.knowledgeGraph, input).validationReport.passed,
    true,
  );
  assert.deepEqual(
    reconciled.knowledgeGraph.objects.find((o) => o.id === 'activities')
      .selectedProposalIds,
    ['dinner', 'workshops'],
  );
  delete decision.selectionMode;
  assert.equal(validateKnowledge(graph, input).validationReport.passed, false);
});

test('proposal alias redirects collapse equivalent options and every historical reference', () => {
  const input = inputFrom([
    [
      'user',
      'The server and the API refer to the same proposed component; use it.',
    ],
  ]);
  const decision = baseObject('choice', 'decision', {
    question: 'Which component?',
    category: 'architecture',
    state: 'resolved',
    options: ['server', 'api'].map((proposalId) => ({
      proposalId,
      disposition: 'selected',
      dispositionSourceRefs: [{ messageId: 'm0' }],
    })),
    selectedProposalId: 'server',
    authority: 'explicit_user',
    history: [
      {
        sequence: 0,
        selectedProposalId: 'server',
        changeType: 'selected',
        authority: 'explicit_user',
        sourceRefs: [{ messageId: 'm0' }],
      },
    ],
  });
  const reconciled = reconcileKnowledge(
    {
      knowledgeGraph: graphFor(input, [
        proposal('api'),
        proposal('server'),
        decision,
      ]),
      objectRedirects: [{ fromObjectId: 'server', toObjectId: 'api' }],
    },
    input,
  );
  assert.equal(
    validateKnowledge(reconciled.knowledgeGraph, input).validationReport.passed,
    true,
  );
  const current = reconciled.knowledgeGraph.objects.find(
    (o) => o.id === 'choice',
  );
  assert.equal(current.options.length, 1);
  assert.equal(current.selectedProposalId, 'api');
  assert.equal(current.history[0].selectedProposalId, 'api');
});
