import assert from 'node:assert/strict';
import test from 'node:test';
import { panel } from '../dist/agents/panel.js';
import { Orchestrator } from '../dist/core/orchestrator.js';
import { RateLimitError } from '../dist/providers/model.js';

/** `script(kind, agent, prompt)` returns the reply; it streams in two chunks. */
function fakeProvider(script) {
  const calls = [];
  return {
    calls,
    async *generate(request) {
      const agent =
        /YOUR PERSPECTIVE — (\w+)/.exec(request.system)?.[1].toLowerCase() ??
        'summarizer';
      calls.push({
        kind: request.kind,
        agent,
        prompt: request.prompt,
        effort: request.effort,
      });
      const reply = await script(request.kind, agent, request.prompt);
      const middle = Math.ceil(reply.length / 2);
      yield reply.slice(0, middle);
      yield reply.slice(middle);
    },
  };
}

function room(script, callLimit = 50) {
  const provider = fakeProvider(script);
  const orchestrator = new Orchestrator({ agents: panel, provider, callLimit });
  return { provider, orchestrator };
}

const said = (orchestrator) =>
  orchestrator.bus.log
    .filter((e) => e.kind !== 'user-message')
    .map((e) => `${e.agent}: ${e.text}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const staggered = { red: 1, yellow: 5, green: 10, blue: 15 };

test('everyone drafts at once; the first speaks live, the rest review', async () => {
  const { provider, orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') return 'KEEP';
    await delay(staggered[agent]);
    return `SPEAK\n${agent} draft`;
  });
  await orchestrator.submit('Plan my launch');

  assert.deepEqual(said(orchestrator), [
    'red: red draft',
    'yellow: yellow draft',
    'green: green draft',
    'blue: blue draft',
  ]);
  const reviews = provider.calls.filter((c) => c.kind === 'review');
  assert.deepEqual(
    reviews.map((c) => c.agent),
    ['yellow', 'green', 'blue'],
  );
  assert.match(
    reviews[0].prompt,
    /USER: Plan my launch\n--- You started drafting here.*\nRED: red draft\n/,
  );
  // Each message appears once; the marker replaces a repeated copy.
  assert.equal(reviews[0].prompt.match(/RED: red draft/g).length, 1);
  assert.equal(orchestrator.snapshot().mode, 'awaiting-user');
});

test('a waiting agent can drop or revise its draft after listening', async () => {
  const { orchestrator } = room(async (kind, agent) => {
    if (kind === 'review')
      return agent === 'blue' ? 'WITHDRAW' : 'REVISE\nBuilding on Red.';
    if (agent === 'yellow') return 'PASS';
    await delay(agent === 'red' ? 1 : 5);
    return `SPEAK\n${agent} draft`;
  });
  await orchestrator.submit('Plan my launch');

  assert.deepEqual(said(orchestrator), [
    'red: red draft',
    'green: Building on Red.',
  ]);
  assert.deepEqual(orchestrator.snapshot().lastTurn, {
    agent: 'blue',
    result: 'withdrew',
  });
});

test('if every agent passes, the quietest agent still replies', async () => {
  const { orchestrator } = room((kind, agent, prompt) =>
    prompt.includes('PASS') ? 'PASS' : `SPEAK\n${agent} forced`,
  );
  await orchestrator.submit('hello');
  await orchestrator.submit('hello again');
  assert.deepEqual(said(orchestrator), [
    'red: red forced',
    'yellow: yellow forced',
  ]);
});

test('a question stops the round; held drafts resume after the answer', async () => {
  let round = 1;
  const { provider, orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') {
      return agent === 'blue' ? 'REVISE\nWith $5k, start small.' : 'KEEP';
    }
    if (round === 2) return agent === 'red' ? 'SPEAK\nThanks.' : 'PASS';
    await delay(agent === 'red' ? 1 : 5);
    if (agent === 'red')
      return 'SPEAK\nScope it.\nQUESTION: What is your budget?';
    return agent === 'blue' ? 'SPEAK\nPlan big.' : 'PASS';
  });
  await orchestrator.submit('Plan my launch');
  await delay(10); // Blue's draft lands after the question.

  let snapshot = orchestrator.snapshot();
  assert.equal(snapshot.mode, 'awaiting-user');
  assert.deepEqual(snapshot.pendingQuestion, {
    agent: 'red',
    eventId: 1,
    question: 'What is your budget?',
  });
  assert.deepEqual(said(orchestrator), [
    'red: Scope it.\nQUESTION: What is your budget?',
  ]);
  // Questions are ordinary agent messages; the QUESTION line marks them.
  assert.deepEqual(Object.keys(orchestrator.bus.log[1]).sort(), [
    'agent',
    'id',
    'kind',
    'text',
  ]);
  assert.equal(orchestrator.bus.log[1].kind, 'agent-message');
  assert.equal(snapshot.agents.red.activity, 'has-question');
  assert.equal(snapshot.agents.blue.activity, 'waiting');

  round = 2;
  const before = provider.calls.length;
  await orchestrator.submit('$5k');

  assert.equal(orchestrator.bus.log[2].replyTo, 1);
  // Blue goes first, reviews the answer, and does not draft again.
  const roundTwo = provider.calls.slice(before);
  assert.deepEqual(
    roundTwo.filter((c) => c.agent === 'blue').map((c) => c.kind),
    ['review'],
  );
  assert.match(roundTwo.find((c) => c.agent === 'blue').prompt, /USER: \$5k/);
  assert.deepEqual(said(orchestrator).slice(1), [
    'blue: With $5k, start small.',
    'red: Thanks.',
  ]);
  snapshot = orchestrator.snapshot();
  assert.equal(snapshot.pendingQuestion, undefined);
  assert.equal(snapshot.mode, 'awaiting-user');
});

test('the user can answer while other drafts are still finishing', async () => {
  const { orchestrator } = room(async (kind, agent) => {
    await delay(agent === 'red' ? 1 : 20);
    return agent === 'red' ? 'SPEAK\nQUESTION: Budget?' : 'PASS';
  });
  // The round resolves as soon as the question is asked, so the user can
  // answer while other drafts are still finishing.
  await orchestrator.submit('go');
  assert.equal(orchestrator.snapshot().mode, 'awaiting-user');
  assert.equal(orchestrator.snapshot().agents.blue.activity, 'thinking');
});

test('the log is sequential and attributes every message', async () => {
  const { orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') return 'KEEP';
    // Blue answers first even though Red starts first.
    await delay(agent === 'blue' ? 1 : 10);
    return agent === 'red' || agent === 'blue' ? `SPEAK\n${agent}` : 'PASS';
  });
  await orchestrator.submit('first');
  await orchestrator.submit('second');

  assert.deepEqual(
    orchestrator.bus.log.map(({ id, kind, agent, text }) => [
      id,
      kind,
      agent,
      text,
    ]),
    [
      [0, 'user-message', undefined, 'first'],
      [1, 'agent-message', 'blue', 'blue'],
      [2, 'agent-message', 'red', 'red'],
      [3, 'user-message', undefined, 'second'],
      [4, 'agent-message', 'blue', 'blue'],
      [5, 'agent-message', 'red', 'red'],
    ],
  );
});

test('pausing lets the current speaker finish but grants no new turns', async () => {
  const { orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') return 'KEEP';
    if (agent !== 'red' && agent !== 'blue') return 'PASS';
    if (agent === 'blue') await delay(5);
    return `SPEAK\n${agent}`;
  });
  // Pause while Red is mid-reply.
  orchestrator.subscribe(() => {
    if (orchestrator.snapshot().speaking?.agent === 'red') orchestrator.pause();
  });
  const cycle = orchestrator.submit('go');
  await delay(20);

  assert.equal(orchestrator.snapshot().mode, 'paused');
  assert.deepEqual(said(orchestrator), ['red: red']);
  assert.deepEqual(orchestrator.snapshot().queue, ['blue']);

  assert.equal(orchestrator.resume(), true);
  await cycle;
  assert.deepEqual(said(orchestrator), ['red: red', 'blue: blue']);
  assert.equal(orchestrator.snapshot().mode, 'awaiting-user');
});

test('the call limit pauses the room until it is raised', async () => {
  const { orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') return 'KEEP';
    await delay(staggered[agent]);
    return `SPEAK\n${agent}`;
  }, 5);
  const cycle = orchestrator.submit('go');
  await delay(40);

  let snapshot = orchestrator.snapshot();
  assert.equal(snapshot.mode, 'paused');
  assert.equal(snapshot.callsUsed, 5);
  assert.match(snapshot.notice, /Usage limit/);
  assert.equal(orchestrator.resume(), false);

  orchestrator.raiseCallLimit(10);
  assert.equal(orchestrator.resume(), true);
  await cycle;
  snapshot = orchestrator.snapshot();
  assert.equal(snapshot.callsUsed, 7);
  assert.equal(said(orchestrator).length, 4);
});

test('rate limits are retried without counting as calls', async () => {
  let limited = 2;
  const { orchestrator } = room((kind, agent) => {
    if (agent !== 'red') return 'PASS';
    if (limited-- > 0) throw new RateLimitError('slow down', 0.01);
    return 'SPEAK\nmade it';
  });
  await orchestrator.submit('go');

  assert.deepEqual(said(orchestrator), ['red: made it']);
  assert.equal(orchestrator.snapshot().callsUsed, 4);
});

test('user input is rejected while a cycle is running', async () => {
  const { orchestrator } = room(() => 'SPEAK\nok');
  const cycle = orchestrator.submit('first');
  await assert.rejects(orchestrator.submit('second'), /Wait for the agents/);
  await cycle;
});

test('older rounds are folded into a summary; the log keeps everything', async () => {
  const provider = fakeProvider((kind, agent, prompt) => {
    if (kind === 'summary')
      return `summary #${(prompt.match(/USER:/g) ?? []).length}`;
    return agent === 'red' ? `SPEAK\n${'word '.repeat(40)}` : 'PASS';
  });
  const orchestrator = new Orchestrator({
    agents: panel,
    provider,
    callLimit: 100,
    compactAtTokens: 120,
    keepTokens: 70,
  });
  for (const text of ['one', 'two', 'three', 'four', 'five', 'six']) {
    await orchestrator.submit(text);
  }

  assert.equal(orchestrator.bus.log.length, 12);
  const summaries = provider.calls.filter((c) => c.kind === 'summary');
  assert.equal(summaries.length, 2);
  const lastDraft = provider.calls.findLast((c) => c.kind === 'draft');
  assert.match(lastDraft.prompt, /^SUMMARY OF EARLIER DISCUSSION:\nsummary #/);
  assert.doesNotMatch(lastDraft.prompt, /USER: one/);
  assert.match(lastDraft.prompt, /USER: six/);
  // Each summary folds the previous one in rather than rereading old rounds.
  assert.match(summaries.at(-1).prompt, /PREVIOUS SUMMARY:\nsummary #/);
});

test('agent states are readable at any moment and report every change', async () => {
  const { orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') return 'KEEP';
    await delay(agent === 'red' ? 1 : 5);
    if (agent === 'blue')
      return 'SPEAK\nNeed data.\nQUESTION: What is the budget?';
    return agent === 'red' ? 'SPEAK\nShip it.' : 'PASS';
  });
  const seen = { red: [], yellow: [], green: [], blue: [] };
  const shown = [];
  orchestrator.subscribeAgents((id, state) => seen[id].push(state.activity));
  orchestrator.subscribe(() => {
    const { speaking } = orchestrator.snapshot();
    if (speaking && shown.at(-1) !== speaking.agent) shown.push(speaking.agent);
  });
  await orchestrator.submit('go');

  assert.deepEqual(seen.red, ['thinking', 'speaking', 'listening']);
  assert.deepEqual(seen.yellow, ['thinking', 'passing']);
  assert.deepEqual(seen.blue, [
    'thinking',
    'has-question',
    'reviewing',
    'speaking',
    'has-question',
  ]);
  assert.deepEqual(orchestrator.agentState('blue'), {
    activity: 'has-question',
  });
  assert.deepEqual(orchestrator.snapshot().agents.yellow, {
    activity: 'passing',
  });
  // Blue's kept draft is shown to the user, not just logged.
  assert.deepEqual(shown, ['red', 'blue']);
});

test('agentState reflects each state while it is happening', async () => {
  const observed = {};
  const blue = () => orchestrator.agentState('blue').activity;
  const provider = {
    async *generate({ kind, system }) {
      const agent = /YOUR PERSPECTIVE — (\w+)/.exec(system)[1].toLowerCase();
      if (agent === 'red') {
        yield 'SPEAK\nRed is ';
        await delay(15); // Red is still talking when Blue's draft is ready.
        observed.whileRedSpeaks = blue();
        yield 'still talking.';
      } else if (agent === 'blue' && kind === 'review') {
        observed.duringReview = blue();
        yield 'KEEP';
      } else if (agent === 'blue') {
        observed.whileDrafting = blue();
        await delay(5);
        yield 'SPEAK\nBlue point.';
      } else {
        yield 'PASS';
      }
    },
  };
  const orchestrator = new Orchestrator({
    agents: panel,
    provider,
    callLimit: 50,
  });
  orchestrator.subscribe(() => {
    if (orchestrator.snapshot().speaking?.agent === 'blue')
      observed.whileSpeaking ??= blue();
  });
  await orchestrator.submit('go');
  observed.after = blue();

  assert.deepEqual(observed, {
    whileDrafting: 'thinking',
    whileRedSpeaks: 'waiting',
    duringReview: 'reviewing',
    whileSpeaking: 'speaking',
    after: 'listening',
  });
});

test('the user can set a question aside; held drafts are redone', async () => {
  let round = 1;
  const { provider, orchestrator } = room(async (kind, agent) => {
    if (round === 2)
      return agent === 'blue' ? 'SPEAK\nOn pricing: test it.' : 'PASS';
    await delay(agent === 'red' ? 1 : 5);
    if (agent === 'red')
      return 'SPEAK\nScope it.\nQUESTION: What is your budget?';
    return agent === 'blue' ? 'SPEAK\nOld topic.' : 'PASS';
  });
  await orchestrator.submit('Plan my launch');
  await delay(10);
  assert.equal(orchestrator.snapshot().agents.blue.activity, 'waiting');

  round = 2;
  const before = provider.calls.length;
  await orchestrator.submit("Let's talk pricing instead", { answer: false });

  const message = orchestrator.bus.log[2];
  assert.equal(message.replyTo, undefined);
  // Blue drops its held draft and drafts fresh instead of reviewing it.
  const blueCalls = provider.calls
    .slice(before)
    .filter((c) => c.agent === 'blue');
  assert.deepEqual(
    blueCalls.map((c) => c.kind),
    ['draft'],
  );
  assert.match(blueCalls[0].prompt, /RED \(asked the user; not answered yet\)/);
  assert.deepEqual(said(orchestrator).slice(1), ['blue: On pricing: test it.']);
  assert.equal(orchestrator.snapshot().pendingQuestion, undefined);
});

test('after a recent question, agents are told not to ask another', async () => {
  let round = 1;
  const { provider, orchestrator } = room((kind, agent) => {
    if (round === 1 && agent === 'red') return 'SPEAK\nQUESTION: Budget?';
    return agent === 'red' ? 'SPEAK\nNoted.' : 'PASS';
  });
  await orchestrator.submit('Plan my launch');
  const roundOne = provider.calls.find((c) => c.kind === 'draft');
  assert.match(
    roundOne.prompt,
    /ask them: one question, the one that matters most/,
  );

  round = 2;
  const before = provider.calls.length;
  await orchestrator.submit('$5k');
  const roundTwo = provider.calls.slice(before).find((c) => c.kind === 'draft');
  assert.match(roundTwo.prompt, /RED \(asked the user; answered\)/);
  assert.match(roundTwo.prompt, /Avoid asking another/);
});

test('an instant answer still lets the asker and late passers reply', async () => {
  let round = 1;
  const { orchestrator } = room(async (kind, agent) => {
    await delay(agent === 'red' ? 1 : 5);
    if (round === 1)
      return agent === 'red' ? 'SPEAK\nQUESTION: Budget?' : 'PASS';
    return `SPEAK\n${agent} on $5k`;
  });
  await orchestrator.submit('go');
  round = 2;
  await orchestrator.submit('$5k'); // No pause between the rounds.

  // Red asked; Yellow, Green, and Blue were still drafting when the user
  // answered. All four reply to the answer.
  assert.deepEqual(
    said(orchestrator)
      .slice(1)
      .map((line) => line.split(':')[0])
      .sort(),
    ['blue', 'green', 'red', 'yellow'],
  );
});

test('a saved discussion continues where it left off', async () => {
  const { orchestrator } = room((kind, agent) =>
    agent === 'red' ? 'SPEAK\nPick a city.\nQUESTION: Which city?' : 'PASS',
  );
  await orchestrator.submit('Plan my launch');
  // Through JSON, as it would be stored on disk.
  const saved = JSON.parse(JSON.stringify(orchestrator.save()));

  const provider = fakeProvider((kind, agent) =>
    agent === 'red' ? 'SPEAK\nAustin it is.' : 'PASS',
  );
  const resumed = new Orchestrator({
    agents: panel,
    provider,
    callLimit: 50,
    restore: saved,
  });
  assert.equal(resumed.snapshot().mode, 'awaiting-user');
  assert.equal(resumed.snapshot().pendingQuestion.agent, 'red');
  assert.equal(resumed.agentState('red').activity, 'has-question');

  await resumed.submit('Austin');
  assert.equal(resumed.bus.log[2].replyTo, 1);
  assert.match(
    provider.calls[0].prompt,
    /USER: Plan my launch[\s\S]*USER: Austin/,
  );
  assert.deepEqual(said(resumed), [
    'red: Pick a city.\nQUESTION: Which city?',
    'red: Austin it is.',
  ]);
});

test('sessions are saved, listed newest first, and bad files are skipped', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { saveSession, listSessions, titleFor } =
    await import('../dist/storage/sessions.js');
  const dir = await mkdtemp(join(tmpdir(), 'i4s-sessions-'));
  try {
    const discussion = {
      log: [{ kind: 'user-message', text: 'Plan my coffee launch', id: 0 }],
      summary: '',
      foldedUpTo: 0,
    };
    const base = {
      version: 1,
      title: titleFor(discussion),
      createdAt: '2026-10-01T00:00:00Z',
      discussion,
    };
    await saveSession(
      { ...base, id: 'older', updatedAt: '2026-10-01T00:00:00Z' },
      dir,
    );
    await saveSession(
      { ...base, id: 'newer', updatedAt: '2026-10-02T00:00:00Z' },
      dir,
    );
    await writeFile(join(dir, 'broken.json'), '{ not json');
    await writeFile(join(dir, 'other.json'), JSON.stringify({ version: 1 }));

    const sessions = await listSessions(dir);
    assert.deepEqual(
      sessions.map((s) => s.id),
      ['newer', 'older'],
    );
    assert.equal(sessions[0].title, 'Plan my coffee launch');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('@mentions limit one round to those agents; the rest catch up next round', async () => {
  const { provider, orchestrator } = room(
    (kind, agent) => `SPEAK\n${agent} here`,
  );
  await orchestrator.submit('@Blue what are the risks? cc @red');

  assert.deepEqual(orchestrator.snapshot().mentioned, ['blue', 'red']);
  assert.deepEqual([...new Set(provider.calls.map((c) => c.agent))].sort(), [
    'blue',
    'red',
  ]);
  const draft = provider.calls.find(
    (c) => c.agent === 'blue' && c.kind === 'draft',
  );
  assert.match(draft.prompt, /addressed BLUE and RED directly/);
  // Addressed agents are not offered PASS.
  assert.doesNotMatch(draft.prompt, /Reply with only PASS/);
  assert.equal(orchestrator.agentState('green').activity, 'listening');

  const before = provider.calls.length;
  await orchestrator.submit('Thoughts, everyone?');
  assert.deepEqual(orchestrator.snapshot().mentioned, []);
  const green = provider.calls.slice(before).find((c) => c.agent === 'green');
  // Green missed nothing: the mentioned round is in its prompt.
  assert.match(green.prompt, /BLUE: blue here/);
  assert.equal(
    said(orchestrator).filter((s) => s.startsWith('green')).length,
    1,
  );
});

test('answering with an @mention drops other held drafts', async () => {
  let round = 1;
  const { provider, orchestrator } = room(async (kind, agent) => {
    if (round === 2) return `SPEAK\n${agent} on $5k`;
    await delay(agent === 'red' ? 1 : 5);
    if (agent === 'red') return 'SPEAK\nQUESTION: Budget?';
    return agent === 'blue' ? 'SPEAK\nHeld draft.' : 'PASS';
  });
  await orchestrator.submit('Plan my launch');
  await delay(10);
  assert.equal(orchestrator.agentState('blue').activity, 'waiting');

  round = 2;
  const before = provider.calls.length;
  await orchestrator.submit('$5k, @red');
  assert.equal(orchestrator.bus.log[2].replyTo, 1);
  assert.deepEqual(
    [...new Set(provider.calls.slice(before).map((c) => c.agent))],
    ['red'],
  );
  assert.deepEqual(said(orchestrator).slice(1), ['red: red on $5k']);
  assert.equal(orchestrator.agentState('blue').activity, 'listening');
});

test('temperature is boldness; the default leaves prompts unchanged', async () => {
  const { draftPrompt, reviewPrompt } =
    await import('../dist/agents/prompts.js');
  const { provider, orchestrator } = room((kind, agent) =>
    agent === 'yellow' ? 'SPEAK\nok' : 'PASS',
  );
  const prompt = (agent) =>
    provider.calls.findLast((c) => c.agent === agent && c.kind === 'draft')
      .prompt;

  // Everyone starts at 0.5, which adds nothing: the prompt is as it always was.
  assert.deepEqual(orchestrator.snapshot().temperatures, {
    red: 0.5,
    yellow: 0.5,
    green: 0.5,
    blue: 0.5,
  });
  await orchestrator.submit('ideas?');
  assert.doesNotMatch(prompt('yellow'), /boldness/i);
  assert.match(prompt('yellow'), /truly matters\.$/);
  const context = { summary: '', recent: [], answered: new Set() };
  const options = { forced: false, addressed: [], allowDeep: true };
  const before = draftPrompt(context, { ...options, temperature: 0.5 });
  assert.equal(before.endsWith('truly matters.'), true);
  assert.equal(
    reviewPrompt('draft', context, 0, 0.5).includes('boldness'),
    false,
  );

  orchestrator.setTemperature('all', 0.1);
  orchestrator.setTemperature('yellow', 1);
  await orchestrator.submit('more ideas?');
  assert.match(
    prompt('yellow'),
    /boldness is 1\.0 out of 1, where 0\.5 is your normal self\. Turn your personality all the way up/,
  );
  assert.match(prompt('red'), /boldness is 0\.1 .*almost all the way down/);
  assert.match(prompt('red'), /Never invent facts/);
  assert.throws(() => orchestrator.setTemperature('red', 1.5), /0 to 1/);

  // Kept with the discussion.
  const resumed = new Orchestrator({
    agents: panel,
    provider,
    callLimit: 50,
    restore: JSON.parse(JSON.stringify(orchestrator.save())),
  });
  assert.equal(resumed.snapshot().temperatures.yellow, 1);
  assert.equal(resumed.snapshot().temperatures.blue, 0.1);
});

test('temperature settings parse from flags and /temp', async () => {
  const { parseTemperatures } = await import('../dist/ui/temperature.js');
  const ids = ['red', 'yellow', 'green', 'blue'];
  assert.deepEqual(parseTemperatures('0.7', ids), [
    { target: 'all', value: 0.7 },
  ]);
  assert.deepEqual(parseTemperatures('@Yellow 0.9', ids), [
    { target: 'yellow', value: 0.9 },
  ]);
  assert.deepEqual(parseTemperatures('yellow=0.9, blue=.2', ids), [
    { target: 'yellow', value: 0.9 },
    { target: 'blue', value: 0.2 },
  ]);
  assert.equal(parseTemperatures('purple 0.5', ids), undefined);
  assert.equal(parseTemperatures('red 2', ids), undefined);
  assert.equal(parseTemperatures('hot', ids), undefined);
  assert.deepEqual(parseTemperatures('reset', ids), [
    { target: 'all', value: 0.5 },
  ]);
});

test('an agent can announce deep reasoning; others carry on meanwhile', async () => {
  const { provider, orchestrator } = room(async (kind, agent, prompt) => {
    if (kind === 'review') return 'KEEP';
    if (agent === 'blue') {
      if (prompt.includes('You just said')) {
        await delay(20); // high effort takes a while
        return 'SPEAK\nThe numbers say a $40 price works.';
      }
      return "DEEP: I'm going to work through the pricing math.";
    }
    if (agent === 'red') {
      await delay(5);
      return 'SPEAK\nLaunch in six weeks.';
    }
    return 'PASS';
  });
  await orchestrator.submit('How should I price this?');

  // The announcement comes first, Red talks while Blue reasons, then Blue's answer.
  assert.deepEqual(said(orchestrator), [
    "blue: I'm going to work through the pricing math.",
    'red: Launch in six weeks.',
    'blue: The numbers say a $40 price works.',
  ]);
  const deep = provider.calls.filter(
    (c) => c.agent === 'blue' && c.kind === 'draft',
  );
  assert.deepEqual(
    deep.map((c) => c.effort),
    [undefined, 'high'],
  );
  // The deep answer was reviewed against what Red said meanwhile.
  assert.ok(
    provider.calls.some((c) => c.agent === 'blue' && c.kind === 'review'),
  );
  assert.equal(orchestrator.agentState('blue').activity, 'listening');
});

test('a second agent wanting to reason deeply waits, then reconsiders', async () => {
  const states = [];
  let orchestrator;
  ({ orchestrator } = room(async (kind, agent, prompt) => {
    if (kind === 'review') return 'KEEP';
    if (agent === 'blue') {
      if (prompt.includes('You just said')) {
        await delay(20);
        return 'SPEAK\nPricing: $40.';
      }
      return 'DEEP: Let me work out the pricing.';
    }
    if (agent === 'green') {
      // Green wants to dig in too, but only until Blue has answered.
      if (prompt.includes('BLUE: Pricing: $40.'))
        return 'SPEAK\nBlue covered it; $40 is fine.';
      await delay(5);
      return 'DEEP: I want to check pricing.';
    }
    return 'PASS';
  }));
  orchestrator.subscribeAgents(
    (id, state) => id === 'green' && states.push(state.activity),
  );
  await orchestrator.submit('Price?');

  assert.deepEqual(said(orchestrator), [
    'blue: Let me work out the pricing.',
    'blue: Pricing: $40.',
    'green: Blue covered it; $40 is fine.',
  ]);
  // Green never reasoned at high effort; it waited, then answered normally.
  assert.ok(states.includes('waiting'));
  assert.ok(!states.includes('deliberating'));
});

test('the user can ask agents to think deeply; they run at once, uncapped', async () => {
  const started = [];
  const { provider, orchestrator } = room(async (kind, agent, prompt) => {
    if (kind === 'review') return 'KEEP';
    if (prompt.includes('You just said')) {
      started.push([agent, Date.now()]);
      await delay(15);
      return `SPEAK\n${agent} thought it through.`;
    }
    return 'PASS';
  });
  await orchestrator.submit('Design the pricing.', {
    deep: ['red', 'yellow', 'green'],
  });

  // No quick draft first: straight to an announcement and a high-effort draft.
  for (const agent of ['red', 'yellow', 'green']) {
    const drafts = provider.calls.filter(
      (c) => c.agent === agent && c.kind === 'draft',
    );
    assert.deepEqual(
      drafts.map((c) => c.effort),
      ['high'],
    );
  }
  // Blue was not asked, so it drafted normally.
  assert.deepEqual(
    provider.calls.filter((c) => c.agent === 'blue').map((c) => c.effort),
    [undefined],
  );
  // Three deep replies, past the cap of two, reasoning side by side.
  assert.equal(started.length, 3);
  const spread =
    Math.max(...started.map(([, t]) => t)) -
    Math.min(...started.map(([, t]) => t));
  assert.ok(spread < 15, `started ${spread} ms apart`);
  const lines = said(orchestrator);
  assert.equal(
    lines.filter((line) => line.includes('think this one through')).length,
    3,
  );
  assert.equal(
    lines.filter((line) => line.includes('thought it through')).length,
    3,
  );
});

test('a challenged agent can answer back, up to three exchanges a round', async () => {
  const { provider, orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') return 'KEEP';
    if (agent === 'red') {
      await delay(1);
      return 'SPEAK\nShip in six weeks.';
    }
    if (agent === 'blue') {
      await delay(5);
      return 'SPEAK\nRed, six weeks ignores testing.';
    }
    return 'PASS';
  });
  // After the main replies, Red and Blue keep going at each other.
  let turn = 0;
  const realGenerate = provider.generate;
  provider.generate = async function* (request) {
    if (request.prompt.includes('just responded to you directly')) {
      turn += 1;
      const me = /YOUR PERSPECTIVE — (\w+)/
        .exec(request.system)[1]
        .toLowerCase();
      provider.calls.push({
        kind: 'rebuttal',
        agent: me,
        prompt: request.prompt,
      });
      yield me === 'red'
        ? `SPEAK\nBlue, testing fits. (${turn})`
        : `SPEAK\nRed, it doesn't. (${turn})`;
      return;
    }
    yield* realGenerate.call(this, request);
  };
  await orchestrator.submit('When do we launch?');

  const rebuttals = provider.calls.filter((c) => c.kind === 'rebuttal');
  assert.deepEqual(
    rebuttals.map((c) => c.agent),
    ['red', 'blue', 'red'],
  );
  assert.match(
    rebuttals[0].prompt,
    /BLUE just responded to you directly[\s\S]*exchange 1 of at most 3/,
  );
  assert.match(
    rebuttals[2].prompt,
    /last exchange this round[\s\S]*tie-breaker QUESTION/,
  );
  assert.deepEqual(said(orchestrator).slice(-3), [
    'red: Blue, testing fits. (1)',
    "blue: Red, it doesn't. (2)",
    'red: Blue, testing fits. (3)',
  ]);
  assert.equal(orchestrator.snapshot().mode, 'awaiting-user');
});

test('a rebuttal chain stops on a pass or a tie-breaker question', async () => {
  const { orchestrator, provider } = room(async (kind, agent, prompt) => {
    if (prompt.includes('just responded to you directly')) {
      return agent === 'red'
        ? 'SPEAK\nBlue, we disagree on risk.\nQUESTION: Speed or polish, which matters more?'
        : 'PASS';
    }
    if (kind === 'review') return 'KEEP';
    if (agent === 'blue') {
      await delay(5);
      return 'SPEAK\nRed, too fast.';
    }
    return agent === 'red' ? 'SPEAK\nShip now.' : 'PASS';
  });
  await orchestrator.submit('When do we launch?');

  // Red answers Blue with a tie-breaker; the round waits for the user.
  assert.equal(
    orchestrator.snapshot().pendingQuestion.question,
    'Speed or polish, which matters more?',
  );
  const rebuttals = provider.calls.filter((c) =>
    c.prompt.includes('just responded to you directly'),
  );
  assert.equal(rebuttals.length, 1);
});

test('messages not addressed to anyone start no rebuttals', async () => {
  const { findAddressed } = await import('../dist/agents/prompts.js');
  const agents = [
    { id: 'red', name: 'RED' },
    { id: 'blue', name: 'BLUE' },
  ];
  assert.deepEqual(
    findAddressed('Blue, you are wrong. Red, so are you.', agents),
    ['blue', 'red'],
  );
  assert.deepEqual(findAddressed('I disagree with Blue here.', agents), []);
  assert.deepEqual(findAddressed('Fine. blue, one thing.', agents), ['blue']);
});

test('a hidden "SPEAK TO" line marks who is answered, without names in the text', async () => {
  const { provider, orchestrator } = room(async (kind, agent, prompt) => {
    if (prompt.includes('just responded to you directly')) return 'PASS';
    if (kind === 'review') return 'REVISE TO RED\nSix weeks ignores testing.';
    if (agent === 'red') return 'SPEAK\nShip in six weeks.';
    if (agent === 'blue') {
      await delay(5);
      return 'SPEAK\nplaceholder';
    }
    return 'PASS';
  });
  await orchestrator.submit('When do we launch?');

  // The header line never reaches the log, and Red still gets to answer.
  assert.deepEqual(said(orchestrator), [
    'red: Ship in six weeks.',
    'blue: Six weeks ignores testing.',
  ]);
  const rebuttal = provider.calls.find((c) =>
    c.prompt.includes('just responded to you directly'),
  );
  assert.equal(rebuttal.agent, 'red');
  assert.match(rebuttal.prompt, /BLUE just responded to you directly/);
});

test('raising a hand lets the current speaker finish, then gives the user the floor', async () => {
  let round = 1;
  const { provider, orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') return 'KEEP';
    if (round === 2) return agent === 'red' ? 'SPEAK\nGot it.' : 'PASS';
    if (agent === 'red') return 'SPEAK\nRed, first.';
    if (agent === 'blue') {
      await delay(5);
      return 'SPEAK\nBlue, waiting.';
    }
    return 'PASS';
  });
  const stop = orchestrator.subscribe(() => {
    if (orchestrator.snapshot().speaking?.agent === 'red')
      orchestrator.raiseHand();
  });
  await orchestrator.submit('Go');
  stop();
  await delay(15);

  // Red finished; Blue's finished draft is held, not spoken.
  assert.deepEqual(said(orchestrator), ['red: Red, first.']);
  assert.equal(orchestrator.snapshot().mode, 'awaiting-user');
  assert.equal(orchestrator.snapshot().handRaised, true);
  assert.equal(orchestrator.agentState('blue').activity, 'waiting');
  assert.equal(orchestrator.raiseHand(), false); // no round is running

  round = 2;
  const before = provider.calls.length;
  await orchestrator.submit('Wait, budget is tight.');
  assert.equal(orchestrator.snapshot().handRaised, false);
  // Blue goes first, after reviewing what the user just said.
  assert.equal(
    provider.calls.slice(before).find((c) => c.agent === 'blue').kind,
    'review',
  );
  assert.deepEqual(said(orchestrator).slice(1), [
    'blue: Blue, waiting.',
    'red: Got it.',
  ]);
});

test('angry mode can be switched on and off mid-session', async () => {
  const { provider, orchestrator } = room((kind, agent) =>
    agent === 'red' ? 'SPEAK\nok' : 'PASS',
  );
  const lastDraft = () =>
    provider.calls.findLast((c) => c.kind === 'draft').prompt;

  await orchestrator.submit('calm question');
  assert.equal(orchestrator.snapshot().angry, false);
  assert.doesNotMatch(lastDraft(), /ANGRY MODE/);

  orchestrator.setAngry(true);
  await orchestrator.submit('spicy question');
  assert.match(
    lastDraft(),
    /ANGRY MODE IS ON[\s\S]*never at the user[\s\S]*keep the exact reply format/,
  );
  // Kept with the discussion.
  const resumed = new Orchestrator({
    agents: panel,
    provider,
    callLimit: 50,
    restore: JSON.parse(JSON.stringify(orchestrator.save())),
  });
  assert.equal(resumed.snapshot().angry, true);

  orchestrator.setAngry(false);
  await orchestrator.submit('calm again');
  assert.doesNotMatch(lastDraft(), /ANGRY MODE/);
});

test('angry mode reaches review and rebuttal prompts too', async () => {
  const { ANGRY_MODE, reviewPrompt, rebuttalPrompt } =
    await import('../dist/agents/prompts.js');
  const context = { summary: '', recent: [], answered: new Set() };
  assert.ok(reviewPrompt('draft', context, 0, 0.5, true).endsWith(ANGRY_MODE));
  assert.ok(
    rebuttalPrompt(context, 'RED', 1, 3, 0.5, true).endsWith(ANGRY_MODE),
  );
  assert.ok(!reviewPrompt('draft', context, 0, 0.5).includes('ANGRY'));
});

test('a reply waits for the screen; a hand raised meanwhile holds it back', async () => {
  let round = 1;
  const { provider, orchestrator } = room(async (kind, agent) => {
    if (kind === 'review') return 'KEEP';
    if (round === 2) return agent === 'red' ? 'SPEAK\nNoted.' : 'PASS';
    if (agent === 'red') return 'SPEAK\nRed is still on screen.';
    if (agent === 'blue') {
      await delay(5);
      return 'SPEAK\nBlue is ready but unseen.';
    }
    return 'PASS';
  });
  // The "screen" is busy with Red until we say otherwise.
  let screenDone;
  const shown = new Promise((resolve) => (screenDone = resolve));
  orchestrator.setDisplayGate(() => shown);

  const cycle = orchestrator.submit('Go');
  await delay(20);
  // Blue's reply is reviewed and ready, but not in the discussion yet.
  assert.deepEqual(said(orchestrator), ['red: Red is still on screen.']);
  orchestrator.raiseHand();
  screenDone();
  await cycle;

  assert.deepEqual(said(orchestrator), ['red: Red is still on screen.']);
  assert.equal(orchestrator.agentState('blue').activity, 'waiting');

  round = 2;
  orchestrator.setDisplayGate(() => Promise.resolve());
  const before = provider.calls.length;
  await orchestrator.submit('Hold on, new info.');
  // Blue's held reply comes after the user, reviewed against what they said.
  assert.equal(
    provider.calls.slice(before).find((c) => c.agent === 'blue').kind,
    'review',
  );
  assert.deepEqual(said(orchestrator).slice(1), [
    'blue: Blue is ready but unseen.',
    'red: Noted.',
  ]);
});
