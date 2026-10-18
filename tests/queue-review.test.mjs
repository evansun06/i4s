import assert from 'node:assert/strict';
import test from 'node:test';
import {
  setImmediate as tick,
  setTimeout as delay,
} from 'node:timers/promises';
import { panel } from '../dist/agents/panel.js';
import { Orchestrator } from '../dist/core/orchestrator.js';
import { RateLimitError } from '../dist/providers/model.js';

async function until(predicate) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await delay(2);
  }
  assert.fail('Timed out waiting for scheduler');
}
const messages = (engine) =>
  engine.bus.log.filter((event) => event.kind === 'agent-message');

function fixture(t, review, options = {}) {
  const first = Promise.withResolvers();
  const calls = [];
  const busy = new Set();
  const overlaps = [];
  const provider = {
    async *generate(request) {
      const agent = panel.find(
        (agent) => agent.systemPrompt === request.system,
      ).id;
      if (busy.has(agent)) overlaps.push(agent);
      busy.add(agent);
      const call = { ...request, agent };
      calls.push(call);
      try {
        if (request.kind === 'review') yield await review(call);
        else if (
          agent === 'red' &&
          calls.filter((c) => c.agent === 'red' && c.kind === 'draft')
            .length === 1
        ) {
          yield 'SPEAK\n';
          await first.promise;
          yield options.question ? 'QUESTION: Which users?' : 'First point.';
        } else {
          if (agent === 'blue' && options.late) await options.late;
          yield agent === 'blue' && options.deep
            ? 'DEEP: Check the numbers.'
            : `SPEAK\n${agent} contribution.`;
        }
      } finally {
        busy.delete(agent);
      }
    },
  };
  const engine = new Orchestrator({
    agents: panel,
    provider,
    callLimit: options.callLimit ?? 100,
  });
  t.after(() => {
    engine.dispose();
    assert.deepEqual(overlaps, []);
  });
  const cycle = engine.submit('Discuss');
  return { engine, calls, first, cycle };
}

test('all queued agents review together; withdrawals update the queue before the next turn', async (t) => {
  const verdicts = Object.fromEntries(
    ['yellow', 'green', 'blue'].map((id) => [id, Promise.withResolvers()]),
  );
  const { engine, calls, first, cycle } = fixture(t, (call) => {
    if (call.prompt.includes('Lemon:')) return 'KEEP';
    return verdicts[call.agent].promise;
  });
  await until(() => engine.snapshot().queue.length === 3);
  first.resolve();
  await until(() => calls.filter((c) => c.kind === 'review').length === 3);
  assert.deepEqual(
    ['yellow', 'green', 'blue'].map((id) => engine.agentState(id).activity),
    ['reviewing', 'reviewing', 'reviewing'],
  );
  verdicts.blue.resolve('WITHDRAW');
  await until(() => !engine.snapshot().queue.includes('blue'));
  verdicts.yellow.resolve('KEEP');
  await tick();
  assert.equal(messages(engine).length, 1);
  verdicts.green.resolve('REVISE\nA different point.');
  await cycle;
  assert.deepEqual(
    messages(engine).map((e) => e.agent),
    ['red', 'yellow', 'green'],
  );
  assert.equal(messages(engine).at(-1).text, 'A different point.');
  assert.deepEqual(
    calls.filter((c) => c.kind === 'review').map((c) => c.agent),
    ['yellow', 'green', 'blue', 'green'],
  );
  const lastReview = calls.at(-1).prompt;
  assert.match(lastReview, /Lemon: yellow contribution/);
  assert.match(lastReview, /you drafted:\nA different point/);
});

for (const verdict of ['WITHDRAW', 'nonsense', 'failure']) {
  test(`all queued reviews can end without speaking (${verdict})`, async (t) => {
    const { engine, first, cycle } = fixture(t, () => {
      if (verdict === 'failure') throw new Error('provider down');
      return verdict;
    });
    await until(() => engine.snapshot().queue.length === 3);
    first.resolve();
    await cycle;
    assert.equal(messages(engine).length, 1);
    assert.equal(engine.snapshot().mode, 'awaiting-user');
    assert.deepEqual(engine.snapshot().queue, []);
    if (verdict !== 'WITHDRAW')
      assert.match(engine.snapshot().notice, /could not review|invalid review/);
  });
}

test('a raised hand yields during review; stale withdrawal results cannot discard a new turn', async (t) => {
  const verdict = Promise.withResolvers();
  const { engine, calls, first, cycle } = fixture(t, (call) =>
    call.prompt.includes('New direction')
      ? 'REVISE\nFollowing the new direction.'
      : verdict.promise,
  );
  await until(() => engine.snapshot().queue.length === 3);
  first.resolve();
  await until(() => calls.filter((c) => c.kind === 'review').length === 3);
  assert.equal(engine.raiseHand(), true);
  assert.equal(engine.raiseHand(), false);
  await cycle;
  assert.equal(engine.snapshot().mode, 'awaiting-user');
  const next = engine.submit('@lemon New direction');
  verdict.resolve('WITHDRAW');
  await next;
  assert.deepEqual(
    messages(engine).map((e) => e.agent),
    ['red', 'yellow'],
  );
  assert.equal(messages(engine).at(-1).text, 'Following the new direction.');
  assert.equal(
    calls.filter(
      (c) => c.kind === 'review' && c.prompt.includes('New direction'),
    ).length,
    1,
  );
});

test('pause holds completed review results and the whole queue until resume', async (t) => {
  const verdict = Promise.withResolvers();
  const { engine, calls, first, cycle } = fixture(t, () => verdict.promise);
  await until(() => engine.snapshot().queue.length === 3);
  first.resolve();
  await until(() => calls.filter((c) => c.kind === 'review').length === 3);
  engine.pause();
  const count = calls.length;
  verdict.resolve('WITHDRAW');
  await tick();
  assert.equal(engine.snapshot().queue.length, 3);
  assert.equal(calls.length, count);
  assert.equal(messages(engine).length, 1);
  engine.resume();
  await cycle;
  assert.deepEqual(engine.snapshot().queue, []);
});

test('review waves respect the call limit, and unanswered questions start no reviews', async (t) => {
  const { engine, calls, first, cycle } = fixture(t, () => 'WITHDRAW', {
    callLimit: 5,
  });
  await until(() => engine.snapshot().queue.length === 3);
  first.resolve();
  await until(() => engine.snapshot().mode === 'paused');
  assert.equal(calls.length, 5);
  assert.equal(engine.resume(), false);
  engine.raiseCallLimit(2);
  engine.resume();
  await cycle;
  assert.equal(calls.length, 7);
  assert.equal(engine.snapshot().callsUsed, 7);
  const question = fixture(t, () => 'KEEP', { question: true });
  await until(() => question.engine.snapshot().queue.length === 3);
  question.first.resolve();
  await question.cycle;
  assert.equal(question.calls.filter((c) => c.kind === 'review').length, 0);
  assert.equal(question.engine.snapshot().queue.length, 3);
});

test('late drafts catch up without blocking earlier turns while still generating', async (t) => {
  const late = Promise.withResolvers();
  const { engine, calls, first, cycle } = fixture(t, () => 'KEEP', {
    late: late.promise,
  });
  await until(() => engine.snapshot().queue.length === 2);
  first.resolve();
  await until(() => messages(engine).length === 3);
  late.resolve();
  await cycle;
  const review = calls.find((c) => c.agent === 'blue' && c.kind === 'review');
  assert.match(review.prompt, /Ruby: First point/);
  assert.match(review.prompt, /Lemon: yellow contribution/);
  assert.match(review.prompt, /Jade: green contribution/);
  assert.equal(
    calls.filter((c) => c.agent === 'blue' && c.kind === 'review').length,
    1,
  );
});

test('queued deep announcements can withdraw before starting high-effort reasoning', async (t) => {
  const { engine, calls, first, cycle } = fixture(t, () => 'WITHDRAW', {
    deep: true,
  });
  await until(() => engine.snapshot().queue.length === 3);
  first.resolve();
  await cycle;
  const blue = calls.find((c) => c.kind === 'review' && c.agent === 'blue');
  assert.match(blue.prompt, /announces planned deep reasoning/);
  assert.ok(!calls.some((c) => c.effort === 'high'));
  assert.equal(messages(engine).length, 1);
});

test('a rate-limited queue review waits for resume and shutdown releases pending reviews', async (t) => {
  let attempts = 0;
  const { engine, calls, first, cycle } = fixture(t, (call) => {
    if (call.agent === 'yellow' && ++attempts === 1)
      throw new RateLimitError('wait', 0.02);
    return 'WITHDRAW';
  });
  await until(() => engine.snapshot().queue.length === 3);
  first.resolve();
  await until(() => attempts === 1);
  engine.pause();
  const count = calls.length;
  await delay(40);
  assert.equal(calls.length, count);
  engine.resume();
  await cycle;
  assert.equal(attempts, 2);
  assert.equal(engine.snapshot().callsUsed, calls.length - 1);
  const pending = Promise.withResolvers();
  const shutdown = fixture(t, () => pending.promise);
  await until(() => shutdown.engine.snapshot().queue.length === 3);
  shutdown.first.resolve();
  await until(
    () => shutdown.calls.filter((c) => c.kind === 'review').length === 3,
  );
  shutdown.engine.dispose();
  await shutdown.cycle;
  pending.resolve('KEEP');
  await tick();
  assert.deepEqual(shutdown.engine.snapshot().queue, []);
  assert.equal(messages(shutdown.engine).length, 1);
});

test('a late deep request reviews messages missed while deciding to think', async (t) => {
  const late = Promise.withResolvers();
  const { engine, calls, first, cycle } = fixture(
    t,
    (call) => (call.agent === 'blue' ? 'WITHDRAW' : 'KEEP'),
    { late: late.promise, deep: true },
  );
  await until(() => engine.snapshot().queue.length === 2);
  first.resolve();
  await until(() => messages(engine).length === 3);
  late.resolve();
  await cycle;
  const review = calls.find(
    (call) => call.agent === 'blue' && call.kind === 'review',
  );
  assert.ok(review);
  assert.match(review.prompt, /Jade: green contribution/);
  assert.match(review.prompt, /announces planned deep reasoning/);
  assert.ok(!calls.some((call) => call.effort === 'high'));
  assert.equal(messages(engine).length, 3);
});
