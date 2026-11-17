import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAICompatibleProvider } from '../dist/providers/openai-compatible.js';

const request = {
  kind: 'draft',
  system: 'system',
  prompt: 'prompt',
  maxOutputTokens: 100,
};

/** Replaces fetch with a canned SSE stream and records request bodies. */
function stubFetch(t, events) {
  const bodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const text = [...events, '[DONE]']
      .map(
        (event) =>
          `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`,
      )
      .join('');
    return new Response(text, { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return bodies;
}

const options = {
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'test',
  models: { draft: 'm', review: 'm', summary: 'm' },
  maxTokensField: 'max_tokens',
};

async function collect(provider) {
  let text = '';
  for await (const chunk of provider.generate(request)) text += chunk;
  return text;
}

test('usage is requested and reported only when a listener is set', async (t) => {
  const bodies = stubFetch(t, [
    { choices: [{ delta: { content: 'Hello' } }] },
    {
      choices: [],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 64 },
        completion_tokens_details: { reasoning_tokens: 12 },
      },
    },
  ]);

  assert.equal(await collect(new OpenAICompatibleProvider(options)), 'Hello');
  assert.equal(bodies[0].stream_options, undefined);

  const reported = [];
  const measured = new OpenAICompatibleProvider({
    ...options,
    onUsage: (call, usage) => reported.push({ call, usage }),
  });
  assert.equal(await collect(measured), 'Hello');
  assert.deepEqual(bodies[1].stream_options, { include_usage: true });
  assert.equal(reported.length, 1);
  assert.equal(reported[0].call, request);
  assert.deepEqual(reported[0].usage, {
    inputTokens: 120,
    outputTokens: 30,
    cachedInputTokens: 64,
    reasoningTokens: 12,
  });
});
