import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { panel } from '../dist/agents/panel.js';
import { Orchestrator } from '../dist/core/orchestrator.js';
import { RateLimitError } from '../dist/providers/model.js';
import { ChatController } from '../dist/ui/controller.js';
import { complete, parseCommand } from '../dist/ui/commands.js';
import { edit, editorWindow } from '../dist/ui/editor.js';
import {
  FloorAnimation,
  IdleAnimation,
  loadSprites,
} from '../dist/ui/sprites.js';
import { parsePalette, palette, theme } from '../dist/ui/theme.js';
import { activityLabel, floorAgent, roomLabel } from '../dist/ui/app.js';

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
      const agent = panel.find(
        (candidate) => candidate.systemPrompt === request.system,
      )?.id;
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

test('a question at the compaction threshold accepts its answer through the input queue', async () => {
  let drafts = 0;
  const { controller, engine, calls } = fixture(
    (request) => {
      if (request.kind === 'summary') return 'Earlier discussion summary.';
      return ++drafts === 2
        ? 'SPEAK\nQUESTION: What is the budget?'
        : 'SPEAK\nA recommendation.';
    },
    { compactAtTokens: 1, keepTokens: 1 },
  );
  try {
    controller.accept('@ruby start');
    await until(() => engine.snapshot().mode === 'awaiting-user');
    controller.accept('@ruby clarify');
    await until(() => controller.snapshot().question);
    const questionId = controller.snapshot().question.eventId;
    assert.equal(engine.snapshot().mode, 'awaiting-user');
    assert.equal(
      calls.some((call) => call.kind === 'summary'),
      false,
    );
    controller.accept('@ruby $100');
    await until(
      () =>
        userMessages(engine).length === 3 &&
        engine.snapshot().mode === 'awaiting-user',
    );
    assert.equal(userMessages(engine)[2].replyTo, questionId);
    assert.equal(controller.snapshot().question, undefined);
    assert.equal(controller.snapshot().queued.length, 0);
    assert.equal(calls.filter((call) => call.kind === 'summary').length, 1);
  } finally {
    await controller.close();
  }
});

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
  for (const sprites of Object.values(loadSprites())) {
    const frames = sprites.idle;
    assert.equal(frames.length, 4);
    assert.equal(sprites.toSpeak.length, 9);
    assert.equal(sprites.toNotSpeak.length, 9);
    assert.deepEqual(
      sprites.toSpeak.map((frame) => frame.duration),
      [...Array(8).fill(100), 1000],
    );
    assert.ok(sprites.toNotSpeak.every((frame) => frame.duration === 100));
    for (const frame of [...sprites.toSpeak, ...sprites.toNotSpeak]) {
      assert.equal(frame.rows.length, 8);
      assert.ok(frame.rows.every((row) => row.length === 16));
    }
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

test('busy input takes priority and is delivered FIFO and never duplicates streamed messages', async () => {
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
      1,
    );
    assert.deepEqual(
      calls.map((call) => call.agent),
      ['red', 'blue', 'green'],
    );
  } finally {
    await controller.close();
  }
});

test('an answer submitted while paused waits for resume', async () => {
  const { controller, engine, calls } = fixture(
    async (_request, _agent, index) =>
      index === 1
        ? 'SPEAK\nQUESTION: What is the deadline?'
        : 'SPEAK\nWe can work with that.',
  );
  try {
    controller.accept('@ruby plan');
    await until(() => controller.snapshot().question);
    const questionId = controller.snapshot().question.eventId;
    controller.accept('/pause');
    controller.accept('@ruby tomorrow');
    assert.equal(controller.snapshot().queued.length, 1);
    await delay(20);
    assert.equal(calls.length, 1);
    controller.accept('/resume');
    await until(() => userMessages(engine).length === 2);
    assert.equal(userMessages(engine)[1].text, '@ruby tomorrow');
    assert.equal(userMessages(engine)[1].replyTo, questionId);
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
    assert.equal(floorAgent(controller.snapshot()), 'red');
    assert.equal(roomLabel(controller.snapshot()), 'Discussion');
    controller.accept('/pause');
    assert.equal(floorAgent(controller.snapshot()), 'red');
    const shown = controller.snapshot().messages.at(-1).text;
    await delay(50);
    assert.equal(controller.snapshot().messages.at(-1).text, shown);
    controller.accept('/resume');
    await until(() => controller.snapshot().question);
    assert.equal(controller.snapshot().displaying, undefined);
    assert.equal(activityLabel(controller.snapshot(), 'red'), 'asking you');
    assert.equal(floorAgent(controller.snapshot()), 'red');
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
      if (
        request.system ===
        panel.find((candidate) => candidate.id === 'red').systemPrompt
      ) {
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

test('question protocol stays hidden at every streaming prefix and after restore', async () => {
  const { messageText } = await import('../dist/ui/message-text.js');
  const { findQuestion } = await import('../dist/agents/prompts.js');
  for (const marker of ['QUESTION:', '**QUESTION:**', '**QUESTION**:']) {
    const raw = `One thing.\n${marker} What is the budget?`;
    for (let i = 0; i <= raw.length; i++) {
      const shown = messageText(raw.slice(0, i));
      assert.ok('One thing.\nWhat is the budget?'.startsWith(shown), shown);
    }
    assert.equal(messageText(raw, true), 'One thing.\nWhat is the budget?');
  }
  assert.equal(messageText('Q', true), 'Q');
  assert.equal(messageText('Questionable idea.', true), 'Questionable idea.');
  assert.equal(findQuestion('Questionable idea.'), undefined);
  assert.equal(findQuestion('Want muffins?'), undefined);
  const { controller, engine } = fixture(() => 'SPEAK\nQUESTION: Budget?');
  let restored;
  try {
    controller.accept('@ruby hello');
    await until(() => controller.snapshot().question);
    assert.equal(controller.snapshot().messages.at(-1).text, 'Budget?');
    restored = fixture(() => 'PASS', { restore: engine.save() });
    assert.equal(
      restored.controller.snapshot().messages.at(-1).text,
      'Budget?',
    );
  } finally {
    await controller.close();
    await restored?.controller.close();
  }
});

test('input during paused playback wins the next turn after resume', async () => {
  const { controller, engine, calls } = fixture(
    (request, agent) => {
      if (request.kind === 'review') return 'REVISE\nGot the new direction.';
      return `SPEAK\n${agent} has something to say.`;
    },
    { wpm: 6000 },
  );
  try {
    controller.accept('Hello everyone');
    await until(() =>
      controller
        .snapshot()
        .messages.some((m) => m.speaker === 'red' && !m.complete),
    );
    controller.accept('/pause');
    const count = calls.length;
    controller.accept('@bleu change topic');
    await delay(20);
    assert.equal(calls.length, count);
    assert.equal(userMessages(engine).length, 1);
    controller.accept('/resume');
    await until(() => userMessages(engine).length === 2);
    const log = engine.bus.log;
    const nextUser = log.findIndex(
      (event) =>
        event.kind === 'user-message' && event.text.includes('change topic'),
    );
    assert.equal(
      log.slice(0, nextUser).filter((event) => event.kind === 'agent-message')
        .length,
      1,
    );
    await until(() =>
      calls.some(
        (call) =>
          call.agent === 'blue' &&
          call.kind === 'review' &&
          call.prompt.includes('change topic'),
      ),
    );
    assert.match(
      calls.findLast((call) => call.agent === 'blue' && call.kind === 'review')
        .prompt,
      /change topic/,
    );
  } finally {
    await controller.close();
  }
});

test('explicit hand raising reserves the floor without submitting a message or starting calls', async () => {
  const { engine, controller, calls } = fixture(
    (request) =>
      request.kind === 'review' ? 'KEEP' : 'SPEAK\nA point worth reading.',
    { wpm: 6000 },
  );
  try {
    assert.equal(controller.raiseHand(), false);
    controller.accept('Hello');
    await until(() => controller.snapshot().displaying === 'red');
    const before = calls.length;
    assert.equal(controller.raiseHand(), true);
    assert.equal(controller.raiseHand(), false);
    await until(
      () =>
        engine.snapshot().mode === 'awaiting-user' &&
        !controller.snapshot().displaying,
    );
    assert.equal(calls.length, before);
    assert.equal(userMessages(engine).length, 1);
    assert.equal(controller.snapshot().queued.length, 0);
    assert.equal(
      engine.bus.log.filter((event) => event.kind === 'agent-message').length,
      1,
    );
    assert.ok(engine.snapshot().queue.length > 0);
    controller.accept('@bleu new direction');
    await until(() => userMessages(engine).length === 2);
    assert.equal(engine.snapshot().handRaised, false);
  } finally {
    await controller.close();
  }
});

test('floor animation enters once, holds, exits immediately, then resumes idle', () => {
  for (const sprites of Object.values(loadSprites())) {
    const animation = new FloorAnimation(sprites, 0, () => 0.5);
    assert.equal(animation.frame(0, false), sprites.idle[0]);
    assert.equal(animation.frame(100, true), sprites.toSpeak[0]);
    assert.equal(animation.frame(199, true), sprites.toSpeak[0]);
    assert.equal(animation.frame(200, true), sprites.toSpeak[1]);
    assert.equal(animation.frame(900, true), sprites.toSpeak[8]);
    // Leaving during the final 1000 ms frame must not wait for that frame.
    assert.equal(animation.frame(901, false), sprites.toNotSpeak[0]);
    assert.equal(animation.frame(1001, false), sprites.toNotSpeak[1]);
    assert.equal(animation.frame(1701, false), sprites.toNotSpeak[8]);
    assert.equal(animation.frame(1801, false), sprites.idle[0]);
    assert.equal(animation.frame(3801, false), sprites.idle[0]);
    assert.equal(animation.frame(4301, false), sprites.idle[1]);
    assert.equal(animation.frame(5000, true), sprites.toSpeak[0]);
    assert.equal(animation.frame(100000, true), sprites.toSpeak[8]);
    assert.equal(animation.frame(200000, true), sprites.toSpeak[8]);
  }
});

test('floor transitions overlap and follow the latest assignment when interrupted', () => {
  const sprites = loadSprites().red;
  const outgoing = new FloorAnimation(sprites, 0);
  const incoming = new FloorAnimation(sprites, 0);
  outgoing.frame(0, true);
  assert.equal(outgoing.frame(800, true), sprites.toSpeak[8]);
  assert.equal(outgoing.frame(900, false), sprites.toNotSpeak[0]);
  assert.equal(incoming.frame(900, true), sprites.toSpeak[0]);
  assert.equal(outgoing.frame(1000, false), sprites.toNotSpeak[1]);
  assert.equal(incoming.frame(1000, true), sprites.toSpeak[1]);
  assert.equal(outgoing.frame(1100, true), sprites.toSpeak[0]);
  assert.equal(incoming.frame(1100, false), sprites.toNotSpeak[0]);
  assert.equal(outgoing.frame(1200, true), sprites.toSpeak[1]);
  assert.equal(incoming.frame(2000, false), sprites.idle[0]);
});

test('reduced motion uses static floor poses and idle-only sprites remain usable', () => {
  const sprites = loadSprites().green;
  const animation = new FloorAnimation(sprites, 0);
  assert.equal(animation.frame(0, false, true), sprites.idle[0]);
  assert.equal(animation.frame(100, true, true), sprites.toSpeak[8]);
  assert.equal(animation.frame(200, false, true), sprites.idle[0]);
  const idleOnly = new FloorAnimation(
    { ...sprites, toSpeak: [], toNotSpeak: [] },
    0,
    () => 0.5,
  );
  assert.equal(idleOnly.frame(0, true), sprites.idle[0]);
  assert.equal(idleOnly.frame(1500, true), sprites.idle[0]);
  assert.equal(idleOnly.frame(2000, true), sprites.idle[1]);
  assert.equal(idleOnly.frame(2100, false), sprites.idle[0]);
});

test('only visible speech or a revealed question owns the animated floor', () => {
  const state = {
    displaying: undefined,
    question: undefined,
    waiting: ['red'],
  };
  assert.equal(floorAgent(state), undefined);
  state.displaying = 'red';
  state.question = { agent: 'green' };
  assert.equal(floorAgent(state), 'red');
  state.displaying = undefined;
  assert.equal(floorAgent(state), 'green');
  state.question = undefined;
  assert.equal(floorAgent(state), undefined);
});

test('Enter completes an open / or @ suggestion, then sends once it matches', async () => {
  const { completionOnEnter } = await import('../dist/ui/commands.js');
  // Partly typed: Enter completes, like Tab.
  assert.equal(completionOnEnter('/he', 3, 0)?.value, '/help ');
  assert.equal(completionOnEnter('@ble', 4, 0)?.value, '@bleu ');
  // Fully typed: Enter sends instead of completing again.
  assert.equal(completionOnEnter('/help', 5, 0), undefined);
  assert.equal(completionOnEnter('/help ', 6, 0), undefined);
  // Plain messages have no suggestions, so Enter sends.
  assert.equal(completionOnEnter('hello there', 11, 0), undefined);
});

test('reading speed steps within range and can change while someone speaks', async () => {
  const { nextReadingSpeed, READING_SPEED } =
    await import('../dist/ui/controller.js');
  assert.equal(nextReadingSpeed(340, 1), 380);
  assert.equal(nextReadingSpeed(340, -1), 300);
  assert.equal(nextReadingSpeed(READING_SPEED.max, 1), READING_SPEED.max);
  assert.equal(nextReadingSpeed(READING_SPEED.min, -1), READING_SPEED.min);
  assert.equal(nextReadingSpeed(0, -1), READING_SPEED.max); // instant -> slowest step down
  assert.equal(nextReadingSpeed(0, 1), 0);

  const { controller } = fixture(() => 'PASS', { wpm: 340 });
  assert.equal(controller.snapshot().wordsPerMinute, 340);
  assert.equal(controller.adjustReadingSpeed(1), 380);
  assert.equal(controller.snapshot().wordsPerMinute, 380);
  await controller.close();
});

test('the pacer picks up a speed change partway through a reply', async () => {
  const { Pacer } = await import('../dist/ui/pacer.js');
  const pacer = new Pacer(() => {}, {
    wordsPerMinute: 60,
    pauseBetweenSpeakersMs: 0,
  });
  let shown = '';
  const reply = pacer.speech('', { text: (text) => (shown = text) });
  reply.update('x'.repeat(200)); // about 33 s at 60 wpm
  reply.finish();
  await delay(50);
  assert.ok(shown.length < 20, `slow start showed ${shown.length}`);
  pacer.setWordsPerMinute(0); // instant from here on
  await pacer.idle();
  assert.equal(shown.length, 200);
});

test('**bold** spans render bold without asterisks, even mid-stream', async () => {
  const { boldRuns } = await import('../dist/ui/message-text.js');
  assert.deepEqual(boldRuns('Ship **now**, not later.'), [
    { text: 'Ship ', bold: false },
    { text: 'now', bold: true },
    { text: ', not later.', bold: false },
  ]);
  assert.deepEqual(
    boldRuns('**a** and **b**')
      .filter((r) => r.bold)
      .map((r) => r.text),
    ['a', 'b'],
  );
  // A finished reply keeps an unmatched ** as written.
  assert.deepEqual(boldRuns('5 ** 2'), [{ text: '5 ** 2', bold: false }]);
  // Mid-stream, an opening ** starts bold at once instead of showing.
  assert.deepEqual(boldRuns('This is **impor', true), [
    { text: 'This is ', bold: false },
    { text: 'impor', bold: true },
  ]);
  assert.deepEqual(boldRuns('plain'), [{ text: 'plain', bold: false }]);
});

test('mouse wheel reports scroll the chat and are never typed into the editor', async () => {
  const { mouseWheel } = await import('../dist/ui/app.js');
  assert.equal(mouseWheel('\u001b[<64;10;5M'), -3); // wheel up
  assert.equal(mouseWheel('[<65;10;5M'), 3); // wheel down, escape stripped by Ink
  assert.equal(mouseWheel('[<0;10;5M'), 0); // a click: mouse noise, no scroll
  assert.equal(mouseWheel('hello'), undefined);
});

test('Korg loading frames honor asset timing and loop without a rest', async () => {
  const { loadKorgSprites, loopingFrame } =
    await import('../dist/ui/sprites.js');
  const { idle } = loadKorgSprites();
  assert.equal(idle.length, 16);
  let elapsed = 0;
  for (const frame of idle) {
    assert.equal(frame.rows.length, 8);
    assert.ok(frame.rows.every((row) => row.length === 16));
    assert.equal(loopingFrame(idle, elapsed), frame);
    assert.equal(loopingFrame(idle, elapsed + frame.duration - 1), frame);
    elapsed += frame.duration;
  }
  assert.equal(loopingFrame(idle, elapsed), idle[0]);
  assert.equal(loopingFrame(idle, elapsed + 500), idle[1]);
});

test('drawing centers Korg between two dimmed pairs and removes him when finished', async () => {
  const React = await import('react');
  const { renderToString } = await import('ink');
  const { stripVTControlCharacters } = await import('node:util');
  const { CharacterRow } = await import('../dist/ui/app.js');
  const { controller } = fixture(() => 'PASS');
  try {
    const state = {
      ...controller.snapshot(),
      displaying: 'red',
      drawing: { status: 'running', message: 'Working' },
    };
    const sprites = loadSprites();
    const view = (compact, columns) =>
      stripVTControlCharacters(
        renderToString(
          React.createElement(CharacterRow, {
            state,
            sprites,
            compact,
            tick: 0,
          }),
          { columns },
        ),
      );
    assert.equal(floorAgent(state), undefined);
    for (const [compact, columns] of [
      [false, 100],
      [true, 60],
    ]) {
      const output = view(compact, columns);
      assert.equal((output.match(/paused/g) ?? []).length, 4);
      assert.match(output, /drawing/);
      assert.ok(output.includes('▀') || output.includes('▄'));
      // Compact mode vertically centers the agent labels beside Korg's sprite.
      if (!compact) assert.match(output, /Ruby.*Lemon.*Korg.*Jade.*Bleu/);
    }
    for (const status of ['ready', 'failed']) {
      state.drawing = { status };
      assert.doesNotMatch(view(false, 100), /Korg|drawing/);
      assert.equal(floorAgent(state), 'red');
    }
  } finally {
    await controller.close();
  }
});
