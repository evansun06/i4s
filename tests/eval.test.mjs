import assert from 'node:assert/strict';
import test from 'node:test';
import { panel } from '../dist/agents/panel.js';
import { runDebate } from '../dist/eval/debate.js';
import { judge, parseJudgment, seededRandom } from '../dist/eval/judge.js';
import { MeasuredProvider } from '../dist/eval/measure.js';
import { categorize } from '../dist/eval/pipeline.js';
import { summaryMarkdown } from '../dist/eval/report.js';

/**
 * A fake provider factory: `script(request)` returns the reply, streamed in
 * two chunks; usage is reported after the last chunk, as real streams do.
 */
function fakeFactory(script) {
  return (onUsage) => ({
    async *generate(request) {
      const reply = await script(request);
      const middle = Math.ceil(reply.length / 2);
      yield reply.slice(0, middle);
      yield reply.slice(middle);
      onUsage(request, {
        inputTokens: request.prompt.length,
        outputTokens: reply.length,
      });
    },
  });
}

const problem = {
  id: 'fake',
  category: 'test',
  prompt: 'Should I do it?',
  followUps: ['More facts.', 'Even more facts.', 'Final answer please.'],
};
const settings = {
  callLimit: 200,
  compactAtTokens: 60,
  keepTokens: 30,
  roundTimeoutMs: 10_000,
};
const agentOf = (request) =>
  panel.find((agent) => agent.systemPrompt === request.system)?.id;
const script = (request) => {
  if (request.kind === 'summary') return 'Condensed earlier rounds.';
  if (request.kind === 'review') return 'KEEP';
  if (request.system.startsWith('You write the final recommendation'))
    return 'Do it, carefully.';
  return agentOf(request) === 'red' || agentOf(request) === 'blue'
    ? `SPEAK\n${'point '.repeat(30)}`
    : 'PASS';
};

test('usage is recorded even when the room stops reading at PASS', async () => {
  const provider = new MeasuredProvider(
    fakeFactory(() => 'PASS\nunread rest'),
    () => 'red',
  );
  for await (const chunk of provider.generate({
    kind: 'draft',
    system: 's',
    prompt: 'twelve chars',
    maxOutputTokens: 10,
  })) {
    assert.ok(chunk);
    break;
  }
  await provider.settled();
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].outcome, 'ok');
  assert.equal(provider.calls[0].inputTokens, 12);
});

test('the two history configs differ only in condensing', async () => {
  const [full, summary] = await Promise.all(
    ['full', 'summary'].map((config) =>
      runDebate(problem, config, fakeFactory(script), settings),
    ),
  );
  for (const result of [full, summary]) {
    assert.equal(result.completed, true);
    assert.equal(result.agentTurns, 8);
    assert.equal(result.finalRecommendation, 'Do it, carefully.');
    assert.equal(result.synthesisCall.kind, 'synthesis');
    assert.ok(result.calls.every((call) => call.inputTokens !== undefined));
    assert.ok(!result.calls.some((call) => call.kind === 'synthesis'));
  }
  assert.equal(full.calls.filter((c) => c.kind === 'summary').length, 0);
  assert.equal(full.foldedUpTo, 0);
  assert.ok(summary.calls.some((c) => c.kind === 'summary'));
  assert.ok(summary.foldedUpTo > 0);
  // Summaries keep later prompts smaller than the full log.
  const lastDraft = (result) =>
    result.calls.findLast((call) => call.kind === 'draft').inputTokens;
  assert.ok(lastDraft(summary) < lastDraft(full));
});

test('the judge sees unlabeled responses and scores map back by config', async () => {
  const results = Object.fromEntries(
    await Promise.all(
      ['full', 'summary'].map(async (config) => [
        config,
        await runDebate(problem, config, fakeFactory(script), settings),
      ]),
    ),
  );
  const prompts = [];
  let replies = [
    'not json',
    '{"response1":{"relevance":5,"specificity":4,"rebuttals":3},"response2":{"relevance":2,"specificity":2,"rebuttals":1},"preferred":"1","weaknesses":{"response1":"w1","response2":"w2"},"rationale":"r"}',
  ];
  const provider = new MeasuredProvider(
    fakeFactory((request) => {
      prompts.push(request.prompt);
      return replies.shift();
    }),
    () => 'judge',
  );
  const judgment = await judge(problem, results, provider, seededRandom(3));
  assert.equal(judgment.attempts, 2);
  assert.doesNotMatch(prompts[0], /\bfull\b|summary|SUMMARY/i);
  assert.deepEqual(judgment.scores[judgment.order[0]], {
    relevance: 5,
    specificity: 4,
    rebuttals: 3,
  });
  assert.equal(judgment.scores[judgment.order[1]].rebuttals, 1);
  assert.equal(judgment.preferred, judgment.order[0]);
  assert.equal(judgment.weaknesses[judgment.order[1]], 'w2');

  const markdown = summaryMarkdown({
    meta: { problems: ['fake'] },
    runs: Object.values(results),
    judgments: [judgment],
  });
  assert.match(markdown, /Debates completed \| 1 \/ 1 \| 1 \/ 1/);
});

test('judge replies must score every criterion from 1 to 5', () => {
  assert.equal(parseJudgment('{"response1":{"relevance":6}}'), undefined);
  assert.equal(
    parseJudgment(
      '{"response1":{"relevance":1,"specificity":2,"rebuttals":3},"response2":{"relevance":1,"specificity":2}}',
    ),
    undefined,
  );
  assert.deepEqual(seededRandom(9)(), seededRandom(9)());
});

test('pipeline error codes map to reported reasons', () => {
  assert.equal(categorize('prerequisite_cycle'), 'cycle');
  assert.equal(categorize('edge_endpoint'), 'invalid-reference');
  assert.equal(categorize('approval_fidelity'), 'unsupported-commitment');
  assert.equal(categorize('step2_generation'), 'schema-or-generation');
  assert.equal(categorize('node_title'), 'other');
});
