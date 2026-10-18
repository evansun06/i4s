import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  mkdtemp,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Orchestrator } from '../dist/core/orchestrator.js';
import { panel } from '../dist/agents/panel.js';
import { ChatController } from '../dist/ui/controller.js';
import { parseCommand, complete } from '../dist/ui/commands.js';
import { createDrawingPipeline } from '../dist/drawing/pipeline.js';
import { parseTerminalMaps } from '../dist/drawing/maps.js';

const deferred = () => Promise.withResolvers();
async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await delay(2);
  }
  assert.fail('Timed out waiting for drawing state');
}
const maps = ['decision', 'implementation'].map((name) => ({
  name,
  heading: name,
  cards: [
    {
      id: 'private',
      label: 'Architecture',
      body: ['Canonical description'],
      status: 'confirmed',
      note: false,
    },
  ],
  edges: [],
}));
const result = {
  directory: '/test/run',
  filePath: '/test/run/project-plan.excalidraw',
  editUrl: 'http://127.0.0.1:12345/drawing/test-token',
  maps,
};
const log = [
  { id: 0, kind: 'user-message', text: 'Build a local tool.' },
  {
    id: 1,
    kind: 'agent-message',
    agent: 'blue',
    text: 'QUESTION: Which storage?',
  },
];
const restore = {
  log,
  summary: '',
  foldedUpTo: 0,
  pendingQuestion: { agent: 'blue', eventId: 1, question: 'Which storage?' },
};
function controllerWith(draw, extra = {}) {
  const calls = [];
  const engine = new Orchestrator({
    agents: panel,
    callLimit: 100,
    restore,
    provider: {
      async *generate(request) {
        calls.push(request);
        yield 'SPEAK\nGot your answer.';
      },
    },
    ...extra,
  });
  const saves = [];
  const controller = new ChatController(engine, {
    wordsPerMinute: 0,
    save: async () => {
      saves.push(engine.save());
    },
    draw,
  });
  return { engine, controller, calls, saves };
}

test('/draw completes and parses as a command, never as a discussion message', () => {
  assert.deepEqual(parseCommand('/draw'), { kind: 'draw' });
  assert.equal(parseCommand('/draw extra').kind, 'error');
  assert.equal(complete('/dr')[0].value, '/draw ');
});

test('drawing saves first, holds the question and queue, blocks resume/duplicates, and stays paused', async () => {
  const done = deferred();
  let runs = 0;
  const f = controllerWith(async (request) => {
    runs++;
    assert.equal(f.saves.length, 1);
    assert.deepEqual(f.saves[0].log, log);
    request.onCall();
    request.onProgress('Step 2: building maps…');
    return done.promise;
  });
  try {
    const question = f.engine.snapshot().pendingQuestion;
    f.controller.accept('/draw');
    await until(() => runs === 1);
    assert.equal(f.controller.snapshot().drawing.status, 'running');
    assert.equal(f.engine.snapshot().mode, 'paused');
    f.controller.accept('/draw');
    f.controller.accept('/resume');
    f.controller.accept('@blue SQLite');
    await delay(20);
    assert.equal(runs, 1);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.engine.snapshot().pendingQuestion, question);
    assert.equal(f.controller.snapshot().queued.length, 1);
    assert.deepEqual(f.engine.bus.log, log);
    done.resolve(result);
    await until(() => f.controller.snapshot().drawing.status === 'ready');
    assert.equal(f.engine.snapshot().mode, 'paused');
    assert.equal(f.engine.snapshot().callsUsed, 1);
    assert.deepEqual(
      f.controller.snapshot().messages.find((message) => message.link)?.link,
      { label: 'Go online to edit', url: result.editUrl },
    );
    f.controller.dismissDrawing();
    assert.equal(f.engine.snapshot().mode, 'paused');
    f.controller.accept('/resume');
    await until(() => f.engine.bus.log.length > 2);
    assert.equal(f.engine.bus.log[2].replyTo, 1);
  } finally {
    done.resolve(result);
    await f.controller.close();
  }
});

test('draw failure and insufficient budget keep the discussion paused and preserve its log', async () => {
  for (const limited of [false, true]) {
    let runs = 0;
    const f = controllerWith(
      async () => {
        runs++;
        throw new Error('Controlled draw failure.');
      },
      limited ? { callLimit: 5 } : {},
    );
    try {
      f.controller.accept('/draw');
      await until(() => f.controller.snapshot().drawing?.status === 'failed');
      assert.equal(f.engine.snapshot().mode, 'paused');
      assert.deepEqual(f.engine.bus.log, log);
      assert.equal(runs, limited ? 0 : 1);
      assert.equal(f.engine.snapshot().callsUsed, 0);
      if (limited) {
        f.controller.accept('/budget 6');
        f.controller.accept('/draw');
        await until(() => runs === 1);
        await until(() => f.controller.snapshot().drawing.status === 'failed');
      }
    } finally {
      await f.controller.close();
    }
  }
});

test('a failed session save starts no drawing calls and can be retried', async () => {
  let runs = 0,
    saves = 0;
  const engine = new Orchestrator({
    agents: panel,
    provider: {
      async *generate() {
        yield 'PASS';
      },
    },
    callLimit: 20,
    restore,
  });
  const controller = new ChatController(engine, {
    wordsPerMinute: 0,
    save: async () => {
      if (++saves === 1) throw new Error('Disk unavailable');
    },
    draw: async () => {
      runs++;
      return result;
    },
  });
  try {
    controller.accept('/draw');
    await until(() => controller.snapshot().drawing?.status === 'failed');
    assert.equal(runs, 0);
    controller.accept('/draw');
    await until(() => controller.snapshot().drawing?.status === 'ready');
    assert.equal(runs, 1);
  } finally {
    await controller.close();
  }
});

test('close cancels an in-flight drawing and does not resume discussion', async () => {
  let signal;
  const f = controllerWith((request) => {
    signal = request.signal;
    request.onCall();
    return new Promise((_, reject) =>
      request.signal.addEventListener(
        'abort',
        () => reject(new Error('cancelled')),
        { once: true },
      ),
    );
  });
  f.controller.accept('/draw');
  await until(() => signal);
  await f.controller.close();
  assert.equal(signal.aborted, true);
  assert.equal(f.engine.snapshot().mode, 'paused');
  assert.equal(f.calls.length, 0);
});

test('an already-streaming agent cannot alter the draw snapshot or commit until resume', async () => {
  const finish = deferred();
  const drawn = deferred();
  let drawing = false;
  const engine = new Orchestrator({
    agents: panel,
    callLimit: 30,
    provider: {
      async *generate() {
        yield 'SPEAK\nA partial reply';
        await finish.promise;
        yield ' and its ending.';
      },
    },
  });
  const controller = new ChatController(engine, {
    wordsPerMinute: 0,
    save: async () => {},
    draw: async () => {
      drawing = true;
      return drawn.promise;
    },
  });
  try {
    controller.accept('@red start');
    await until(() => engine.snapshot().speaking);
    controller.accept('/draw');
    await until(() => drawing);
    const snapshot = structuredClone(engine.bus.log);
    const speaking = engine.snapshot().speaking.text;
    finish.resolve();
    await delay(25);
    assert.deepEqual(engine.bus.log, snapshot);
    assert.equal(engine.snapshot().speaking.text, speaking);
    drawn.resolve(result);
    await until(() => controller.snapshot().drawing.status === 'ready');
    assert.deepEqual(engine.bus.log, snapshot);
    controller.dismissDrawing();
    controller.accept('/resume');
    await until(() =>
      engine.bus.log.some((event) => event.kind === 'agent-message'),
    );
  } finally {
    finish.resolve();
    drawn.resolve(result);
    await controller.close();
  }
});

test('empty conversations do not start a draw or consume budget', async () => {
  let ran = false;
  const f = controllerWith(
    async () => {
      ran = true;
      return result;
    },
    { restore: undefined },
  );
  try {
    f.controller.accept('/draw');
    await delay(10);
    assert.equal(ran, false);
    assert.equal(f.engine.snapshot().callsUsed, 0);
    assert.equal(f.controller.snapshot().drawing, undefined);
  } finally {
    await f.controller.close();
  }
});

test('terminal map parser rejects invalid card/arrow references', () => {
  assert.equal(parseTerminalMaps({ version: 1, maps }).length, 2);
  const broken = structuredClone(maps);
  broken[1].edges.push({
    source: 'missing',
    target: 'private',
    label: '',
    kind: 'relationship',
  });
  assert.throws(() => parseTerminalMaps({ version: 1, maps: broken }), /arrow/);
  assert.throws(() => parseTerminalMaps({ version: 2, maps }), /output/);
});

test('subprocess consumes the saved session log, reports calls, and creates a separate output run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i4s-draw-'));
  const source = join(root, 'pipeline');
  await mkdir(join(source, 'src'), { recursive: true });
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  await copyFile(
    new URL('./fixtures/draw-pipeline.mjs', import.meta.url),
    join(source, 'src/cli.ts'),
  );
  const sessionFile = join(root, 'session.json');
  const session = { version: 1, title: 'success', discussion: restore };
  await writeFile(sessionFile, JSON.stringify(session));
  const draw = createDrawingPipeline({
    sessionFile,
    outputDirectory: join(root, 'runs'),
    entry: join(source, 'src/cli.ts'),
    openAiKey: async () => 'sk-test-fake',
  });
  let calls = 0;
  const progress = [];
  const output = await draw({
    signal: new AbortController().signal,
    onCall: () => {
      calls++;
    },
    onProgress: (message) => progress.push(message),
  });
  assert.equal(calls, 1);
  assert.match(progress[0], /Step 1/);
  assert.match(
    output.editUrl,
    /^http:\/\/127\.0\.0\.1:\d+\/drawing\/[a-f0-9]+$/,
  );
  assert.match(await (await fetch(output.editUrl)).text(), /Go online to edit/);
  assert.equal(output.maps, undefined);
  assert.equal(output.preview, undefined);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(output.directory, 'input.log.json'), 'utf8'),
    ),
    log,
  );
  assert.deepEqual(JSON.parse(await readFile(sessionFile, 'utf8')), session);
  const again = await draw({
    signal: new AbortController().signal,
    onCall: () => {},
    onProgress: () => {},
  });
  assert.notEqual(again.directory, output.directory);
  await writeFile(sessionFile, JSON.stringify({ ...session, title: 'reuse' }));
  const reusedProgress = [];
  let reusedCalls = 0;
  await draw({
    signal: new AbortController().signal,
    onCall: () => {
      reusedCalls++;
    },
    onProgress: (message) => reusedProgress.push(message),
  });
  assert.equal(
    reusedCalls,
    1,
    'Reusing extraction must not charge a model call.',
  );
  assert.match(reusedProgress[0], /reusing validated extraction/);
  assert.match(reusedProgress[1], /implementation map/);
  await writeFile(sessionFile, JSON.stringify({ ...session, title: 'fail' }));
  await assert.rejects(
    draw({
      signal: new AbortController().signal,
      onCall: () => {},
      onProgress: () => {},
    }),
    /controlled pipeline failure/i,
  );
  await writeFile(sessionFile, JSON.stringify({ ...session, title: 'wait' }));
  const abort = new AbortController();
  await assert.rejects(
    draw({
      signal: abort.signal,
      onCall: () => abort.abort(),
      onProgress: () => {},
    }),
    /cancelled/,
  );
  await draw.close();
});

test('the pipeline gets the session OpenAI key through its environment, and never runs without one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'i4s-draw-key-'));
  const entry = join(root, 'cli.mjs');
  // A stand-in pipeline that reports the key it was given, then fails.
  await writeFile(
    entry,
    "process.stderr.write(`key=${process.env.OPENAI_API_KEY ?? 'none'}\\n`);\nprocess.exit(1);\n",
  );
  const run = (key) =>
    createDrawingPipeline({
      sessionFile: join(root, 'session.json'),
      outputDirectory: join(root, 'runs'),
      entry,
      openAiKey: async () => key,
    })({
      signal: new AbortController().signal,
      onCall: () => assert.fail('no model call should start'),
      onProgress: () => {},
    });
  await assert.rejects(run('sk-test-session'), /key=sk-test-session/);
  for (const missing of [undefined, '', '  '])
    await assert.rejects(run(missing), /needs an OpenAI key/);
});

test('Esc cancels a drawing and discards its maps; Korg reports it', async () => {
  let aborted = false;
  let started = false;
  const f = controllerWith(async (request) => {
    started = true;
    request.onProgress('Step 1: extracting…');
    // A pipeline that only ends when cancelled, as the real one does.
    await new Promise((_, fail) =>
      request.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          fail(new Error('Drawing cancelled.'));
        },
        { once: true },
      ),
    );
  });
  try {
    f.controller.accept('/draw');
    await until(() => started);
    assert.equal(f.controller.interrupt(), true);
    await until(() => f.controller.snapshot().drawing === undefined);
    assert.equal(aborted, true);
    const last = f.controller.snapshot().messages.at(-1);
    assert.equal(last.speaker, 'korg');
    assert.match(last.text, /Drawing cancelled/);
    assert.equal(last.link, undefined, 'no maps to open');
    assert.equal(f.engine.snapshot().mode, 'paused');
  } finally {
    await f.controller.close();
  }
});

test('drawing results come from Korg, with the edit link', async () => {
  const f = controllerWith(async () => result);
  try {
    f.controller.accept('/draw');
    await until(() => f.controller.snapshot().drawing?.status === 'ready');
    const last = f.controller.snapshot().messages.at(-1);
    assert.equal(last.speaker, 'korg');
    assert.match(last.text, /Maps saved/);
    assert.equal(last.link.label, 'Go online to edit');
  } finally {
    await f.controller.close();
  }
});
