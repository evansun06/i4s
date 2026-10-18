import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { panel } from '../dist/agents/panel.js';
import { Orchestrator } from '../dist/core/orchestrator.js';
import { RateLimitError } from '../dist/providers/model.js';
import { ChatController } from '../dist/ui/controller.js';
import { complete, parseCommand } from '../dist/ui/commands.js';
import { edit, editorWindow } from '../dist/ui/editor.js';
import { IdleAnimation, loadSprites } from '../dist/ui/sprites.js';
import { parsePalette, palette, theme } from '../dist/ui/theme.js';
import { activityLabel, roomLabel } from '../dist/ui/app.js';

async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await delay(2);
  }
  assert.fail('Timed out waiting for state');
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(script, options = {}) {
  const calls = [];
  const provider = {
    async *generate(request) {
      const agent = /YOUR PERSPECTIVE — (\w+)/
        .exec(request.system)?.[1]
        .toLowerCase();
      calls.push({ agent, ...request });
      const text = await script(request, agent, calls.length);
      yield text;
    },
  };
  const engine = new Orchestrator({
    agents: panel,
    provider,
    callLimit: 100,
    ...options,
  });
  const controller = new ChatController(engine, {
    wordsPerMinute: options.wpm ?? 0,
  });
  return { engine, controller, calls };
}
const userMessages = (engine) =>
  engine.bus.log.filter((event) => event.kind === 'user-message');

test('command completion replaces only the current token, supports names, and rejects invalid commands', () => {
  assert.equal(complete('/pa')[0].value, '/pause ');
  assert.equal(complete('@bl')[0].value, '@bleu ');
  assert.equal(complete('hello @ru please', 9)[0].value, 'hello @ruby  please');
  assert.ok(complete('/think ruby ')[0].value.startsWith('/think ruby '));
  assert.deepEqual(parseCommand('/temp bleu reset'), {
    kind: 'temp',
    settings: [{ target: 'blue', value: 0.5 }],
  });
  assert.deepEqual(parseCommand('/think ruby jade ship it'), {
    kind: 'message',
    text: 'ship it',
    answer: true,
    deep: ['red', 'green'],
  });
  assert.equal(parseCommand('/budget -1').kind, 'error');
  assert.equal(parseCommand('/quit accidentally').kind, 'error');
  assert.equal(parseCommand('/missing').kind, 'error');
  assert.equal(parseCommand('q').kind, 'message');
});

test('editor preserves graphemes and safely normalizes pasted control sequences', () => {
  const text = 'a👩🏽‍💻中';
  let state = { text, cursor: text.length };
  state = edit(state, { kind: 'left' });
  state = edit(state, { kind: 'backspace' });
  assert.deepEqual(state, { text: 'a中', cursor: 1 });
  state = edit(state, { kind: 'insert', text: '\x1b[31mhello\nworld' });
  assert.equal(state.text, 'ahello world中');
  assert.deepEqual(editorWindow({ text: 'abcdef', cursor: 6 }, 4), {
    before: 'def',
    cursor: ' ',
    after: '',
  });
});

test('packaged sprites have valid frames and theme colors come directly from the palette', () => {
  assert.equal(theme.background, '#1e1e1e');
  assert.equal(theme.agents.red.base, '#ad6c64');
  const values = new Set(palette.values());
  for (const value of Object.values(theme)) {
    if (typeof value === 'string') assert.ok(values.has(value));
  }
  for (const colors of Object.values(theme.agents)) {
    for (const color of Object.values(colors)) assert.ok(values.has(color));
  }
  assert.throws(() => parsePalette('300 0 0 invalid'));
  for (const frames of Object.values(loadSprites())) {
    assert.equal(frames.length, 4);
    for (const frame of frames) {
      assert.equal(frame.rows.length, 8);
      assert.ok(frame.rows.every((row) => row.length === 16));
      assert.equal(frame.duration, 500);
    }
  }
  const animation = new IdleAnimation([500, 500, 500, 500], 0, () => 0.5);
  assert.equal(animation.frame(1000), 0);
  assert.equal(animation.frame(1500), 0);
  assert.equal(animation.frame(2000), 1);
  assert.equal(animation.frame(3000), 3);
  assert.equal(animation.frame(3500), 0);
  assert.equal(animation.frame(8999), 0);
  assert.equal(animation.frame(9000), 0);
  assert.equal(animation.frame(9500), 1);
});

test('busy input is delivered FIFO after the current batch and never duplicates streamed messages', async () => {
  const first = deferred();
  const { controller, engine, calls } = fixture(
    async (_request, _agent, index) => {
      if (index === 1) await first.promise;
      return 'SPEAK\nA useful reply';
    },
  );
  try {
    controller.accept('@ruby first');
    await until(() => calls.length === 1);
    controller.accept('@bleu second');
    controller.accept('@jade third');
    assert.equal(controller.snapshot().queued.length, 2);
    assert.equal(userMessages(engine).length, 1);
    first.resolve();
    await until(
      () =>
        userMessages(engine).length === 3 &&
        controller
          .snapshot()
          .messages.filter((m) => m.speaker === 'green' && m.complete).length,
    );
    assert.deepEqual(
      userMessages(engine).map((m) => m.text),
      ['@ruby first', '@bleu second', '@jade third'],
    );
    assert.equal(
      controller.snapshot().messages.filter((m) => m.speaker !== 'user').length,
      3,
    );
    assert.deepEqual(
      calls.map((call) => call.agent),
      ['red', 'blue', 'green'],
    );
  } finally {
    await controller.close();
  }
});

test('a visible question holds old input; an answer submitted while paused has priority after resume', async () => {
  const first = deferred();
  const { controller, engine, calls } = fixture(
    async (_request, _agent, index) => {
      if (index === 1) {
        await first.promise;
        return 'SPEAK\nQUESTION: What is the deadline?';
      }
      return 'SPEAK\nWe can work with that.';
    },
  );
  try {
    controller.accept('@ruby plan');
    await until(() => calls.length === 1);
    controller.accept('@ruby unrelated queued message');
    first.resolve();
    await until(() => controller.snapshot().question);
    const questionId = controller.snapshot().question.eventId;
    assert.equal(userMessages(engine).length, 1);
    controller.accept('/pause');
    controller.accept('@ruby tomorrow');
    assert.equal(controller.snapshot().queued.length, 2);
    await delay(20);
    assert.equal(calls.length, 1);
    controller.accept('/resume');
    await until(() => userMessages(engine).length === 3);
    assert.equal(userMessages(engine)[1].text, '@ruby tomorrow');
    assert.equal(userMessages(engine)[1].replyTo, questionId);
    assert.equal(
      userMessages(engine)[2].text,
      '@ruby unrelated queued message',
    );
    assert.equal(userMessages(engine)[2].replyTo, undefined);
  } finally {
    await controller.close();
  }
});

test('set-aside and unqueue commands do not silently answer a question', async () => {
  const { controller, engine } = fixture(async (_request, _agent, index) =>
    index === 1 ? 'SPEAK\nQUESTION: Which option?' : 'SPEAK\nMoving on.',
  );
  try {
    controller.accept('@ruby start');
    await until(() => controller.snapshot().question);
    controller.accept('/pause');
    controller.accept('remove this');
    controller.accept('/unqueue');
    controller.accept('/new @ruby change direction');
    controller.accept('/resume');
    await until(() => userMessages(engine).length === 2);
    assert.equal(userMessages(engine)[1].text, '@ruby change direction');
    assert.equal(userMessages(engine)[1].replyTo, undefined);
  } finally {
    await controller.close();
  }
});

test('speaking follows paced playback, pause freezes it, and questions appear after reveal', async () => {
  const { controller, engine } = fixture(
    () => 'SPEAK\nA reply long enough to observe.\nQUESTION: Ready?',
    { wpm: 2000 },
  );
  try {
    controller.accept('@ruby start');
    await until(
      () =>
        engine.snapshot().mode === 'awaiting-user' &&
        controller.snapshot().displaying === 'red',
    );
    assert.equal(controller.snapshot().question, undefined);
    assert.equal(activityLabel(controller.snapshot(), 'red'), 'speaking');
    assert.equal(roomLabel(controller.snapshot()), 'Discussion');
    controller.accept('/pause');
    const shown = controller.snapshot().messages.at(-1).text;
    await delay(50);
    assert.equal(controller.snapshot().messages.at(-1).text, shown);
    controller.accept('/resume');
    await until(() => controller.snapshot().question);
    assert.equal(controller.snapshot().displaying, undefined);
    assert.equal(activityLabel(controller.snapshot(), 'red'), 'asking you');
  } finally {
    await controller.close();
  }
});

test('a rate-limit retry waits for resume instead of starting while paused', async () => {
  let attempts = 0;
  const { controller, engine } = fixture(() => {
    if (++attempts === 1) throw new RateLimitError('rate limited', 0.01);
    return 'SPEAK\nDone';
  });
  const off = engine.subscribe(() => {
    if (
      engine.snapshot().notice?.startsWith('Rate limited') &&
      engine.snapshot().mode === 'running'
    )
      engine.pause();
  });
  try {
    controller.accept('@ruby start');
    await until(() => engine.snapshot().mode === 'paused');
    await delay(30);
    assert.equal(attempts, 1);
    off();
    controller.accept('/resume');
    await until(() =>
      controller
        .snapshot()
        .messages.some((m) => m.speaker === 'red' && m.complete),
    );
    assert.equal(attempts, 2);
    assert.equal(engine.snapshot().callsUsed, 1);
  } finally {
    off();
    await controller.close();
  }
});

test('shutdown aborts an in-flight provider, releases a paused batch, and saves only committed text', async () => {
  const started = deferred();
  let aborted = false;
  let saved;
  const provider = {
    async *generate(request) {
      yield 'SPEAK\npartial';
      await new Promise((resolve) => {
        request.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
        started.resolve();
      });
      request.signal.throwIfAborted();
    },
  };
  const engine = new Orchestrator({ agents: panel, provider, callLimit: 100 });
  const controller = new ChatController(engine, {
    wordsPerMinute: 340,
    save: async () => {
      saved = engine.save();
    },
  });
  controller.accept('@ruby start');
  await started.promise;
  controller.accept('/pause');
  await controller.close();
  assert.equal(aborted, true);
  assert.deepEqual(
    saved.log.map((event) => event.kind),
    ['user-message'],
  );
  assert.equal(saved.pendingQuestion, undefined);
});

test('a one-call budget starts exactly one request and blocks the others until explicitly raised', async () => {
  const { controller, engine, calls } = fixture(
    (request) => (request.kind === 'review' ? 'KEEP' : 'SPEAK\nA reply.'),
    { callLimit: 1 },
  );
  try {
    controller.accept('go');
    await until(() => engine.snapshot().mode === 'paused');
    assert.equal(calls.length, 1);
    assert.equal(engine.snapshot().callsUsed, 1);
    controller.accept('/resume');
    await delay(10);
    assert.equal(calls.length, 1);
    controller.accept('/budget 20');
    assert.equal(engine.snapshot().mode, 'paused');
    controller.accept('/resume');
    await until(() => engine.snapshot().mode === 'awaiting-user');
    assert.ok(calls.length > 1);
    assert.equal(calls.length, engine.snapshot().callsUsed);
  } finally {
    await controller.close();
  }
});

test('pending questions prevent background retries until the user responds', async () => {
  const red = deferred();
  let blueAttempts = 0;
  const { controller, engine } = fixture(async (request, agent) => {
    if (request.kind === 'review') return 'KEEP';
    if (agent === 'red') {
      await red.promise;
      return 'SPEAK\nQUESTION: When?';
    }
    if (agent === 'blue' && ++blueAttempts === 1)
      throw new RateLimitError('wait', 0.04);
    return 'SPEAK\nA reply';
  });
  try {
    controller.accept('@ruby @bleu start');
    await until(() => blueAttempts === 1);
    red.resolve();
    await until(() => controller.snapshot().question);
    await delay(70);
    assert.equal(engine.snapshot().mode, 'awaiting-user');
    assert.equal(blueAttempts, 1);
    controller.accept('@bleu tomorrow');
    await until(() => blueAttempts === 2);
  } finally {
    await controller.close();
  }
});

test('another agent passing does not split or duplicate the displayed speaker', async () => {
  const redStarted = deferred();
  const release = deferred();
  const provider = {
    async *generate(request) {
      if (request.system.includes('YOUR PERSPECTIVE — RED:')) {
        yield 'SPEAK\nThe first part';
        redStarted.resolve();
        await release.promise;
        yield ' and the rest.';
      } else {
        await redStarted.promise;
        yield 'PASS';
      }
    },
  };
  const engine = new Orchestrator({ agents: panel, provider, callLimit: 20 });
  const controller = new ChatController(engine, { wordsPerMinute: 0 });
  try {
    controller.accept('start');
    await until(() => engine.agentState('blue').activity === 'passing');
    assert.equal(engine.snapshot().speaking.agent, 'red');
    release.resolve();
    await until(() =>
      controller
        .snapshot()
        .messages.some(
          (message) => message.speaker === 'red' && message.complete,
        ),
    );
    const replies = controller
      .snapshot()
      .messages.filter((message) => message.speaker === 'red');
    assert.equal(replies.length, 1);
    assert.equal(replies[0].text, 'The first part and the rest.');
    assert.equal(replies[0].failed, undefined);
  } finally {
    release.resolve();
    await controller.close();
  }
});
