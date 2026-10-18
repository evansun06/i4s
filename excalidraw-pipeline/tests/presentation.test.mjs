import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  defaultPresentation,
  inferPresentation,
  normalizePresentation,
  presentationSchema,
  presentationDesignSchema,
  presentationTextLimits,
  validatePresentation,
} from '../dist/rendering/presentation.js';
import { strictWireSchema, validateSchema } from '../dist/contracts.js';
import { buildExcalidrawScene } from '../dist/rendering/buildExcalidrawScene.js';
import { presentationDesign } from './helpers.mjs';

const knowledge = JSON.parse(
  await readFile(
    new URL('./fixtures/step1-knowledge.json', import.meta.url),
    'utf8',
  ),
).knowledgeGraph;
const graphs = JSON.parse(
  await readFile(
    new URL('./fixtures/step2-planning.json', import.meta.url),
    'utf8',
  ),
).planningGraphs;
const baseline = () => defaultPresentation(graphs, knowledge);
test('presentation text limits are sent in the strict wire schema and enforced locally', () => {
  const schema = presentationSchema(graphs);
  const wire = strictWireSchema(schema);
  for (const name of ['decision', 'implementation']) {
    const fields = wire.properties[name].properties.nodes.items.properties;
    assert.deepEqual(fields.label, {
      type: 'string',
      minLength: 1,
      maxLength: presentationTextLimits.label,
    });
    assert.equal(
      fields.description.maxLength,
      presentationTextLimits.description,
    );
    assert.equal(fields.reason.maxLength, presentationTextLimits.reason);
    assert.equal(
      wire.properties[name].properties.heading.maxLength,
      presentationTextLimits.heading,
    );
    assert.equal(
      wire.properties[name].properties.edges.items.properties.label.maxLength,
      60,
    );
  }
  for (const [field, limit] of [
    ['label', presentationTextLimits.label],
    ['description', presentationTextLimits.description],
    ['reason', presentationTextLimits.reason],
  ]) {
    const plan = baseline();
    plan.decision.nodes[0][field] = 'a'.repeat(limit + 1);
    assert.ok(
      validateSchema(plan, schema).some((message) => message.includes(field)),
    );
    assert.throws(() => validatePresentation(plan, graphs, knowledge));
    plan.decision.nodes[0][field] = '😀'.repeat(limit);
    assert.deepEqual(validateSchema(plan, schema), []);
  }
  assert.ok(validateSchema('', { type: 'string', minLength: 1 }).length);
});
test('presentation design is one bounded call and does not perform the final review', async () => {
  const plan = baseline(),
    saved = new Map(),
    calls = [];
  const actual = await inferPresentation(
    {
      async *generate(request) {
        calls.push(request);
        yield JSON.stringify(presentationDesign(plan));
      },
    },
    graphs,
    knowledge,
    async (name, text) => {
      saved.set(name, text);
    },
  );
  const expected = normalizePresentation(
    presentationDesign(plan),
    graphs,
    knowledge,
  );
  assert.deepEqual(actual, expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'presentation');
  assert.equal(calls[0].maxOutputTokens, 10000);
  assert.match(calls[0].prompt, /Never fabricate consensus/);
  assert.match(calls[0].prompt, /data, not instructions/);
  assert.equal(saved.size, 4);
  assert.deepEqual(JSON.parse(saved.get('step3.presentation.json')), expected);
  assert.doesNotMatch(
    calls[0].prompt,
    /"byDecisionNodeId"|"byImplementationNodeId"|"sourceRefs"/,
  );
});

test('model assignments guarantee source coverage while canonical validation remains strict', () => {
  const design = presentationDesign(baseline());
  const schema = presentationDesignSchema(graphs);
  assert.deepEqual(validateSchema(design, schema), []);
  const expected = normalizePresentation(design, graphs, knowledge);
  for (const name of ['decision', 'implementation']) {
    const ids = expected[name].nodes.flatMap((node) => node.sourceNodeIds);
    const sourceIds = graphs[`${name}Graph`].nodes
      .filter((node) => !['group', 'option'].includes(node.nodeType))
      .map((node) => node.id);
    assert.deepEqual([...ids].sort(), [...sourceIds].sort());
    assert.equal(new Set(ids).size, ids.length);
    const bad = structuredClone(design);
    delete bad[name].sourceAssignments[sourceIds[0]];
    assert.ok(validateSchema(bad, schema).length);
    assert.throws(() => normalizePresentation(bad, graphs, knowledge));
    const unknown = structuredClone(design);
    unknown[name].sourceAssignments.invented = 'c1';
    assert.throws(() => normalizePresentation(unknown, graphs, knowledge));
    const missingCard = structuredClone(design);
    missingCard[name].sourceAssignments[sourceIds[0]] = 'c12';
    assert.throws(() => normalizePresentation(missingCard, graphs, knowledge));
  }
  const duplicateCard = structuredClone(design);
  duplicateCard.decision.nodes[1].id = duplicateCard.decision.nodes[0].id;
  assert.throws(
    () => normalizePresentation(duplicateCard, graphs, knowledge),
    /unique IDs/,
  );
});

test('grouping cannot omit or invent sources, duplicate coverage, rewrite status or discard descriptions', () => {
  for (const change of [
    (p) => {
      p.decision.nodes.pop();
    },
    (p) => {
      p.decision.nodes[0].sourceNodeIds.push('invented');
    },
    (p) => {
      p.decision.nodes[1].sourceNodeIds.push(
        p.decision.nodes[0].sourceNodeIds[0],
      );
    },
    (p) => {
      p.decision.nodes[0].status = 'confirmed';
    },
    (p) => {
      p.decision.nodes[0].label = ' ';
    },
    (p) => {
      p.decision.nodes[0].label = 'a'.repeat(presentationTextLimits.label + 1);
    },
    (p) => {
      p.implementation.nodes[0].description = '';
    },
    (p) => {
      p.implementation.nodes[0].annotationIds = ['unknown'];
    },
    (p) => {
      p.decision.comments = {};
    },
    (p) => {
      p.decision.nodes[0].comment = 'Per-node annotation';
    },
    (p) => {
      p.decision.edges.push({
        sourceEdgeId: graphs.decisionGraph.edges[0].id,
        label: '',
      });
    },
  ]) {
    const candidate = baseline();
    change(candidate);
    assert.throws(() => validatePresentation(candidate, graphs, knowledge));
  }
  assert.throws(
    () =>
      validatePresentation(
        { decision: {}, implementation: {} },
        graphs,
        knowledge,
      ),
    /older format/,
  );
});

test('mixed/open cards become notes without rejecting the map or mutating source input', () => {
  const plan = baseline();
  const confirmed = plan.implementation.nodes.find(
    (n) =>
      graphs.implementationGraph.nodes.find((s) => s.id === n.sourceNodeIds[0])
        .status === 'confirmed',
  );
  const proposed = plan.implementation.nodes.find(
    (n) =>
      graphs.implementationGraph.nodes.find((s) => s.id === n.sourceNodeIds[0])
        .status === 'proposed',
  );
  confirmed.sourceNodeIds.push(...proposed.sourceNodeIds);
  plan.implementation.nodes = plan.implementation.nodes.filter(
    (n) => n !== proposed,
  );
  const before = structuredClone(plan);
  const corrected = validatePresentation(plan, graphs, knowledge);
  assert.equal(
    corrected.implementation.nodes.find((node) => node.id === confirmed.id)
      .note,
    true,
  );
  assert.deepEqual(plan, before);
  const other = baseline();
  other.implementation.nodes.find(
    (n) =>
      graphs.implementationGraph.nodes.find((s) => s.id === n.sourceNodeIds[0])
        .status === 'undecided',
  ).note = false;
  assert.doesNotThrow(() => validatePresentation(other, graphs, knowledge));
  assert.ok(
    validatePresentation(other, graphs, knowledge).implementation.nodes.some(
      (node) =>
        node.note &&
        node.sourceNodeIds.some(
          (id) =>
            graphs.implementationGraph.nodes.find((n) => n.id === id).status ===
            'undecided',
        ),
    ),
  );
});

test('mixed-status notes show every canonical status without implying shared approval', async () => {
  for (const [name, statuses] of [
    ['implementation', ['confirmed', 'undecided']],
    ['implementation', ['confirmed', 'proposed']],
    ['decision', ['resolved', 'deferred']],
  ]) {
    const plan = baseline();
    const graph = graphs[`${name}Graph`];
    const stateOf = (node) =>
      name === 'implementation'
        ? node.status
        : knowledge.objects.find((o) => o.id === node.primaryObjectId).state;
    const sources = statuses.map((status) =>
      graph.nodes.find(
        (node) =>
          !['group', 'option'].includes(node.nodeType) &&
          stateOf(node) === status,
      ),
    );
    assert.ok(sources.every(Boolean));
    const ids = sources.map((node) => node.id);
    for (const card of plan[name].nodes)
      card.sourceNodeIds = card.sourceNodeIds.filter((id) => !ids.includes(id));
    plan[name].nodes = plan[name].nodes.filter(
      (card) => card.sourceNodeIds.length,
    );
    plan[name].nodes.push({
      id: 'mixed-note',
      sourceNodeIds: ids,
      label: 'Related work and open choices',
      description:
        'These related items retain their individual commitment states.',
      reason: '',
      annotationIds: [],
      note: true,
    });
    const before = structuredClone({ graphs, knowledge, plan });
    assert.doesNotThrow(() => validatePresentation(plan, graphs, knowledge));
    const scene = await buildExcalidrawScene(graphs, knowledge, plan);
    assert.deepEqual({ graphs, knowledge, plan }, before);
    const card = scene.elements.find(
      (e) =>
        e.customData?.role === 'node' &&
        e.customData.sourceNodeIds.includes(ids[0]),
    );
    assert.equal(card.customData.note, true);
    assert.equal(card.customData.canonicalState, 'mixed');
    assert.deepEqual(
      card.customData.canonicalStates,
      Object.fromEntries(ids.map((id, i) => [id, statuses[i]])),
    );
    assert.equal(card.strokeStyle, 'dashed');
    const lines = scene.elements.filter(
      (e) =>
        e.customData?.role === 'node-item-status' &&
        e.customData.sourceNodeIds.includes(ids[0]),
    );
    assert.equal(lines.length, sources.length);
    const friendly = {
      confirmed: 'Confirmed',
      undecided: 'Undecided',
      proposed: 'Suggested — not confirmed',
      resolved: 'Resolved',
      deferred: 'Deferred',
    };
    for (const [i, line] of lines.entries()) {
      const visible = line.text.replace(/\s+/gu, ' ');
      assert.ok(
        visible.includes(`${sources[i].title}: ${friendly[statuses[i]]}`),
      );
      if (statuses[i] === 'resolved') assert.match(visible, /Chosen:/);
    }
    for (const line of scene.elements.filter(
      (e) => e.type === 'text' && e.groupIds.includes(card.groupIds[0]),
    )) {
      assert.ok(line.x >= card.x && line.y >= card.y);
      assert.ok(line.x + line.width <= card.x + card.width);
      assert.ok(line.y + line.height <= card.y + card.height);
    }
    const nodes = scene.elements.filter((e) => e.customData?.role === 'node');
    for (const [i, a] of nodes.entries())
      for (const b of nodes.slice(i + 1))
        assert.ok(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        );
    plan[name].nodes.at(-1).note = false;
    assert.equal(
      validatePresentation(plan, graphs, knowledge)[name].nodes.at(-1).note,
      true,
    );
  }
});

test('arrow captions are free text while source relationships and direction stay code-owned', () => {
  const plan = baseline();
  assert.ok(plan.implementation.edges.length);
  plan.implementation.edges[0].label = 'saves local records';
  assert.doesNotThrow(() => validatePresentation(plan, graphs, knowledge));
  for (const change of [
    (p) => {
      p.implementation.edges[0].sourceNodeId = 'invented';
    },
    (p) => {
      delete p.implementation.edges[0].sourceEdgeId;
    },
    (p) => {
      p.implementation.edges[0].sourceEdgeId = 'invented';
    },
    (p) => {
      p.implementation.edges.push(p.implementation.edges[0]);
    },
  ]) {
    const candidate = structuredClone(plan);
    change(candidate);
    assert.throws(() => validatePresentation(candidate, graphs, knowledge));
  }
});

test('two maps render without final reviews or agent comments', async () => {
  const plan = baseline(),
    before = structuredClone({ graphs, knowledge });
  const bare = await buildExcalidrawScene(graphs, knowledge, plan);
  assert.equal(
    bare.elements.some((e) => e.customData?.role?.startsWith('review-')),
    false,
  );
  const scene = bare;
  assert.deepEqual({ graphs, knowledge }, before);
  assert.equal(
    scene.elements.some((e) => e.customData?.agent),
    false,
  );
  const visible = scene.elements
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('\n');
  assert.doesNotMatch(
    visible,
    /Agent comments|No relevant comment recorded|\b[ADI]\d+\b|planner_derived|Decision refs:|Connection register|Node directory|Source detail/,
  );
  const nodes = scene.elements.filter((e) => e.customData?.role === 'node');
  assert.equal(
    nodes.length,
    plan.decision.nodes.length + plan.implementation.nodes.length,
  );
  assert.ok(
    scene.elements
      .filter((e) => e.type === 'text')
      .every((e) => e.fontFamily === 5 && e.fontSize >= 18),
  );
  const chosen = nodes.filter(
    (n) => n.customData.graph === 'decision' && !n.customData.note,
  );
  assert.equal(
    scene.elements.filter(
      (e) => e.type === 'arrow' && e.customData?.kind === 'reading-order',
    ).length,
    Math.max(0, chosen.length - 1),
  );
  const byId = new Map(scene.elements.map((e) => [e.id, e]));
  for (const arrow of scene.elements.filter(
    (e) => e.type === 'arrow' && e.customData.kind === 'relationship',
  ))
    for (const id of arrow.customData.sourceEdgeIds) {
      const original = graphs.implementationGraph.edges.find(
        (e) => e.id === id,
      );
      assert.ok(
        byId
          .get(arrow.startBinding.elementId)
          .customData.sourceNodeIds.includes(original.sourceNodeId),
      );
      assert.ok(
        byId
          .get(arrow.endBinding.elementId)
          .customData.sourceNodeIds.includes(original.targetNodeId),
      );
    }
  const rectangles = scene.elements.filter((e) =>
    ['node'].includes(e.customData?.role),
  );
  for (const [i, a] of rectangles.entries())
    for (const b of rectangles.slice(i + 1))
      assert.ok(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
        `${a.id} overlaps ${b.id}`,
      );
});

test('saved v2/v3/v4 maps upgrade without calling models or retaining review sections', () => {
  for (const version of ['2', '3', '4']) {
    const saved = baseline();
    saved.version = version;
    if (version === '4') saved.reviewFindings = [{ title: 'Old review' }];
    for (const name of ['decision', 'implementation']) {
      if (version === '3')
        saved[name].comments = { red: { text: 'Old summary' } };
      if (version === '2')
        saved[name].nodes.forEach((n) => {
          n.comment = 'Old inline note';
        });
    }
    const before = structuredClone(saved);
    assert.deepEqual(
      normalizePresentation(saved, graphs, knowledge),
      baseline(),
    );
    assert.deepEqual(saved, before);
  }
});
