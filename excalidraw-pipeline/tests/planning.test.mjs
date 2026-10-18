import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { finalizePlanningGraphs } from '../dist/step2/finalize.js';
import { validatePlanningGraphs } from '../dist/step2/validate.js';
import { linkPlanningGraphs } from '../dist/step2/link.js';
import { edgeRepairSchema } from '../dist/step2/repairSchema.js';
import {
  implementationGraphSchema,
  validateSchema,
  strictWireSchema,
  normalizeWireValue,
} from '../dist/contracts.js';
import { bookSwap, baseObject } from './helpers.mjs';

function finish(data = bookSwap()) {
  return finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    data.implementationGraph,
  );
}
test('direct approved representations cannot be downgraded, but justified suggestions remain proposed', () => {
  for (const primaryObjectId of [
    'entity_terminal',
    'proposal_sqlite',
    'requirement_search',
  ]) {
    for (const status of ['proposed', 'undecided', 'deferred']) {
      const data = bookSwap();
      data.implementationGraph.nodes.push({
        id: 'approved-work',
        title: 'Approved deliverable',
        description: 'Directly represents the adopted work.',
        nodeType: primaryObjectId === 'entity_terminal' ? 'component' : 'task',
        primaryObjectId,
        justifiedByObjectIds: [],
        annotations: [],
        origin: 'conversation_explicit',
        status,
      });
      // Avoid duplicating an existing canonical entity role in this test.
      data.implementationGraph.nodes = data.implementationGraph.nodes.filter(
        (n) => n.id !== 'ig_app',
      );
      data.implementationGraph.edges = [];
      const result = finish(data);
      assert.ok(
        result.validationReport.issues.some(
          (issue) =>
            issue.code === 'approval_fidelity' &&
            issue.objectOrGraphIds.includes('approved-work'),
        ),
      );
      assert.equal(result.planningGraphs, undefined);
    }
  }
  const data = bookSwap();
  data.implementationGraph.nodes.push({
    id: 'inferred-search-design',
    title: 'Search usability improvement',
    description:
      'Optional search command refinements, not an approved requirement.',
    nodeType: 'task',
    origin: 'planner_suggested',
    status: 'proposed',
    justifiedByObjectIds: ['requirement_search'],
    annotations: [],
  });
  const result = finish(data);
  assert.equal(
    result.validationReport.passed,
    true,
    JSON.stringify(result.validationReport),
  );
  assert.equal(
    result.planningGraphs.implementationGraph.nodes.find(
      (n) => n.id === 'inferred-search-design',
    ).status,
    'proposed',
  );
});

test('concrete required mechanics and optional inferred interfaces remain separately grounded', () => {
  const data = bookSwap();
  for (const node of [
    {
      id: 'wire-title-filter',
      nodeType: 'task',
      title: 'Wire title filtering into the command handler',
      status: 'confirmed',
      origin: 'planner_derived',
      justifiedByObjectIds: ['requirement_search'],
    },
    {
      id: 'migration-step',
      nodeType: 'task',
      title: 'Prepare a versioned storage migration',
      status: 'proposed',
      origin: 'planner_suggested',
      justifiedByObjectIds: ['entity_sqlite', 'decision_storage'],
    },
    {
      id: 'command-interface',
      nodeType: 'interface',
      title: 'Separate command parsing from book operations',
      status: 'proposed',
      origin: 'planner_suggested',
      justifiedByObjectIds: ['entity_terminal', 'requirement_search'],
    },
  ])
    data.implementationGraph.nodes.push({
      ...node,
      description: node.title,
      annotations: [],
    });
  data.implementationGraph.edges.push({
    id: 'app-command-boundary',
    sourceNodeId: 'ig_app',
    targetNodeId: 'command-interface',
    relation: 'communicates_with',
    origin: 'planner_derived',
    justifiedByObjectIds: ['entity_terminal'],
  });
  const result = finish(data);
  assert.equal(
    result.validationReport.passed,
    true,
    JSON.stringify(result.validationReport),
  );
  const graph = result.planningGraphs.implementationGraph;
  assert.equal(
    graph.nodes.find((n) => n.id === 'wire-title-filter').status,
    'confirmed',
  );
  assert.equal(
    graph.nodes.find((n) => n.id === 'migration-step').status,
    'proposed',
  );
  assert.equal(
    graph.nodes.find((n) => n.id === 'command-interface').origin,
    'planner_suggested',
  );
  assert.ok(graph.edges.some((e) => e.id === 'app-command-boundary'));
});

test('repair freezes unaffected statuses and node coverage while allowing invalid approvals to be corrected', () => {
  const data = bookSwap();
  const broken = structuredClone(data.implementationGraph);
  const task = broken.nodes.find((n) => n.id === 'ig_search');
  task.origin = 'conversation_explicit';
  task.status = 'confirmed';
  const schema = edgeRepairSchema(
    implementationGraphSchema,
    broken,
    data.knowledgeGraph,
    [{ code: 'plan_origin', objectOrGraphIds: [task.id] }],
  );
  const repaired = structuredClone(broken);
  const fixed = repaired.nodes.find((n) => n.id === task.id);
  fixed.primaryObjectId = 'requirement_search';
  assert.deepEqual(validateSchema(repaired, schema), []);
  fixed.status = 'proposed';
  assert.ok(
    validateSchema(repaired, schema).length,
    'a provenance repair must not downgrade approved work',
  );
  fixed.status = 'confirmed';
  repaired.nodes.pop();
  assert.ok(
    validateSchema(repaired, schema).length,
    'repair must not drop an original node',
  );

  const wrong = structuredClone(data.implementationGraph);
  wrong.nodes.find((n) => n.id === 'ig_reservation_test').status = 'confirmed';
  const errors = finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    wrong,
  ).validationReport.issues.filter((i) => i.severity === 'error');
  assert.ok(errors.some((i) => i.code === 'plan_status'));
  const correction = edgeRepairSchema(
    implementationGraphSchema,
    wrong,
    data.knowledgeGraph,
    errors,
  );
  assert.deepEqual(
    validateSchema(data.implementationGraph, correction),
    [],
    'a reported invalid approval must still be correctable',
  );
});

test('approval-fidelity repairs require confirmed status for the same canonical primary', () => {
  const data = bookSwap();
  const broken = structuredClone(data.implementationGraph);
  broken.nodes.find((n) => n.id === 'ig_app').status = 'proposed';
  const errors = finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    broken,
  ).validationReport.issues.filter((i) => i.severity === 'error');
  const schema = edgeRepairSchema(
    implementationGraphSchema,
    broken,
    data.knowledgeGraph,
    errors,
  );
  assert.ok(validateSchema(broken, schema).length);
  assert.deepEqual(validateSchema(data.implementationGraph, schema), []);
});

test('edge repair accepts coarse relation types but forbids unknown endpoints, identity changes and mismatched canonical references', () => {
  const data = bookSwap();
  const schema = edgeRepairSchema(
    implementationGraphSchema,
    data.implementationGraph,
    data.knowledgeGraph,
    [{ code: 'edge_type' }],
  );
  assert.deepEqual(validateSchema(data.implementationGraph, schema), []);
  for (const [sourceNodeId, targetNodeId, relation] of [
    ['ig_sqlite', 'ig_book', 'uses'],
    ['ig_app', 'ig_workflow', 'uses'],
    ['ig_app', 'ig_search', 'implements'],
    ['ig_workflow', 'ig_search', 'contains'],
  ]) {
    const bad = structuredClone(data.implementationGraph);
    bad.edges.push({
      id: 'bad',
      sourceNodeId,
      targetNodeId,
      relation,
      origin: 'planner_derived',
      justifiedByObjectIds: ['decision_storage'],
    });
    assert.deepEqual(validateSchema(bad, schema), []);
    bad.edges.at(-1).targetNodeId = 'missing-node';
    assert.ok(validateSchema(bad, schema).length);
  }
  const changed = structuredClone(data.implementationGraph);
  changed.nodes[0].nodeType = 'task';
  assert.ok(validateSchema(changed, schema).length);
  const wrongRef = structuredClone(data.implementationGraph);
  wrongRef.edges[0].primaryRelationshipId = 'r_storage';
  assert.ok(validateSchema(wrongRef, schema).length);
  assert.deepEqual(
    normalizeWireValue(data.implementationGraph, schema),
    data.implementationGraph,
  );
  assert.ok(strictWireSchema(schema));
});
test('inference labels and relation-type hints are normalized or warned without a model repair', () => {
  const data = bookSwap();
  const broken = structuredClone(data.implementationGraph);
  const node = broken.nodes.find((n) => n.id === 'ig_backup');
  delete node.primaryObjectId;
  node.origin = 'conversation_explicit';
  broken.edges.push({
    id: 'workflow_contains_task',
    sourceNodeId: 'ig_workflow',
    targetNodeId: 'ig_backup',
    relation: 'contains',
    origin: 'planner_derived',
    justifiedByObjectIds: ['question_backup'],
  });
  const result = finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    broken,
  );
  assert.equal(result.validationReport.passed, true);
  assert.ok(
    result.validationReport.issues.some(
      (e) => e.code === 'inferred_origin' && e.severity === 'warning',
    ),
  );
  assert.ok(
    result.validationReport.issues.some(
      (e) => e.code === 'edge_type' && e.severity === 'warning',
    ),
  );
  assert.deepEqual(validateSchema(broken, implementationGraphSchema), []);
  const schema = edgeRepairSchema(
    implementationGraphSchema,
    broken,
    data.knowledgeGraph,
    [],
  );
  assert.deepEqual(validateSchema(broken, schema), []);
  assert.deepEqual(validateSchema(data.implementationGraph, schema), []);
  const wrong = structuredClone(data.implementationGraph);
  wrong.edges.push({
    id: 'stale_relationship',
    sourceNodeId: 'ig_app',
    targetNodeId: 'ig_book',
    relation: 'uses',
    primaryRelationshipId: 'r_uses',
    origin: 'knowledge_derived',
    justifiedByObjectIds: ['decision_storage'],
  });
  assert.ok(validateSchema(wrong, schema).length);
});
test('failed validation retains linked diagnostics without publishing invalid graphs', () => {
  const data = bookSwap();
  data.implementationGraph.nodes.find(
    (n) => n.id === 'ig_reservation_test',
  ).status = 'confirmed';
  let diagnostic;
  const result = finalizePlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    data.implementationGraph,
    (value) => {
      diagnostic = value;
    },
  );
  assert.equal(result.validationReport.passed, false);
  assert.equal(result.planningGraphs, undefined);
  assert.equal(diagnostic.validated, false);
  assert.ok(
    diagnostic.candidate.decisionGraph.nodes.some((n) => n.annotations.length),
  );
  assert.ok(
    diagnostic.candidate.implementationGraph.nodes.some(
      (n) => n.annotations.length,
    ),
  );
});
test('standalone proposal option nodes are rejected', () => {
  const data = bookSwap();
  const option = structuredClone(
    data.decisionGraph.nodes.find((n) => n.nodeType === 'option'),
  );
  option.id = 'orphan';
  // A different role identity is not needed: remove the original parent edge.
  data.decisionGraph.edges = data.decisionGraph.edges.filter(
    (e) =>
      e.targetNodeId !== option.id &&
      e.targetNodeId !==
        data.decisionGraph.nodes.find((n) => n.nodeType === 'option').id,
  );
  assert.ok(
    finish(data).validationReport.issues.some(
      (i) => i.code === 'orphan_option',
    ),
  );
});
test('both graphs resolve canonical opinions and cross-links without copying reasoning', () => {
  const result = finish();
  assert.equal(
    result.validationReport.passed,
    true,
    JSON.stringify(result.validationReport),
  );
  const graphs = result.planningGraphs;
  assert.ok(
    graphs.decisionGraph.nodes
      .find((n) => n.id === 'dg_sqlite')
      .annotations.some((a) => a.association === 'direct'),
  );
  assert.ok(
    graphs.implementationGraph.nodes
      .find((n) => n.id === 'ig_sqlite')
      .annotations.some(
        (a) =>
          a.association === 'inherited' &&
          a.viaObjectIds.includes('proposal_sqlite'),
      ),
  );
  assert.equal(
    graphs.crossGraphLinks.links.some(
      (l) => l.implementationNodeId === 'ig_search',
    ),
    false,
  );
  assert.ok(graphs.crossGraphLinks.byDecisionNodeId.dg_storage.length);
  assert.ok(graphs.crossGraphLinks.byImplementationNodeId.ig_sqlite.length);
  assert.equal(
    validatePlanningGraphs(graphs, bookSwap().knowledgeGraph).passed,
    true,
  );
});

test('serialized Step 2 output matches the deterministic handoff snapshot', async () => {
  const snapshot = JSON.parse(
    await readFile(
      new URL('./fixtures/book-swap.step2.snapshot.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(finish(), snapshot);
});
test('reconciliation merges duplicate canonical roles, repairs endpoints and relinks', () => {
  const data = bookSwap();
  const original = data.implementationGraph.nodes.find(
    (n) => n.id === 'ig_sqlite',
  );
  data.implementationGraph.nodes.push({
    ...structuredClone(original),
    id: 'duplicate_sqlite',
  });
  data.implementationGraph.edges.push({
    ...data.implementationGraph.edges[0],
    id: 'duplicate_edge',
    targetNodeId: 'duplicate_sqlite',
  });
  const result = finish(data);
  assert.equal(
    result.validationReport.passed,
    true,
    JSON.stringify(result.validationReport),
  );
  assert.equal(
    result.planningGraphs.implementationGraph.nodes.filter(
      (n) => n.primaryObjectId === 'entity_sqlite',
    ).length,
    1,
  );
  assert.equal(
    result.planningGraphs.implementationGraph.edges.filter(
      (e) =>
        e.relation === 'uses' &&
        ['ig_sqlite', 'duplicate_sqlite'].includes(e.targetNodeId),
    ).length,
    1,
  );
  assert.ok(
    result.planningGraphs.crossGraphLinks.links.some(
      (l) => l.implementationNodeId === 'duplicate_sqlite',
    ),
  );
  assert.equal(
    result.planningGraphs.crossGraphLinks.links.some(
      (l) => l.implementationNodeId === 'ig_sqlite',
    ),
    false,
  );
});
function milestonePlan() {
  const data = bookSwap();
  for (const [index, title] of [
    'Create storage',
    'Implement reservations',
    'Verify persistence',
  ].entries())
    data.implementationGraph.nodes.push({
      id: `phase-${index + 1}`,
      title,
      description: `Delivery phase: ${title}.`,
      nodeType: 'milestone',
      primaryObjectId: 'proposal_sqlite',
      justifiedByObjectIds: ['decision_storage'],
      annotations: [],
      origin: 'conversation_explicit',
      status: 'confirmed',
    });
  for (const index of [1, 2])
    data.implementationGraph.edges.push({
      id: `phase-order-${index}`,
      sourceNodeId: `phase-${index}`,
      targetNodeId: `phase-${index + 1}`,
      relation: 'precedes',
      origin: 'planner_derived',
      justifiedByObjectIds: ['decision_storage'],
    });
  return data;
}

test('distinct milestones backed by one proposal retain identity, ordering and links', () => {
  const data = milestonePlan();
  const before = structuredClone(data);
  const result = finish(data);
  assert.equal(
    result.validationReport.passed,
    true,
    JSON.stringify(result.validationReport),
  );
  assert.deepEqual(data, before);
  const graphs = result.planningGraphs;
  assert.equal(
    graphs.implementationGraph.nodes.filter((n) => n.nodeType === 'milestone')
      .length,
    3,
  );
  for (const index of [1, 2]) {
    const edge = graphs.implementationGraph.edges.find(
      (e) => e.id === `phase-order-${index}`,
    );
    assert.equal(edge.sourceNodeId, `phase-${index}`);
    assert.equal(edge.targetNodeId, `phase-${index + 1}`);
  }
  for (const index of [1, 2, 3])
    assert.ok(
      graphs.crossGraphLinks.links.some(
        (link) => link.implementationNodeId === `phase-${index}`,
      ),
    );
  const draft = (graph) => ({
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, annotations: [] })),
  });
  assert.deepEqual(
    finalizePlanningGraphs(
      data.knowledgeGraph,
      draft(graphs.decisionGraph),
      draft(graphs.implementationGraph),
    ).planningGraphs,
    graphs,
  );
});

test('broad-source duplicates require exact descriptions, but exact copies still merge', () => {
  const data = milestonePlan();
  const first = data.implementationGraph.nodes.find((n) => n.id === 'phase-1');
  data.implementationGraph.nodes.push({
    ...structuredClone(first),
    id: 'zz-phase-copy',
  });
  data.implementationGraph.nodes.push({
    ...structuredClone(first),
    id: 'different-phase',
    description: 'A different deliverable with the same short title.',
  });
  const result = finish(data);
  assert.equal(
    result.validationReport.passed,
    true,
    JSON.stringify(result.validationReport),
  );
  const nodes = result.planningGraphs.implementationGraph.nodes;
  assert.ok(nodes.some((n) => n.id === 'phase-1'));
  assert.ok(nodes.some((n) => n.id === 'different-phase'));
  assert.ok(!nodes.some((n) => n.id === 'zz-phase-copy'));
});

test('a genuine milestone dependency cycle still blocks the handoff', () => {
  const data = milestonePlan();
  data.implementationGraph.edges.push({
    id: 'backwards-phase',
    sourceNodeId: 'phase-3',
    targetNodeId: 'phase-1',
    relation: 'precedes',
    origin: 'planner_derived',
    justifiedByObjectIds: ['decision_storage'],
  });
  const result = finish(data);
  assert.equal(result.planningGraphs, undefined);
  assert.ok(
    result.validationReport.issues.some(
      (issue) => issue.code === 'prerequisite_cycle',
    ),
  );
});

test('graph ID changes recompute links through unchanged knowledge IDs', () => {
  const data = bookSwap();
  const first = finish(data).planningGraphs;
  data.decisionGraph.nodes.forEach((n) => {
    n.id = `new_${n.id}`;
  });
  data.decisionGraph.edges.forEach((e) => {
    e.sourceNodeId = `new_${e.sourceNodeId}`;
    e.targetNodeId = `new_${e.targetNodeId}`;
  });
  const next = finish(data).planningGraphs;
  assert.deepEqual(
    first.crossGraphLinks.links.map((l) => l.viaKnowledgeObjectId),
    next.crossGraphLinks.links.map((l) => l.viaKnowledgeObjectId),
  );
  assert.ok(
    next.crossGraphLinks.links.every((l) =>
      l.decisionNodeId.startsWith('new_'),
    ),
  );
});
test('direct association wins, inheritance is one-hop, and historical annotations survive', () => {
  const data = bookSwap();
  const node = data.implementationGraph.nodes.find((n) => n.id === 'ig_sqlite');
  const blue = data.knowledgeGraph.annotations.find(
    (a) => a.id === 'a_blue_sqlite',
  );
  blue.targetObjectId = 'entity_sqlite';
  node.justifiedByObjectIds.push('entity_sqlite');
  const result = finish(data).planningGraphs;
  assert.deepEqual(
    result.implementationGraph.nodes
      .find((n) => n.id === 'ig_sqlite')
      .annotations.find((a) => a.annotationId === blue.id),
    { annotationId: blue.id, association: 'direct', viaObjectIds: [] },
  );
  assert.ok(
    result.decisionGraph.nodes
      .find((n) => n.id === 'dg_csv')
      .annotations.some((a) => a.annotationId === 'a_red_csv'),
  );
  node.justifiedByObjectIds = ['decision_storage'];
  blue.targetObjectId = 'proposal_sqlite';
  assert.deepEqual(
    finish(data).planningGraphs.implementationGraph.nodes.find(
      (n) => n.id === node.id,
    ).annotations,
    [],
  );
});
test('final validation rejects corrupt associations and cross-link indexes', () => {
  const kg = bookSwap().knowledgeGraph;
  const output = finish().planningGraphs;
  output.implementationGraph.nodes[0].annotations[0].viaObjectIds = ['missing'];
  assert.equal(validatePlanningGraphs(output, kg).passed, false);
  const broken = finish().planningGraphs;
  broken.crossGraphLinks.links[0].viaKnowledgeObjectId = 'missing';
  assert.equal(validatePlanningGraphs(broken, kg).passed, false);
});
test('broken references, invalid decision membership, cycles and false commitments still block output', () => {
  const cases = [
    (d) => {
      d.decisionGraph.edges[0].sourceNodeId = 'dg_terminal';
    },
    (d) => {
      d.implementationGraph.edges[0].targetNodeId = 'missing';
    },
    (d) => {
      d.implementationGraph.edges.push({
        id: 'cycle',
        sourceNodeId: 'ig_backup_choice',
        targetNodeId: 'ig_backup',
        relation: 'depends_on',
        origin: 'planner_derived',
        justifiedByObjectIds: ['question_backup'],
      });
    },
    (d) => {
      d.knowledgeGraph.objects.find(
        (o) => o.id === 'entity_sqlite',
      ).adoptionState = 'rejected';
    },
    (d) => {
      d.implementationGraph.nodes.find(
        (n) => n.id === 'ig_reservation_test',
      ).status = 'confirmed';
    },
    (d) => {
      d.decisionGraph.edges = d.decisionGraph.edges.filter(
        (e) => e.id !== 'de_browser',
      );
    },
  ];
  for (const mutate of cases) {
    const data = bookSwap();
    mutate(data);
    const result = finish(data);
    assert.equal(result.validationReport.passed, false, JSON.stringify(result));
    assert.equal(result.planningGraphs, undefined);
  }
});
test('linker does not create internal topology', () => {
  const data = bookSwap();
  const linked = linkPlanningGraphs(
    data.knowledgeGraph,
    data.decisionGraph,
    data.implementationGraph,
  );
  assert.deepEqual(linked.decisionGraph.edges, data.decisionGraph.edges);
  assert.deepEqual(
    linked.implementationGraph.edges,
    data.implementationGraph.edges,
  );
});

test('negative scope and rejected options cannot become confirmed implementation', () => {
  const rejected = bookSwap();
  rejected.implementationGraph.nodes.push({
    id: 'browser',
    nodeType: 'component',
    title: 'Browser UI',
    description: 'Unapproved UI',
    primaryObjectId: 'proposal_browser',
    origin: 'conversation_explicit',
    status: 'confirmed',
    justifiedByObjectIds: [],
    annotations: [],
  });
  assert.equal(finish(rejected).validationReport.passed, false);
  const negativeScope = bookSwap();
  negativeScope.knowledgeGraph.objects.push(
    baseObject('auth', 'implementation_entity', {
      subtype: 'component',
      adoptionState: 'confirmed',
    }),
  );
  negativeScope.knowledgeGraph.relationships.push({
    id: 'no_auth',
    sourceObjectId: 'auth',
    targetObjectId: 'constraint_scope',
    relation: 'conflicts_with',
    origin: 'conversation_inferred',
    sourceRefs: [{ messageId: 'm0' }],
  });
  negativeScope.implementationGraph.nodes.push({
    id: 'ig_auth',
    nodeType: 'component',
    title: 'Accounts',
    description: 'Contradicts no-accounts scope',
    primaryObjectId: 'auth',
    origin: 'conversation_explicit',
    status: 'confirmed',
    justifiedByObjectIds: [],
    annotations: [],
  });
  assert.ok(
    finish(negativeScope).validationReport.issues.some(
      (i) => i.code === 'constraint_conflict',
    ),
  );
});
