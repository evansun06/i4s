import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  FinalOrchestrator,
  graphPrompt,
  extractionPrompt,
} from '../dist/drawing/excalidraw/finalOrchestrator.js';
import {
  finalResultSchema,
  validateSchema,
} from '../dist/drawing/excalidraw/contracts.js';
import {
  specification,
  seedConversation,
  bookSwap,
  fakeProvider,
  inputFrom,
  baseObject,
  graphFor,
} from './pipeline/helpers.mjs';

test('prompts preserve adopted work and request ambitious inference only in implementation', () => {
  const data = bookSwap();
  const extraction = extractionPrompt(seedConversation(), specification);
  assert.match(
    extraction,
    /individually described deliverables as task implementation entities/,
  );
  assert.match(extraction, /Partial approval must not/);
  const implementation = graphPrompt(
    'implementation',
    data.knowledgeGraph,
    specification,
  );
  assert.match(
    implementation,
    /IMPLEMENTATION INFERENCE — BE USEFULLY AMBITIOUS/,
  );
  assert.match(
    implementation,
    /persistence\/migrations, transaction and concurrency/,
  );
  assert.match(implementation, /planner_suggested\/proposed/);
  assert.match(implementation, /<approvedImplementationObjects>/);
  assert.match(implementation, /"id":"requirement_search"/);
  assert.match(implementation, /NOT a way to borrow approval/);
  const decision = graphPrompt('decision', data.knowledgeGraph, specification);
  assert.doesNotMatch(
    decision,
    /<approvedImplementationObjects>|IMPLEMENTATION INFERENCE — BE USEFULLY AMBITIOUS/,
  );
});

test('provenance repair retains approved work and locally rejects status downgrades or dropped nodes', async () => {
  for (const corrupt of [false, 'downgrade', 'drop']) {
    const data = bookSwap();
    const broken = structuredClone(data.implementationGraph);
    const task = broken.nodes.find((n) => n.id === 'ig_search');
    task.origin = 'conversation_explicit';
    task.status = 'confirmed';
    task.primaryObjectId = 'missing-approved-reference';
    let attempts = 0;
    const artifacts = new Map();
    const provider = {
      async *generate(request) {
        if (request.kind === 'extract')
          yield JSON.stringify({
            knowledgeGraph: data.knowledgeGraph,
            objectRedirects: [],
          });
        else if (request.kind === 'decision')
          yield JSON.stringify(data.decisionGraph);
        else if (attempts++ === 0) yield JSON.stringify(broken);
        else {
          const fixed = structuredClone(broken);
          const node = fixed.nodes.find((n) => n.id === task.id);
          node.primaryObjectId = 'requirement_search';
          if (corrupt === 'downgrade') node.status = 'proposed';
          if (corrupt === 'drop')
            fixed.nodes = fixed.nodes.filter((n) => n.id !== task.id);
          yield JSON.stringify(fixed);
        }
      },
    };
    const pipeline = new FinalOrchestrator({
      provider,
      specification,
      save: async (name, value) => {
        artifacts.set(name, value);
      },
    });
    const result = await pipeline.processConversation(seedConversation());
    assert.equal(pipeline.callsUsed, 4);
    if (!corrupt) {
      assert.equal(
        result.step2Report.passed,
        true,
        JSON.stringify(result.step2Report),
      );
      const fixed = result.planningGraphs.implementationGraph.nodes.find(
        (n) => n.id === task.id,
      );
      assert.equal(fixed.status, 'confirmed');
      assert.equal(fixed.primaryObjectId, 'requirement_search');
    } else {
      assert.equal(result.planningGraphs, undefined);
      assert.ok(
        result.step2Report.issues.some(
          (issue) => issue.code === 'step2_repair_generation',
        ),
      );
      assert.ok(artifacts.has('step2.implementation.repair.response.json'));
    }
  }
});

test('coarse edge categories and redundant membership attribution do not trigger model repairs', async () => {
  const data = bookSwap(),
    artifacts = new Map(),
    calls = [];
  const corruptDecision = structuredClone(data.decisionGraph);
  corruptDecision.edges.find(
    (e) => e.relation === 'has_option',
  ).primaryRelationshipId = 'r_storage';
  const corruptImplementation = structuredClone(data.implementationGraph);
  const cases = [
    ['ig_backup', 'ig_sqlite', 'uses'],
    ['ig_sqlite', 'ig_book', 'uses'],
    ['ig_sqlite', 'ig_reservation', 'uses'],
    ['ig_app', 'ig_search', 'implements'],
    ['ig_app', 'ig_workflow', 'implements'],
    ['ig_reservation_test', 'ig_reservation', 'depends_on'],
    ['ig_workflow', 'ig_backup', 'contains'],
    ['ig_workflow', 'ig_search', 'contains'],
  ];
  corruptImplementation.edges.push(
    ...cases.map(([sourceNodeId, targetNodeId, relation], i) => ({
      id: `live_failure_${i}`,
      sourceNodeId,
      targetNodeId,
      relation,
      origin: 'planner_derived',
      justifiedByObjectIds: ['decision_storage'],
    })),
  );
  const provider = {
    async *generate(request) {
      const previous = calls.filter((c) => c.kind === request.kind).length;
      calls.push(request);
      yield JSON.stringify(
        request.kind === 'extract'
          ? { knowledgeGraph: data.knowledgeGraph, objectRedirects: [] }
          : request.kind === 'decision'
            ? previous
              ? data.decisionGraph
              : corruptDecision
            : previous
              ? data.implementationGraph
              : corruptImplementation,
      );
    },
  };
  const pipeline = new FinalOrchestrator({
    provider,
    specification,
    save: async (n, v) => {
      artifacts.set(n, v);
    },
  });
  const result = await pipeline.processConversation(seedConversation());
  assert.equal(
    result.step2Report.passed,
    true,
    JSON.stringify(result.step2Report),
  );
  assert.equal(pipeline.callsUsed, 3);
  const first = result.step2Report;
  assert.equal(first.issues.filter((i) => i.code === 'edge_type').length, 8);
  assert.ok(first.issues.some((i) => i.code === 'canonical_membership'));
  assert.equal(
    first.issues.some((i) => i.severity === 'error'),
    false,
  );
  assert.equal(artifacts.has('step2.decision.repair.response.json'), false);
  assert.equal(
    artifacts.has('step2.implementation.repair.response.json'),
    false,
  );
  assert.equal(
    JSON.parse(artifacts.get('step2.candidate.json')).validated,
    true,
  );
});

test('repair remains bounded and never publishes an invalid graph or spends beyond its budget', async () => {
  for (const callLimit of [3, 4, 5]) {
    const data = bookSwap(),
      calls = [];
    data.implementationGraph.edges[0].targetNodeId = 'missing';
    const provider = {
      async *generate(request) {
        calls.push(request);
        yield JSON.stringify(
          request.kind === 'extract'
            ? { knowledgeGraph: data.knowledgeGraph, objectRedirects: [] }
            : request.kind === 'decision'
              ? data.decisionGraph
              : data.implementationGraph,
        );
      },
    };
    const pipeline = new FinalOrchestrator({
      provider,
      specification,
      callLimit,
    });
    const result = await pipeline.processConversation(seedConversation());
    assert.equal(result.step2Report.passed, false);
    assert.equal(result.planningGraphs, undefined);
    assert.equal(calls.filter((c) => c.kind === 'decision').length, 1);
    assert.equal(
      calls.filter((c) => c.kind === 'implementation').length,
      callLimit === 3 ? 1 : 2,
    );
    assert.ok(pipeline.callsUsed <= callLimit);
  }
});

test('unknown endpoints still receive a constrained repair within the existing call budget', async () => {
  const data = bookSwap();
  const broken = structuredClone(data.implementationGraph);
  const backup = broken.nodes.find((n) => n.id === 'ig_backup');
  delete backup.primaryObjectId;
  backup.origin = 'conversation_explicit';
  broken.edges.push({
    id: 'invalid_workflow_task',
    sourceNodeId: 'ig_workflow',
    targetNodeId: 'missing-endpoint',
    relation: 'produces',
    origin: 'planner_derived',
    justifiedByObjectIds: ['question_backup'],
  });
  let attempts = 0;
  const provider = {
    async *generate(request) {
      if (request.kind === 'extract')
        yield JSON.stringify({
          knowledgeGraph: data.knowledgeGraph,
          objectRedirects: [],
        });
      else if (request.kind === 'decision')
        yield JSON.stringify(data.decisionGraph);
      else if (attempts++ === 0) yield JSON.stringify(broken);
      else {
        assert.ok(
          validateSchema(broken, request.schema).length,
          'repair must reject the original invalid endpoints',
        );
        assert.deepEqual(
          validateSchema(data.implementationGraph, request.schema),
          [],
        );
        yield JSON.stringify(data.implementationGraph);
      }
    },
  };
  const pipeline = new FinalOrchestrator({ provider, specification });
  const result = await pipeline.processConversation(seedConversation());
  assert.equal(
    result.step2Report.passed,
    true,
    JSON.stringify(result.step2Report),
  );
  assert.equal(pipeline.callsUsed, 4);
});

test('Step 1 repairs contradictory rejection metadata without bypassing authority checks', async () => {
  const data = bookSwap(),
    artifacts = new Map(),
    calls = [];
  const broken = structuredClone(data.knowledgeGraph);
  broken.relationships.push({
    id: 'superseded_is_not_rejected',
    sourceObjectId: 'decision_storage',
    targetObjectId: 'proposal_csv',
    relation: 'rejects',
    origin: 'user_explicit',
    sourceRefs: [{ messageId: 'm10' }],
  });
  const provider = {
    async *generate(request) {
      const prior = calls.filter((c) => c.kind === request.kind).length;
      calls.push(request);
      yield JSON.stringify(
        request.kind === 'extract'
          ? {
              knowledgeGraph: prior ? data.knowledgeGraph : broken,
              objectRedirects: [],
            }
          : request.kind === 'decision'
            ? data.decisionGraph
            : data.implementationGraph,
      );
    },
  };
  const pipeline = new FinalOrchestrator({
    provider,
    specification,
    save: async (n, v) => {
      artifacts.set(n, v);
    },
  });
  const result = await pipeline.processConversation(seedConversation());
  assert.equal(result.step1Report.passed, true);
  assert.equal(result.step2Report.passed, true);
  assert.equal(pipeline.callsUsed, 4);
  assert.deepEqual(
    calls.map((c) => c.kind),
    ['extract', 'extract', 'decision', 'implementation'],
  );
  assert.ok(
    JSON.parse(artifacts.get('step1.initial.validation.json')).issues.some(
      (i) => i.code === 'rejection_relationship',
    ),
  );
  assert.ok(artifacts.has('step1.repair.response.json'));
  assert.equal(
    result.knowledgeGraph.relationships.some(
      (r) => r.id === 'superseded_is_not_rejected',
    ),
    false,
  );
});

test('a failed repair preserves the sibling response and returns a structured failure', async () => {
  const data = bookSwap(),
    artifacts = new Map();
  let attempts = 0;
  const provider = {
    async *generate(request) {
      if (request.kind === 'extract') {
        yield JSON.stringify({
          knowledgeGraph: data.knowledgeGraph,
          objectRedirects: [],
        });
      } else if (request.kind === 'decision') {
        yield JSON.stringify(data.decisionGraph);
      } else {
        if (attempts++ > 0) throw new Error('Repair unavailable.');
        const draft = structuredClone(data.implementationGraph);
        draft.edges[0].targetNodeId = 'missing';
        yield JSON.stringify(draft);
      }
    },
  };
  const pipeline = new FinalOrchestrator({
    provider,
    specification,
    save: async (n, v) => {
      artifacts.set(n, v);
    },
  });
  const result = await pipeline.processConversation(seedConversation());
  assert.equal(result.step2Report.passed, false);
  assert.ok(
    result.step2Report.issues.some((i) => i.code === 'step2_repair_generation'),
  );
  assert.equal(result.planningGraphs, undefined);
  assert.equal(pipeline.callsUsed, 4);
  assert.ok(artifacts.has('step2.decision.response.json'));
  assert.ok(artifacts.has('step2.initial.candidate.json'));
});

test('real stage sequence with fake providers consumes only the seed and validates final contracts', async () => {
  const expected = bookSwap(),
    artifacts = new Map();
  const provider = fakeProvider(
    { knowledgeGraph: expected.knowledgeGraph, objectRedirects: [] },
    expected.decisionGraph,
    expected.implementationGraph,
  );
  const pipeline = new FinalOrchestrator({
    provider,
    specification,
    save: async (name, value) => {
      artifacts.set(name, value);
    },
  });
  const result = await pipeline.processConversation(seedConversation());
  assert.equal(
    result.step1Report.passed,
    true,
    JSON.stringify(result.step1Report),
  );
  assert.equal(
    result.step2Report.passed,
    true,
    JSON.stringify(result.step2Report),
  );
  assert.deepEqual(validateSchema(result, finalResultSchema), []);
  assert.deepEqual(
    provider.calls.map((c) => c.kind),
    ['extract', 'decision', 'implementation'],
  );
  assert.equal(pipeline.callsUsed, 3);
  assert.ok(artifacts.has('step1.reconciliation.json'));
  assert.ok(artifacts.has('knowledge.json'));
  assert.equal(
    JSON.parse(artifacts.get('step2.candidate.json')).validated,
    true,
  );
  assert.ok(provider.calls[1].prompt.includes('has_option is membership'));
  assert.ok(
    provider.calls[2].prompt.includes(
      'confirmed requirement or accepted decision',
    ),
  );
  for (const request of provider.calls.slice(1)) {
    const projected = JSON.parse(
      request.prompt.split('<knowledge>')[1].split('</knowledge>')[0],
    );
    assert.equal(
      projected.objects.length,
      result.knowledgeGraph.objects.length,
    );
    assert.deepEqual(
      projected.objects.map((object) => object.id),
      result.knowledgeGraph.objects.map((object) => object.id),
    );
    assert.doesNotMatch(
      JSON.stringify(projected),
      /"sourceRefs"|"history"|"dispositionSourceRefs"/,
    );
    assert.equal(request.prompt.includes('"speaker":'), false);
    assert.equal(request.prompt.includes('"dg_interface"'), false);
    assert.equal(request.prompt.includes('"ig_app"'), false);
  }
  assert.ok(provider.calls.every((c) => c.schema && c.maxOutputTokens > 0));
});

test('Step 1 schema/provenance errors prevent both Step 2 model calls', async () => {
  for (const invalid of [
    'invalid JSON',
    { knowledgeGraph: {}, objectRedirects: [] },
    (() => {
      const g = bookSwap().knowledgeGraph;
      g.annotations[0].agent = 'blue';
      return { knowledgeGraph: g, objectRedirects: [] };
    })(),
  ]) {
    const provider = fakeProvider(invalid, {}, {});
    const result = await new FinalOrchestrator({
      provider,
      specification,
      callLimit: 3,
    }).processConversation(seedConversation());
    assert.equal(result.step1Report.passed, false);
    assert.equal(provider.calls.length, 1);
    assert.equal(result.step2Report, undefined);
  }
});

test('invalid conversation and exhausted budgets start no additional calls', async () => {
  const expected = bookSwap();
  const provider = fakeProvider(
    { knowledgeGraph: expected.knowledgeGraph, objectRedirects: [] },
    expected.decisionGraph,
    expected.implementationGraph,
  );
  const invalid = seedConversation();
  invalid.messages[1].id = invalid.messages[0].id;
  assert.equal(
    (
      await new FinalOrchestrator({
        provider,
        specification,
      }).processConversation(invalid)
    ).step1Report.passed,
    false,
  );
  assert.equal(provider.calls.length, 0);
  const result = await new FinalOrchestrator({
    provider,
    specification,
    callLimit: 2,
  }).processConversation(seedConversation());
  assert.equal(result.step2Report.passed, false);
  assert.equal(provider.calls.length, 1);
});

test('nonsoftware conversation remains a task/workflow plan without invented technology', async () => {
  const input = inputFrom([
    [
      'user',
      'Organize a neighborhood park cleanup. Volunteers collect litter. No app is needed.',
    ],
  ]);
  const goal = baseObject('cleanup', 'goal', {
    priority: 'unspecified',
    successCriteria: [],
    state: 'active',
  });
  const knowledgeGraph = graphFor(input, [goal]);
  const implementation = {
    nodes: [
      {
        id: 'collect',
        nodeType: 'task',
        title: 'Collect litter',
        description: 'Arrange volunteer litter collection.',
        origin: 'planner_derived',
        status: 'proposed',
        justifiedByObjectIds: ['cleanup'],
        annotations: [],
      },
    ],
    edges: [],
  };
  const result = await new FinalOrchestrator({
    provider: fakeProvider(
      { knowledgeGraph, objectRedirects: [] },
      { nodes: [], edges: [] },
      implementation,
    ),
    specification,
  }).processConversation(input);
  assert.equal(result.step2Report.passed, true);
  assert.deepEqual(
    result.planningGraphs.implementationGraph.nodes.map((n) => n.nodeType),
    ['task'],
  );
});

test('standalone prepare creates unique run folders and references the original architecture', async () => {
  const out = await mkdtemp(join(tmpdir(), 'i4s-prepare-'));
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(
      process.execPath,
      ['dist/drawing/excalidraw/cli.js', '--prepare', '--out', out],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  }
  const runs = await readdir(out);
  assert.equal(runs.length, 2);
  const metadata = JSON.parse(
    await readFile(join(out, runs[0], 'run.json'), 'utf8'),
  );
  assert.ok(
    metadata.specificationPath
      .replaceAll('\\', '/')
      .endsWith('/docs/excalidraw.md'),
  );
  assert.equal(metadata.mode, 'prepare');
  assert.ok((await readdir(join(out, runs[0]))).includes('step1.prompt.txt'));
});

test('missing live credentials fails clearly, with no seeded-response substitution', async () => {
  const out = await mkdtemp(join(tmpdir(), 'i4s-no-key-'));
  const result = spawnSync(
    process.execPath,
    ['dist/drawing/excalidraw/cli.js', '--out', out],
    {
      encoding: 'utf8',
      env: { ...process.env, OPENAI_API_KEY: '' },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OPENAI_API_KEY/);
  const [run] = await readdir(out),
    files = await readdir(join(out, run));
  assert.ok(files.includes('result.json'));
  assert.equal(files.includes('step2.json'), false);
  assert.equal(
    JSON.parse(await readFile(join(out, run, 'completion.json'), 'utf8'))
      .callsUsed,
    0,
  );
});

test('both builders settle before reporting failure; the valid sibling artifact is retained', async () => {
  const data = bookSwap(),
    artifacts = new Map();
  const provider = {
    async *generate(request) {
      if (request.kind === 'extract') {
        yield JSON.stringify({
          knowledgeGraph: data.knowledgeGraph,
          objectRedirects: [],
        });
        return;
      }
      if (request.kind === 'decision')
        throw new Error('Decision generation failed.');
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield JSON.stringify(data.implementationGraph);
    },
  };
  const pipeline = new FinalOrchestrator({
    provider,
    specification,
    save: async (name, content) => {
      artifacts.set(name, content);
    },
  });
  const result = await pipeline.processConversation(seedConversation());
  assert.equal(result.step1Report.passed, true);
  assert.equal(result.step2Report.passed, false);
  assert.ok(artifacts.has('step2.implementation.response.json'));
  assert.equal(result.planningGraphs, undefined);
});
