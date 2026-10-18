import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionGraph } from '../dist/step2/buildDecisionGraph.js';
import { finalizePlanningGraphs } from '../dist/step2/finalize.js';
import {
  FinalOrchestrator,
  graphPrompt,
  extractionPrompt,
} from '../dist/finalOrchestrator.js';
import { compactKnowledge, presentationContext } from '../dist/modelContext.js';
import {
  bookSwap,
  seedConversation,
  specification,
  fakeProvider,
} from './helpers.mjs';

test('canonical decision projection preserves every decision/option without a model or input mutation', async () => {
  const data = bookSwap();
  const before = structuredClone(data);
  const graph = buildDecisionGraph(data.knowledgeGraph);
  assert.deepEqual(graph, buildDecisionGraph(data.knowledgeGraph));
  const decisions = data.knowledgeGraph.objects.filter(
    (object) => object.kind === 'decision',
  );
  assert.equal(
    graph.nodes.filter((node) => node.nodeType === 'decision').length,
    decisions.length,
  );
  assert.equal(
    graph.edges.filter((edge) => edge.relation === 'has_option').length,
    decisions.flatMap((decision) => decision.options).length,
  );
  const provider = fakeProvider(
    { knowledgeGraph: data.knowledgeGraph, objectRedirects: [] },
    data.decisionGraph,
    data.implementationGraph,
  );
  const artifacts = new Map();
  const pipeline = new FinalOrchestrator({
    provider,
    specification,
    decisionBuilder: 'canonical',
    save: async (name, value) => {
      artifacts.set(name, value);
    },
  });
  const result = await pipeline.processConversation(seedConversation());
  assert.equal(
    result.step2Report.passed,
    true,
    JSON.stringify(result.step2Report),
  );
  assert.deepEqual(
    provider.calls.map((request) => request.kind),
    ['extract', 'implementation'],
  );
  assert.equal(pipeline.callsUsed, 2);
  assert.equal(
    JSON.parse(artifacts.get('step2.decision.generation.json')).callsUsed,
    0,
  );
  assert.equal(artifacts.has('step2.decision.prompt.txt'), false);
  assert.deepEqual(data, before);
});

test('selected proposals, duplicate origin labels and natural-language relation hints do not block a map', () => {
  const data = bookSwap();
  data.implementationGraph.nodes.find(
    (node) => node.id === 'ig_sqlite',
  ).primaryObjectId = 'proposal_sqlite';
  const original = data.implementationGraph.nodes.find(
    (node) => node.id === 'ig_app',
  );
  data.implementationGraph.nodes.push({
    ...structuredClone(original),
    id: 'app-copy',
    origin: 'decision_derived',
  });
  data.implementationGraph.edges.push({
    id: 'workflow-association',
    sourceNodeId: 'ig_app',
    targetNodeId: 'ig_workflow',
    relation: 'uses',
    description: 'Offers the donation and reservation workflow.',
    origin: 'planner_derived',
    justifiedByObjectIds: ['r_storage'],
  });
  data.implementationGraph.edges.push({
    ...structuredClone(data.implementationGraph.edges[0]),
    id: 'duplicate-edge',
    origin: 'planner_derived',
    primaryRelationshipId: 'r_storage',
  });
  const result = finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    data.implementationGraph,
  );
  assert.equal(
    result.validationReport.passed,
    true,
    JSON.stringify(result.validationReport),
  );
  for (const code of [
    'edge_type',
    'origin_classification',
    'relationship_justification',
    'inferred_relationship',
  ])
    assert.ok(
      result.validationReport.issues.some(
        (issue) => issue.code === code && issue.severity === 'warning',
      ),
      code,
    );
  const technology = result.planningGraphs.implementationGraph.nodes.find(
    (node) => node.id === 'ig_sqlite',
  );
  assert.equal(technology.status, 'confirmed');
  assert.equal(technology.primaryObjectId, 'proposal_sqlite');
  // Removing user adoption is not a harmless classification issue.
  data.knowledgeGraph.objects.find(
    (object) => object.id === 'decision_storage',
  ).selectedProposalId = 'proposal_csv';
  assert.equal(
    finalizePlanningGraphs(
      data.knowledgeGraph,
      data.decisionGraph,
      data.implementationGraph,
    ).validationReport.passed,
    false,
  );
});

test('normalization cannot fabricate missing evidence or let the model invent agent annotations', () => {
  const data = bookSwap();
  const node = data.implementationGraph.nodes[0];
  node.annotations = [
    { annotationId: 'fabricated', association: 'direct', viaObjectIds: [] },
  ];
  const before = structuredClone(data.knowledgeGraph);
  const result = finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    data.implementationGraph,
  );
  assert.equal(result.validationReport.passed, true);
  assert.ok(
    result.validationReport.issues.some(
      (issue) =>
        issue.code === 'builder_annotations' && issue.severity === 'warning',
    ),
  );
  assert.equal(
    result.planningGraphs.implementationGraph.nodes
      .flatMap((node) => node.annotations)
      .some((annotation) => annotation.annotationId === 'fabricated'),
    false,
  );
  assert.deepEqual(data.knowledgeGraph, before);
  node.justifiedByObjectIds.push('actually-unknown-object');
  const invalid = finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    data.implementationGraph,
  );
  assert.equal(invalid.validationReport.passed, false);
  assert.ok(
    invalid.validationReport.issues.some(
      (issue) =>
        issue.code === 'object_reference' && issue.severity === 'error',
    ),
  );
});

test('short contexts preserve facts, current selections and conditions without shipping audit copies or full architecture', () => {
  const data = bookSwap();
  const before = structuredClone(data);
  const compact = compactKnowledge(data.knowledgeGraph);
  assert.equal(compact.objects.length, data.knowledgeGraph.objects.length);
  assert.deepEqual(
    compact.warnings.map((item) => item.message),
    data.knowledgeGraph.warnings.map((item) => item.message),
  );
  for (const object of compact.objects) {
    const original = data.knowledgeGraph.objects.find(
      (item) => item.id === object.id,
    );
    assert.equal(object.description, original.description);
    assert.equal(object.selectedProposalId, original.selectedProposalId);
    assert.equal(object.state, original.state);
    assert.equal(object.adoptionState, original.adoptionState);
  }
  assert.deepEqual(
    compact.annotations.map((item) => item.conditions),
    data.knowledgeGraph.annotations.map((item) => item.conditions),
  );
  assert.doesNotMatch(
    JSON.stringify(compact),
    /"sourceRefs"|"history"|"dispositionSourceRefs"/,
  );
  const prompt = graphPrompt(
    'implementation',
    data.knowledgeGraph,
    specification,
  );
  assert.ok(
    prompt.length <
      JSON.stringify(data.knowledgeGraph, null, 2).length +
        specification.slice(
          specification.indexOf('# Part III'),
          specification.indexOf('# Part IV'),
        ).length,
  );
  assert.doesNotMatch(prompt, /Mermaid:|classDiagram/);
  assert.ok(
    extractionPrompt(seedConversation(), specification).includes(
      JSON.stringify(seedConversation()),
    ),
  );
  const graphs = finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    data.implementationGraph,
  ).planningGraphs;
  const view = presentationContext(graphs, data.knowledgeGraph);
  assert.equal(view.planningGraphs.crossGraphLinks, undefined);
  assert.ok(
    view.planningGraphs.decisionGraph.nodes.every(
      (node) => node.nodeType === 'decision',
    ),
  );
  assert.equal(view.knowledge.relationships, undefined);
  assert.ok(
    view.knowledge.objects.every((object) =>
      ['decision', 'proposal'].includes(object.kind),
    ),
  );
  assert.equal(
    view.knowledge.objects.filter((object) => object.kind === 'decision')
      .length,
    data.knowledgeGraph.objects.filter((object) => object.kind === 'decision')
      .length,
  );
  assert.deepEqual(
    view.knowledge.annotations.map((annotation) => annotation.conditions),
    data.knowledgeGraph.annotations.map((annotation) => annotation.conditions),
  );
  assert.ok(
    view.planningGraphs.implementationGraph.nodes.every(
      (node) => !('justifiedByObjectIds' in node),
    ),
  );
  assert.deepEqual(data, before);
});
