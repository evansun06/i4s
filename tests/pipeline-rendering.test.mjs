import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildExcalidrawScene } from '../dist/drawing/excalidraw/rendering/buildExcalidrawScene.js';
import { exportExcalidraw } from '../dist/drawing/excalidraw/rendering/exportExcalidraw.js';
import { defaultPresentation } from '../dist/drawing/excalidraw/rendering/presentation.js';
import { terminalMaps } from '../dist/drawing/excalidraw/rendering/terminalMaps.js';

const knowledge = JSON.parse(
  await readFile(
    new URL('./pipeline/fixtures/step1-knowledge.json', import.meta.url),
    'utf8',
  ),
);
const planning = JSON.parse(
  await readFile(
    new URL('./pipeline/fixtures/step2-planning.json', import.meta.url),
    'utf8',
  ),
);
const textFor = (scene, id) =>
  scene.elements
    .filter((e) => e.type === 'text' && e.customData?.graphNodeId === id)
    .map((e) => e.text)
    .join('\n');
const flatten = (text) => text.replace(/\s+/gu, ' ');

test('terminal projection preserves rendered card states, canonical outcomes and directed arrows', async () => {
  const scene = await buildExcalidrawScene(
    planning,
    knowledge,
    defaultPresentation(planning.planningGraphs, knowledge.knowledgeGraph),
  );
  const before = structuredClone(scene);
  const output = terminalMaps(scene);
  assert.deepEqual(scene, before);
  assert.equal(output.version, 1);
  assert.deepEqual(
    output.maps.map((map) => map.name),
    ['decision', 'implementation'],
  );
  for (const map of output.maps) {
    assert.ok(map.cards.length);
    const ids = new Set(map.cards.map((card) => card.id));
    for (const card of map.cards) {
      assert.ok(card.label && card.body.length);
      const source = scene.elements.find((element) => element.id === card.id);
      assert.equal(card.status, source.customData.canonicalState);
      assert.equal(card.note, source.customData.note);
    }
    for (const edge of map.edges) {
      assert.ok(ids.has(edge.source) && ids.has(edge.target));
      assert.ok(
        scene.elements.some(
          (element) =>
            element.type === 'arrow' &&
            element.startBinding?.elementId === edge.source &&
            element.endBinding?.elementId === edge.target,
        ),
      );
    }
  }
  assert.ok(
    output.maps[0].cards.some((card) =>
      card.body.some((line) => line.includes('Chosen:')),
    ),
  );
  assert.ok(output.maps[1].cards.some((card) => card.status === 'undecided'));
});

test('CLI ingests discussion.log from a session envelope and emits machine-readable progress', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'i4s-session-render-'));
  const log = JSON.parse(
    await readFile(
      new URL('./pipeline/fixtures/conversation.seed.json', import.meta.url),
      'utf8',
    ),
  );
  const sessionFile = join(parent, 'session.json');
  const session = {
    version: 1,
    id: 'test-session',
    discussion: { log, summary: 'Not pipeline input', foldedUpTo: 0 },
  };
  const original = JSON.stringify(session);
  await writeFile(sessionFile, original);
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      new URL('./pipeline/fake-openai.mjs', import.meta.url).href,
      'dist/drawing/excalidraw/cli.js',
      '--session-file',
      sessionFile,
      '--progress-json',
      '--out',
      join(parent, 'runs'),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, OPENAI_API_KEY: 'fake-integration-key' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const events = result.stderr
    .split('\n')
    .filter((line) => line.startsWith('I4S_DRAW '))
    .map((line) => JSON.parse(line.slice(9)));
  assert.equal(events.filter((event) => event.type === 'run').length, 1);
  const stages = events
    .filter((event) => event.type === 'call')
    .map((event) => event.stage);
  assert.equal(stages[0], 'extract');
  assert.equal(stages.at(-1), 'presentation');
  assert.deepEqual(stages.slice(1, -1), ['implementation']);
  const path = result.stdout.trim().replace('Plan saved: ', '');
  assert.deepEqual(
    JSON.parse(await readFile(join(path, '..', 'input.log.json'), 'utf8')),
    log,
  );
  assert.equal(await readFile(sessionFile, 'utf8'), original);
  const terminal = JSON.parse(
    await readFile(join(path, '..', 'terminal-maps.json'), 'utf8'),
  );
  assert.equal(terminal.version, 1);
  assert.equal(terminal.maps.length, 2);
});

test('seeded Step 3 fixtures retain all nodes, all typed edges, states, annotations and cross-graph references', async () => {
  assert.equal(knowledge.knowledgeGraph.objects.length, 24);
  assert.equal(knowledge.knowledgeGraph.annotations.length, 15);
  assert.equal(knowledge.knowledgeGraph.relationships.length, 10);
  assert.equal(planning.planningGraphs.decisionGraph.nodes.length, 11);
  assert.equal(planning.planningGraphs.decisionGraph.edges.length, 10);
  assert.equal(planning.planningGraphs.implementationGraph.nodes.length, 16);
  assert.equal(planning.planningGraphs.implementationGraph.edges.length, 22);
  const before = structuredClone({ planning, knowledge });
  const scene = await buildExcalidrawScene(planning, knowledge);
  assert.deepEqual({ planning, knowledge }, before);
  assert.equal(
    scene.elements.filter((e) => e.customData?.role === 'region').length,
    2,
  );
  assert.equal(
    scene.elements.filter((e) => e.customData?.role === 'node').length,
    27,
  );
  assert.equal(
    scene.elements.filter(
      (e) => e.type === 'arrow' && e.customData?.role === 'edge',
    ).length,
    32,
  );
  assert.match(textFor(scene, 'option-sqlite-storage'), /SELECTED/);
  assert.match(textFor(scene, 'option-csv-storage'), /NOT SELECTED/);
  assert.match(textFor(scene, 'option-local-browser-ui'), /NOT SELECTED/);
  assert.match(textFor(scene, 'impl-backup-location'), /UNDECIDED/);
  assert.match(textFor(scene, 'impl-retention-policy'), /UNDECIDED/);
  assert.match(textFor(scene, 'impl-barcode-deferred'), /DEFERRED/);
  assert.match(textFor(scene, 'impl-book-swap-workflow'), /PROPOSED/);
  assert.ok(
    scene.elements.some(
      (e) => e.type === 'text' && e.text === 'Needs decision',
    ),
  );
  assert.ok(
    scene.elements.some(
      (e) => e.type === 'text' && e.text === 'Later / Deferred',
    ),
  );
  const historical = scene.elements.filter(
    (e) =>
      e.type === 'text' && e.customData?.annotationId === 'ann-red-csv-support',
  );
  assert.ok(historical.length);
  assert.ok(historical.every((e) => flatten(e.text).includes('PREVIOUS VIEW')));
  for (const annotation of knowledge.knowledgeGraph.annotations) {
    const detail = scene.elements.find(
      (e) =>
        e.type === 'text' &&
        e.customData?.role === 'annotation-detail-text' &&
        e.customData?.annotationId === annotation.id,
    );
    assert.ok(detail, annotation.id);
    assert.ok(
      flatten(detail.text).includes(flatten(annotation.reasoning)),
      annotation.id,
    );
    for (const condition of annotation.conditions)
      assert.ok(flatten(detail.text).includes(flatten(condition)));
  }
  for (const node of planning.planningGraphs.implementationGraph.nodes) {
    const refs = scene.elements.find(
      (e) =>
        e.customData?.role === 'decision-references' &&
        e.customData.graphNodeId === node.id,
    );
    const expected = new Set(
      planning.planningGraphs.crossGraphLinks.links
        .filter((l) => l.implementationNodeId === node.id)
        .map((l) => l.decisionNodeId),
    );
    const visible = refs?.text.match(/D\d+/g) ?? [];
    assert.equal(visible.length, expected.size, node.id);
    assert.equal(new Set(visible).size, visible.length, node.id);
  }
});

test('derived nodes, Unicode, long labels, empty graphs and absent optional metadata render without semantic changes', async () => {
  const bare = structuredClone(planning.planningGraphs);
  bare.decisionGraph = { nodes: [], edges: [] };
  bare.implementationGraph = {
    nodes: [
      {
        id: 'unicode',
        nodeType: 'task',
        title: '整理図書 📚 — ' + 'LongTitle'.repeat(35),
        description: '',
        origin: 'planner_derived',
        status: 'proposed',
        justifiedByObjectIds: [],
        annotations: [],
      },
    ],
    edges: [],
  };
  bare.crossGraphLinks = {
    links: [],
    byDecisionNodeId: {},
    byImplementationNodeId: {},
  };
  const scene = await buildExcalidrawScene(bare, knowledge.knowledgeGraph);
  assert.equal(
    scene.elements.filter((e) => e.customData?.role === 'node').length,
    1,
  );
  assert.match(textFor(scene, 'unicode'), /整理図書 📚/);
  assert.match(textFor(scene, 'unicode'), /PROPOSED/);
  const directory = await mkdtemp(join(tmpdir(), 'i4s-unicode-'));
  const result = await exportExcalidraw(
    scene,
    join(directory, 'unicode.excalidraw'),
  );
  assert.ok(result.elementCount);
});

test('input failures are explicit and implementation status is preserved with a warning on adoption mismatch', async () => {
  const changed = structuredClone(knowledge);
  changed.knowledgeGraph.conversationId = 'different';
  await assert.rejects(
    buildExcalidrawScene(planning, changed),
    /conversationId mismatch/,
  );
  changed.knowledgeGraph.conversationId =
    knowledge.knowledgeGraph.conversationId;
  changed.knowledgeGraph.snapshotSequence++;
  await assert.rejects(
    buildExcalidrawScene(planning, changed),
    /snapshot sequence mismatch/,
  );
  await assert.rejects(
    buildExcalidrawScene(
      { ...planning, validationReport: { passed: false, issues: [] } },
      knowledge,
    ),
    /successful input validation/,
  );
  const mismatched = structuredClone(knowledge);
  mismatched.knowledgeGraph.objects.find(
    (o) => o.id === 'workflow-book-swap',
  ).adoptionState = 'confirmed';
  const scene = await buildExcalidrawScene(planning, mismatched);
  assert.match(textFor(scene, 'impl-book-swap-workflow'), /PROPOSED/);
  assert.ok(
    scene.warnings.some(
      (w) => w.includes('proposed') && w.includes('confirmed'),
    ),
  );
});

test('export verifies native geometry and bindings and never overwrites an existing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i4s-export-'));
  const path = join(directory, 'project-plan.excalidraw');
  const scene = await buildExcalidrawScene(planning, knowledge);
  const exported = await exportExcalidraw(scene, path);
  assert.equal(exported.filePath, path);
  const original = await readFile(path, 'utf8');
  const parsed = JSON.parse(original);
  assert.equal(parsed.type, 'excalidraw');
  assert.equal(parsed.version, 2);
  assert.equal(parsed.elements.length, scene.elements.length);
  await assert.rejects(exportExcalidraw(scene, path), { code: 'EEXIST' });
  assert.equal(await readFile(path, 'utf8'), original);
  const duplicate = structuredClone(scene);
  duplicate.elements.push(duplicate.elements[0]);
  await assert.rejects(
    exportExcalidraw(duplicate, join(directory, 'bad.excalidraw')),
    /IDs must be unique/,
  );
  const broken = structuredClone(scene);
  broken.elements.find((e) => e.type === 'arrow').endBinding.elementId =
    'missing';
  await assert.rejects(
    exportExcalidraw(broken, join(directory, 'bad.excalidraw')),
    /Invalid connector binding/,
  );
  const geometry = structuredClone(scene);
  geometry.elements[0].x = NaN;
  await assert.rejects(
    exportExcalidraw(geometry, join(directory, 'bad.excalidraw')),
    /Invalid Excalidraw geometry/,
  );
});

test('CLI exports saved run artifacts and prints the path without a provider or credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i4s-render-run-'));
  await writeFile(
    join(directory, 'knowledge.json'),
    JSON.stringify(knowledge.knowledgeGraph),
  );
  await writeFile(join(directory, 'step2.json'), JSON.stringify(planning));
  const result = spawnSync(
    process.execPath,
    [
      'dist/drawing/excalidraw/cli.js',
      '--render-run',
      directory,
      '--deterministic',
      '--out',
      join(directory, 'exports'),
    ],
    { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' } },
  );
  assert.equal(result.status, 0, result.stderr);
  const outputPath = result.stdout.trim().replace('Plan saved: ', '');
  assert.ok(outputPath.startsWith(join(directory, 'exports')));
  assert.ok(
    outputPath.replaceAll('\\', '/').endsWith('/project-plan.excalidraw'),
  );
  assert.ok(
    JSON.parse(await readFile(join(outputPath, '..', 'step3.json'), 'utf8'))
      .elementCount,
  );
});

test('normal CLI runs produce an Excalidraw file automatically after successful Step 2', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'i4s-complete-render-'));
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      new URL('./pipeline/fake-openai.mjs', import.meta.url).href,
      'dist/drawing/excalidraw/cli.js',
      '--out',
      parent,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, OPENAI_API_KEY: 'fake-integration-key' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const path = result.stdout.trim().replace('Plan saved: ', '');
  assert.ok(path.replaceAll('\\', '/').endsWith('/project-plan.excalidraw'));
  const scene = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(scene.type, 'excalidraw');
  assert.equal(
    scene.elements.filter((e) => e.customData?.role === 'map-comment').length,
    0,
  );
  const completion = JSON.parse(
    await readFile(join(path, '..', 'completion.json'), 'utf8'),
  );
  assert.equal(completion.status, 'completed');
  assert.equal(completion.callsUsed, 3);
  assert.equal(completion.presentationCalls, 1);
  assert.equal(completion.reviewCalls, undefined);
  await assert.rejects(
    readFile(join(path, '..', 'step3.review.json')),
    /ENOENT/,
  );
  assert.equal(
    scene.elements.some((e) => e.customData?.role?.startsWith('review-')),
    false,
  );
  assert.ok(
    await readFile(join(path, '..', 'step3.presentation.json'), 'utf8'),
  );
});

test('CLI can restyle a saved presentation in a new folder without credentials or model calls', async () => {
  const source = await mkdtemp(join(tmpdir(), 'i4s-presentation-reuse-'));
  await writeFile(join(source, 'step2.json'), JSON.stringify(planning));
  await writeFile(join(source, 'knowledge.json'), JSON.stringify(knowledge));
  const original = JSON.stringify(
    defaultPresentation(planning.planningGraphs, knowledge.knowledgeGraph),
  );
  await writeFile(join(source, 'step3.presentation.json'), original);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('../dist/drawing/excalidraw/cli.js', import.meta.url),
      ),
      '--render-run',
      source,
      '--reuse-presentation',
      '--out',
      join(source, 'exports'),
    ],
    { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' } },
  );
  assert.equal(result.status, 0, result.stderr);
  const path = result.stdout.trim().replace('Plan saved: ', '');
  const completion = JSON.parse(
    await readFile(join(path, '..', 'completion.json'), 'utf8'),
  );
  assert.equal(completion.callsUsed, 0);
  assert.equal(completion.status, 'completed');
  assert.equal(
    await readFile(join(source, 'step3.presentation.json'), 'utf8'),
    original,
  );
  assert.ok(path.replaceAll('\\', '/').includes('/exports/'));
  const scene = JSON.parse(await readFile(path, 'utf8'));
  assert.ok(
    scene.elements
      .filter((e) => e.type === 'text')
      .every((e) => e.fontFamily === 5),
  );
});

test('CLI revalidates raw presentation responses before zero-call recovery', async () => {
  for (const invalid of [false, true]) {
    const source = await mkdtemp(join(tmpdir(), 'i4s-presentation-recovery-'));
    const plan = defaultPresentation(
      planning.planningGraphs,
      knowledge.knowledgeGraph,
    );
    if (invalid) plan.implementation.nodes[0].sourceNodeIds.push('invented');
    const original = JSON.stringify(plan);
    await writeFile(join(source, 'step2.json'), JSON.stringify(planning));
    await writeFile(join(source, 'knowledge.json'), JSON.stringify(knowledge));
    await writeFile(join(source, 'step3.presentation.response.json'), original);
    const result = spawnSync(
      process.execPath,
      [
        'dist/drawing/excalidraw/cli.js',
        '--render-run',
        source,
        '--reuse-presentation',
        '--out',
        join(source, 'exports'),
      ],
      { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' } },
    );
    assert.equal(
      await readFile(join(source, 'step3.presentation.response.json'), 'utf8'),
      original,
    );
    assert.equal(result.status, invalid ? 1 : 0, result.stderr);
    const directory = result.stderr.match(/Run folder: (.+)/)[1];
    const completion = JSON.parse(
      await readFile(join(directory, 'completion.json'), 'utf8'),
    );
    assert.equal(completion.callsUsed, 0);
    assert.equal(completion.status, invalid ? 'failed' : 'completed');
    if (invalid) {
      await assert.rejects(
        readFile(join(directory, 'project-plan.excalidraw')),
        /ENOENT/,
      );
      await assert.rejects(
        readFile(join(directory, 'step3.presentation.json')),
        /ENOENT/,
      );
    } else {
      assert.deepEqual(
        JSON.parse(await readFile(join(directory, 'step3.reuse.json'), 'utf8')),
        {
          sourceRun: source,
          sourceArtifact: 'step3.presentation.response.json',
          validated: true,
        },
      );
      assert.deepEqual(
        JSON.parse(
          await readFile(join(directory, 'step3.presentation.json'), 'utf8'),
        ),
        plan,
      );
      assert.ok(
        await readFile(join(directory, 'project-plan.excalidraw'), 'utf8'),
      );
    }
  }
});

test('CLI can remove old review sections from a saved map without model calls', async () => {
  const source = await mkdtemp(join(tmpdir(), 'i4s-map-comments-'));
  const original = defaultPresentation(
    planning.planningGraphs,
    knowledge.knowledgeGraph,
  );
  original.version = '4';
  original.reviewFindings = [{ title: 'Old review' }];
  const before = JSON.stringify(original);
  await writeFile(join(source, 'step2.json'), JSON.stringify(planning));
  await writeFile(join(source, 'knowledge.json'), JSON.stringify(knowledge));
  await writeFile(join(source, 'step3.presentation.json'), before);
  const result = spawnSync(
    process.execPath,
    [
      'dist/drawing/excalidraw/cli.js',
      '--render-run',
      source,
      '--reuse-presentation',
      '--out',
      join(source, 'exports'),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, OPENAI_API_KEY: '' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const path = result.stdout.trim().replace('Plan saved: ', '');
  const scene = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(
    scene.elements.filter((e) => e.customData?.role === 'map-comment').length,
    0,
  );
  const completion = JSON.parse(
    await readFile(join(path, '..', 'completion.json'), 'utf8'),
  );
  assert.equal(completion.callsUsed, 0);
  assert.equal(
    await readFile(join(source, 'step3.presentation.json'), 'utf8'),
    before,
  );
  const updated = JSON.parse(
    await readFile(join(path, '..', 'step3.presentation.json'), 'utf8'),
  );
  assert.equal(updated.version, '5');
  assert.equal('reviewFindings' in updated, false);
  assert.equal(
    scene.elements.some((e) => e.customData?.role?.startsWith('review-')),
    false,
  );
  for (const name of ['decision', 'implementation']) {
    assert.deepEqual(updated[name].edges, original[name].edges);
    assert.equal(updated[name].heading, original[name].heading);
    assert.deepEqual(updated[name].nodes, original[name].nodes);
  }
});

test('adapter fields agree with the known-good fixture produced by official Excalidraw 0.18.1 helpers', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        './pipeline/fixtures/excalidraw-0.18.1.excalidraw',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const scene = await buildExcalidrawScene(planning, knowledge);
  for (const type of ['rectangle', 'text', 'arrow']) {
    const official = fixture.elements.find((e) => e.type === type);
    const generated = scene.elements.find((e) => e.type === type);
    for (const key of Object.keys(official))
      assert.ok(key in generated, `${type}.${key}`);
  }
});
