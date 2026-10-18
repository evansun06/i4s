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
import { activityLabel, floorAgent } from '../dist/ui/app.js';

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

test('drawing puts Korg in the right-hand corner beside the dimmed four and removes him when finished', async () => {
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
    const view = (size, columns) =>
      stripVTControlCharacters(
        renderToString(
          React.createElement(CharacterRow, {
            state,
            sprites,
            size,
            tick: 0,
          }),
          { columns },
        ),
      );
    assert.equal(floorAgent(state), undefined);
    for (const [size, columns] of [
      [14, 100],
      [undefined, 60],
    ]) {
      const output = view(size, columns);
      assert.equal((output.match(/paused/g) ?? []).length, 4);
      assert.match(output, /drawing/);
      // Too small for sprites: everyone, Korg included, is text only.
      assert.equal(output.includes('▀') || output.includes('▄'), !!size);
      assert.match(output, /Ruby.*Lemon.*Jade.*Bleu.*Korg/);
      // Korg's 16-column box ends at the right edge of the terminal.
      const korgLine = output.split('\n').find((line) => line.includes('Korg'));
      assert.ok(korgLine.length - korgLine.indexOf('Korg') <= 10, korgLine);
    }
    for (const status of ['ready', 'failed']) {
      state.drawing = { status };
      assert.doesNotMatch(view(14, 100), /Korg|drawing/);
      assert.equal(floorAgent(state), 'red');
    }
  } finally {
    await controller.close();
  }
});

/** An interactive Ink terminal of a given size, driven through stdin. */
async function fakeTerminal(element, columns, rows) {
  const { render } = await import('ink');
  const { PassThrough, Writable } = await import('node:stream');
  let screen = '';
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      screen += chunk.toString();
      done();
    },
  });
  Object.assign(stdout, { isTTY: true, columns, rows });
  const stdin = new PassThrough();
  Object.assign(stdin, {
    isTTY: true,
    isRaw: false,
    setRawMode() {
      return this;
    },
    ref() {},
    unref() {},
  });
  const app = render(element, {
    stdout,
    stdin,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { stdin, app, screen: () => screen };
}

test('/lobby and /quit leave the chat; other input stays', async () => {
  assert.deepEqual(parseCommand('/lobby'), { kind: 'lobby' });
  assert.equal(parseCommand('/lobby now').kind, 'error');
  assert.ok(complete('/lo').some(({ label }) => label === '/lobby'));
  const { controller } = fixture(() => 'PASS');
  try {
    assert.equal(controller.accept('/lobby'), 'lobby');
    assert.equal(controller.accept('/quit'), 'quit');
    assert.equal(controller.accept('/help'), false);
  } finally {
    await controller.close();
  }
});

/** A key store with fake keychain, settings and environment. */
async function memoryKeys({ env = {}, keychainWorks = true } = {}) {
  const { createKeyStore } = await import('../dist/ui/keys.js');
  const saved = new Map();
  let settings = {};
  return createKeyStore({
    env,
    keychain: {
      get: async (provider) => saved.get(provider) ?? null,
      set: async (provider, key) => {
        if (!keychainWorks) return false;
        saved.set(provider, key);
        return true;
      },
      remove: async (provider) => saved.delete(provider),
    },
    settings: {
      load: async () => settings,
      save: async (next) => {
        settings = next;
      },
    },
  });
}

test('keys come from the environment or are saved; the last one chosen is used', async () => {
  const keys = await memoryKeys({ env: { GEMINI_API_KEY: 'AIza-env-1234' } });
  assert.deepEqual(
    (await keys.list()).map((key) => [key.provider, key.source]),
    [['gemini', 'env']],
  );
  assert.equal((await keys.active()).provider, 'gemini');
  const added = await keys.add('anthropic', 'sk-ant-test-5678');
  assert.equal(added.source, 'keychain');
  assert.equal((await keys.active()).provider, 'anthropic');
  await keys.use('gemini');
  assert.equal((await keys.active()).provider, 'gemini');
  await keys.remove('anthropic');
  assert.deepEqual(
    (await keys.list()).map((key) => key.provider),
    ['gemini'],
  );
  // Without a keychain, a key still works until the app quits.
  const session = await memoryKeys({ keychainWorks: false });
  assert.equal((await session.add('openai', 'sk-test-9999')).source, 'session');
  assert.equal((await session.active()).apiKey, 'sk-test-9999');
});

function savedSession(title, messages) {
  return {
    version: 1,
    id: title,
    title,
    createdAt: '2026-10-18T09:00:00.000Z',
    updatedAt: '2026-10-18T09:54:00.000Z',
    discussion: {
      log: Array.from({ length: messages }, () => ({})),
      summary: '',
      foldedUpTo: 0,
    },
  };
}

test('the lobby shows the title, the cast, and new or saved discussions', async () => {
  const React = await import('react');
  const { stripVTControlCharacters } = await import('node:util');
  const { Lobby, TITLE_WIDTH } = await import('../dist/ui/lobby.js');
  const lobby = (sessions) =>
    React.createElement(Lobby, {
      sessions,
      sprites: loadSprites(),
      keyLabel: 'Gemini · fake-model',
      onChoose: () => {},
      onKeys: () => {},
      onQuit: () => {},
    });
  const wide = await fakeTerminal(
    lobby([savedSession('Open a coffee shop', 3)]),
    100,
    40,
  );
  try {
    await until(() => /Open a coffee shop/.test(wide.screen()));
    const output = stripVTControlCharacters(wide.screen());
    assert.ok(/[█▀▄]{4}/.test(output), 'pixel title');
    assert.match(output, /Four perspectives\./);
    assert.doesNotMatch(output, /Four AI advisors/);
    assert.match(output, /Ruby.*Lemon.*Jade.*Bleu/);
    assert.match(output, /› \+ New discussion/);
    assert.match(output, /Open a coffee shop.*3 messages/);
    assert.match(output, /Ctrl\+K keys.*Gemini · fake-model/);
  } finally {
    wide.app.unmount();
  }
  // Too narrow for the block letters: a plain title instead.
  const narrow = await fakeTerminal(lobby([]), TITLE_WIDTH, 30);
  try {
    await until(() => /Start your first discussion/.test(narrow.screen()));
    const output = stripVTControlCharacters(narrow.screen());
    assert.match(output, /THE IDIOTS/);
    assert.ok(!output.includes('█████'));
  } finally {
    narrow.app.unmount();
  }
});

/** The full-screen Shell with fake sessions and chats. */
async function shell(keys) {
  const React = await import('react');
  const { Shell } = await import('../dist/ui/shell.js');
  const loads = [];
  const opened = [];
  const terminal = await fakeTerminal(
    React.createElement(Shell, {
      keys,
      loadSessions: async () => {
        loads.push(Date.now());
        return [];
      },
      openChat: (choice, key) => {
        const { controller } = fixture(() => 'PASS');
        opened.push({ choice, key, controller });
        return controller;
      },
      labelFor: (key) => `${key.provider} · fake-model`,
      sprites: loadSprites(),
    }),
    100,
    40,
  );
  return {
    ...terminal,
    loads,
    opened,
    since: (mark) => terminal.screen().slice(mark),
    mark: () => terminal.screen().length,
    async close() {
      terminal.app.unmount();
      for (const { controller } of opened) await controller.close();
    },
  };
}

test('with no keys, the first screen asks for one, then opens the lobby', async () => {
  const keys = await memoryKeys();
  const app = await shell(keys);
  try {
    await until(() =>
      /Paste in your first key to get started/.test(app.since(0)),
    );
    let mark = app.mark();
    app.stdin.write('AIzaSyFakeKeyForTests');
    await until(() => /•+ 21 characters/.test(app.since(mark)));
    assert.doesNotMatch(app.screen(), /SyFakeKey/, 'the key stays hidden');
    mark = app.mark();
    app.stdin.write('\r');
    await until(() => /New discussion/.test(app.since(mark)));
    assert.match(app.since(mark), /Gemini key saved to your system keychain/);
    assert.equal((await keys.active()).provider, 'gemini');
  } finally {
    await app.close();
  }
});

test('Ctrl+K opens the keys, Esc returns to the lobby, and chats use the chosen key', async () => {
  const keys = await memoryKeys();
  await keys.add('gemini', 'AIza-test-1111');
  await keys.add('anthropic', 'sk-ant-test-2222');
  await keys.use('gemini');
  const app = await shell(keys);
  try {
    await until(() => /New discussion/.test(app.since(0)));
    let mark = app.mark();
    app.stdin.write('\u000b'); // Ctrl+K
    await until(() => /API keys/.test(app.since(mark)));
    assert.match(app.since(mark), /Gemini · key ending 1111.*in use/);
    assert.match(app.since(mark), /Claude · key ending 2222/);
    mark = app.mark();
    app.stdin.write('\u001b'); // Esc
    await until(() => /New discussion/.test(app.since(mark)));
    // Choose the Claude key, then open a chat with it.
    mark = app.mark();
    app.stdin.write('\u000b');
    await until(() => /API keys/.test(app.since(mark)));
    app.stdin.write('\u001b[B'); // Down
    await delay(50);
    mark = app.mark();
    app.stdin.write('\r');
    await until(() => /New chats use Claude/.test(app.since(mark)));
    await delay(50);
    app.stdin.write('\r');
    await until(() => app.opened.length === 1);
    assert.equal(app.opened[0].key.provider, 'anthropic');
  } finally {
    await app.close();
  }
});

test('the lobby opens a chat, and /lobby saves it and returns with the list refreshed', async () => {
  const keys = await memoryKeys({ env: { GEMINI_API_KEY: 'AIza-env-1234' } });
  const app = await shell(keys);
  try {
    await until(() => /New discussion/.test(app.since(0)) && app.loads.length);
    let mark = app.mark();
    app.stdin.write('\r');
    await until(
      () =>
        app.opened.length === 1 && /Message the idiots/.test(app.since(mark)),
    );
    assert.equal(app.opened[0].choice, undefined);
    app.stdin.write('/lobby');
    await delay(20);
    mark = app.mark();
    const loads = app.loads.length;
    app.stdin.write('\r');
    await until(
      () => app.loads.length > loads && /New discussion/.test(app.since(mark)),
    );
    assert.equal(app.opened[0].controller.snapshot().closing, true);
  } finally {
    await app.close();
  }
});

test('/about shows every advisor, or only the ones named', async () => {
  assert.deepEqual(parseCommand('/about'), { kind: 'about', agents: [] });
  assert.deepEqual(parseCommand('/about @ruby'), {
    kind: 'about',
    agents: ['red'],
  });
  assert.equal(parseCommand('/about @nobody').kind, 'error');
  assert.ok(complete('/about @r').some(({ label }) => label === '@ruby'));
  const { controller } = fixture(() => 'PASS');
  try {
    controller.accept('/about');
    let text = controller.snapshot().messages.at(-1).text;
    for (const name of ['Ruby', 'Lemon', 'Jade', 'Bleu'])
      assert.ok(text.includes(`${name} (`), name);
    assert.match(text, /Action, priorities, and results/);
    controller.accept('/about @ruby');
    text = controller.snapshot().messages.at(-1).text;
    assert.match(text, /^Ruby \(red\)/);
    assert.doesNotMatch(text, /Lemon|Jade|Bleu/);
  } finally {
    await controller.close();
  }
});

test('a light band sweeps left to right through the text, keeping bold runs', async () => {
  const { boldRuns, lightRuns, shimmerBand } =
    await import('../dist/ui/message-text.js');
  const runs = boldRuns('Ship **now**, not later.');
  // Splitting never changes the text or its bold styling.
  for (const [from, to] of [
    [-6, 0],
    [3, 9],
    [20, 26],
    [30, 36],
  ]) {
    const lit = lightRuns(runs, from, to);
    assert.equal(lit.map((run) => run.text).join(''), 'Ship now, not later.');
    assert.equal(
      lit
        .filter((run) => run.bold)
        .map((run) => run.text)
        .join(''),
      'now',
    );
  }
  assert.deepEqual(
    lightRuns(runs, 3, 9).filter((run) => run.lit),
    [
      { text: 'p ', bold: false, lit: true },
      { text: 'now', bold: true, lit: true },
      { text: ',', bold: false, lit: true },
    ],
  );
  // The band enters from the left, moves right over time, and wraps around.
  const positions = [0, 600, 1200, 1800].map((ms) => shimmerBand(20, ms)[1]);
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
  assert.deepEqual(shimmerBand(20, 0), [-6, 0]);
  assert.deepEqual(shimmerBand(20, 2400), shimmerBand(20, 0));
  assert.ok(shimmerBand(20, 2399)[0] >= 19);
});

test('while drawing, Korg speaks the current step in the chat with a silver orb', async () => {
  const React = await import('react');
  const { stripVTControlCharacters } = await import('node:util');
  const { App } = await import('../dist/ui/app.js');
  const { controller } = fixture(() => 'PASS');
  const listeners = new Set();
  let state = {
    ...controller.snapshot(),
    drawing: {
      status: 'running',
      message: 'Step 2: building the implementation map…',
    },
  };
  const terminal = await fakeTerminal(
    React.createElement(App, {
      controller: {
        ...controller,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        snapshot: () => state,
      },
      sprites: loadSprites(),
      providerLabel: 'Test · fake',
    }),
    100,
    40,
  );
  const since = (mark) =>
    stripVTControlCharacters(terminal.screen().slice(mark));
  try {
    await until(() => /● Korg · drawing/.test(since(0)));
    assert.match(since(0), /Step 2: building the implementation map…/);
    // The step shows once, in Korg's entry, not again in the status line.
    assert.match(since(0), /Drawing maps · All agents paused/);
    assert.doesNotMatch(since(0), /building the implementation map… ·/);
    const mark = terminal.screen().length;
    state = { ...state, drawing: { status: 'failed', message: 'x' } };
    for (const listener of listeners) listener();
    await until(() => /calls ·/.test(since(mark)));
    assert.doesNotMatch(since(mark), /Korg · drawing/);
  } finally {
    terminal.app.unmount();
    await controller.close();
  }
});

test('a short chat sits at the bottom; a long one follows the end or scrolls', async () => {
  const { chatPosition } = await import('../dist/ui/app.js');
  // 6 lines in a 20-line area: 14 blank lines above, pushed up as it grows.
  assert.deepEqual(chatPosition(6, 20), { bottom: 0, offset: 0, top: 14 });
  assert.deepEqual(chatPosition(12, 20), { bottom: 0, offset: 0, top: 8 });
  // 50 lines: the last 20 show, or an earlier stretch when scrolled.
  assert.deepEqual(chatPosition(50, 20), { bottom: 30, offset: 30, top: -30 });
  assert.deepEqual(chatPosition(50, 20, 10), {
    bottom: 30,
    offset: 10,
    top: -10,
  });
});

test('lists stop at their first and last items instead of wrapping', async () => {
  const { step } = await import('../dist/ui/editor.js');
  assert.equal(step(0, -1, 5), 0);
  assert.equal(step(4, 1, 5), 4);
  assert.equal(step(2, 1, 5), 3);
  assert.equal(step(0, 1, 1), 0);
});

test('the title is drawn in small square pixels with half blocks', async () => {
  const { titlePixels, titleRows, TITLE_WIDTH } =
    await import('../dist/ui/lobby.js');
  const pixels = titlePixels();
  assert.equal(pixels.length, 5);
  assert.ok(pixels.every((row) => row.length === TITLE_WIDTH));
  const rows = titleRows();
  assert.equal(rows.length, 3);
  assert.ok(TITLE_WIDTH < 60);
  assert.ok(rows.every((row) => row.length === TITLE_WIDTH));
  assert.ok(rows.every((row) => /^[█▀▄ ]+$/.test(row)));
});

test('the highlight is a lighter shade of the text it passes over', async () => {
  const { lighten } = await import('../dist/ui/theme.js');
  assert.equal(lighten('#000000'), '#808080');
  assert.equal(lighten('#ff0000'), '#ff8080');
  assert.equal(lighten('#bdbdbd', 0), '#bdbdbd');
  const red = theme.agents.red.light;
  const lighter = lighten(red);
  for (const at of [1, 3, 5])
    assert.ok(
      parseInt(lighter.slice(at, at + 2), 16) >=
        parseInt(red.slice(at, at + 2), 16),
    );
});

test('Esc interrupts: a reply cut mid-stream keeps only what was shown', async () => {
  const streaming = Promise.withResolvers();
  const provider = {
    async *generate(request) {
      const agent = panel.find(
        (candidate) => candidate.systemPrompt === request.system,
      )?.id;
      if (request.kind !== 'draft' || agent !== 'red') {
        yield 'PASS';
        return;
      }
      yield 'SPEAK\nShown before Esc. Never shown after it.';
      streaming.resolve();
      await new Promise((_, fail) =>
        request.signal.addEventListener('abort', () => fail(new Error('x')), {
          once: true,
        }),
      );
    },
  };
  const engine = new Orchestrator({ agents: panel, provider, callLimit: 20 });
  // Reading speed slow enough that the reply is only partly on screen.
  const controller = new ChatController(engine, { wordsPerMinute: 120 });
  try {
    controller.accept('Help me decide.');
    await streaming.promise;
    await until(
      () => (controller.snapshot().messages.at(-1)?.text.length ?? 0) > 3,
    );
    assert.equal(controller.interrupt(), true);
    await until(() => controller.snapshot().room.mode === 'awaiting-user');
    await until(() => controller.snapshot().messages.at(-1)?.complete);
    const reply = controller.snapshot().messages.at(-1);
    assert.equal(reply.speaker, 'red');
    assert.equal(reply.failed, true, 'shown as interrupted');
    assert.ok('Shown before Esc. Never shown after it.'.startsWith(reply.text));
    assert.ok(!reply.text.includes('Never shown after it.'));
    assert.equal(engine.bus.log.filter((e) => e.agent === 'red').length, 0);
  } finally {
    await controller.close();
  }
});

test('the speaker orb pulses by size in one color, each glyph one column wide', async () => {
  const { ORB_SIZES } = await import('../dist/ui/app.js');
  const { default: stringWidth } = await import('string-width');
  assert.equal(ORB_SIZES[0], '●', 'a still orb is full size');
  assert.ok(new Set(ORB_SIZES).size > 1, 'it shrinks and grows');
  for (const glyph of ORB_SIZES) assert.equal(stringWidth(glyph), 1);
});

test('characters shrink with the terminal, then become text below the minimum', async () => {
  const { spriteSize, MAX_SPRITE, MIN_SPRITE } =
    await import('../dist/ui/app.js');
  const { scaleFrame } = await import('../dist/ui/sprites.js');
  assert.ok(MAX_SPRITE < 16, 'smaller than the hand-drawn size');
  assert.equal(spriteSize(100, 50), MAX_SPRITE);
  assert.equal(spriteSize(100, 28), 12);
  assert.equal(spriteSize(100, 23), MIN_SPRITE);
  assert.equal(spriteSize(100, 20), undefined, 'text only');
  assert.equal(spriteSize(60, 50), undefined, 'too narrow');
  // Each size stays square in pixels: size columns by size/2 rows.
  const frame = loadSprites().red.idle[0];
  for (const size of [MAX_SPRITE, 12, MIN_SPRITE]) {
    const scaled = scaleFrame(frame, size);
    assert.equal(scaled.rows.length, size / 2);
    assert.ok(scaled.rows.every((row) => row.length === size));
    assert.equal(scaleFrame(frame, size), scaled, 'cached');
  }
});
