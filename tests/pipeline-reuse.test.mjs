import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { reusableExtraction } from '../dist/drawing/excalidraw/step1/reuse.js';
import { extractionSchema } from '../dist/drawing/excalidraw/contracts.js';
import { validateKnowledge } from '../dist/drawing/excalidraw/step1/validate.js';
import {
  bookSwap,
  seedConversation,
  specification,
} from './pipeline/helpers.mjs';

test('extraction reuse checks exact inputs and revalidates knowledge, not just saved reports', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'i4s-extraction-cache-'));
  const source = join(parent, '2026-source');
  await mkdir(source);
  const conversation = seedConversation();
  const knowledge = bookSwap().knowledgeGraph;
  const validated = validateKnowledge(knowledge, conversation);
  assert.equal(validated.validationReport.passed, true);
  const files = {
    'run.json': {
      model: 'test-model',
      specificationSha256: createHash('sha256')
        .update(specification)
        .digest('hex'),
    },
    'conversation.json': conversation,
    'schemas.json': { extraction: extractionSchema },
    'step1.validation.json': validated.validationReport,
    'knowledge.json': knowledge,
  };
  const save = async (name, value) =>
    writeFile(join(source, name), JSON.stringify(value));
  for (const [name, value] of Object.entries(files)) await save(name, value);
  const load = () =>
    reusableExtraction(parent, conversation, specification, 'test-model');
  assert.equal((await load()).sourceRun, source);
  await mkdir(join(parent, '2027-incomplete'));
  assert.equal((await load()).sourceRun, source);
  const changed = structuredClone(conversation);
  changed.messages.at(-1).content += ' Changed choice.';
  assert.equal(
    await reusableExtraction(parent, changed, specification, 'test-model'),
    undefined,
  );
  assert.equal(
    await reusableExtraction(
      parent,
      conversation,
      specification + '\nchanged',
      'test-model',
    ),
    undefined,
  );
  assert.equal(
    await reusableExtraction(
      parent,
      conversation,
      specification,
      'other-model',
    ),
    undefined,
  );
  for (const [name, invalid] of [
    ['schemas.json', { extraction: { type: 'string' } }],
    ['step1.validation.json', { passed: false, issues: [] }],
    [
      'step1.validation.json',
      {
        passed: true,
        issues: [
          {
            code: 'error',
            severity: 'error',
            message: 'Invalid.',
            objectOrGraphIds: [],
          },
        ],
      },
    ],
    ['knowledge.json', { ...knowledge, snapshotSequence: 999 }],
    [
      'knowledge.json',
      {
        ...knowledge,
        objects: knowledge.objects.map((object, index) =>
          index
            ? object
            : { ...object, sourceRefs: [{ messageId: 'missing' }] },
        ),
      },
    ],
  ]) {
    await save(name, invalid);
    assert.equal(await load(), undefined, name);
    await save(name, files[name]);
  }
  await writeFile(join(source, 'knowledge.json'), 'invalid-json');
  assert.equal(await load(), undefined);
});

test('CLI reuses validated extraction in a fresh run, charges only actual calls and records timings', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'i4s-reuse-cli-'));
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '--import',
        new URL('./pipeline/fake-openai.mjs', import.meta.url).pathname,
        'dist/drawing/excalidraw/cli.js',
        '--out',
        parent,
        '--reuse-extraction',
        '--progress-json',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, OPENAI_API_KEY: 'test-placeholder' },
      },
    );
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const source = first.stderr.match(/Run folder: (.+)/)[1];
  const original = await readFile(join(source, 'knowledge.json'), 'utf8');
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  const output = second.stderr.match(/Run folder: (.+)/)[1];
  assert.notEqual(output, source);
  const events = second.stderr
    .split('\n')
    .filter((line) => line.startsWith('I4S_DRAW '))
    .map((line) => JSON.parse(line.slice(9)));
  assert.ok(
    events.some((event) => event.type === 'reuse' && event.stage === 'extract'),
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === 'call')
      .map((event) => event.stage)
      .sort(),
    ['implementation', 'presentation'],
  );
  assert.equal(
    JSON.parse(await readFile(join(output, 'completion.json'), 'utf8'))
      .callsUsed,
    2,
  );
  assert.equal(
    JSON.parse(await readFile(join(output, 'step1.reuse.json'), 'utf8'))
      .sourceRun,
    source,
  );
  assert.equal(
    await readFile(join(source, 'knowledge.json'), 'utf8'),
    original,
  );
  const timings = JSON.parse(
    await readFile(join(output, 'timings.json'), 'utf8'),
  );
  assert.equal(timings.extractionReused, true);
  assert.ok(timings.elapsedMs >= 0);
  assert.equal(timings.requests.length, 2);
  assert.ok(
    timings.requests.every(
      (request) => request.httpStatus === 200 && request.elapsedMs >= 0,
    ),
  );
});
