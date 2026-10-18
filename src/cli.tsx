#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  isProviderId,
  presets,
  type ProviderPreset,
} from './providers/presets.js';
import type { ModelProvider } from './providers/model.js';

const HELP = `The Idiots — four perspectives, one discussion.

Usage: i4s [options]

  --plain              Run the discussion as a plain transcript
  --provider <id>      Skip the menu: ${Object.keys(presets).join(' | ')}
  --model <name>       Model for every call, overriding the provider default
  --base-url <url>     OpenAI-compatible endpoint (required for custom)
  --call-limit <n>     Hard limit on model calls this session (default: 100)
  --wpm <n>            Reading speed for replies (default: 340; 0 for instant)
  --temperature <t>    Boldness, 0 (generic) to 1 (full personality); 0.5 is
                       normal. "0.7" for everyone, or
                       per agent, e.g. "yellow=0.9,blue=0.2". Change it while
                       chatting with /temp.
  --angry              Start with angry mode on: the advisors take offense
                       and insult each other. Toggle it with /angry.
  --forget-key         Remove the saved key for --provider (or the last used)
  -h, --help           Show this help
  -v, --version        Show the version

At startup, pick a saved key or paste a new one; the provider is detected
from the key. Keys in a provider's environment variable (such as
GEMINI_API_KEY) are used as is. Press q or Ctrl+C to quit.
`;

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      plain: { type: 'boolean' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      'call-limit': { type: 'string' },
      wpm: { type: 'string' },
      temperature: { type: 'string' },
      angry: { type: 'boolean' },
      'forget-key': { type: 'boolean' },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (values.version) {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    process.stdout.write(`${packageJson.version}
`);
    return;
  }

  const requested = values.provider ?? process.env.I4S_PROVIDER;
  if (requested !== undefined && !isProviderId(requested)) {
    throw new Error(
      `Unknown provider "${requested}". Use one of: ${Object.keys(presets).join(', ')}.`,
    );
  }

  if (values['forget-key']) {
    const { keychain, loadSettings } = await import('./storage/credentials.js');
    const target = requested ?? (await loadSettings()).lastProvider;
    if (target === undefined || !isProviderId(target)) {
      throw new Error('Choose which key to remove with --provider.');
    }
    const { label } = presets[target];
    process.stdout.write(
      (await keychain.remove(target))
        ? `${label} API key removed.
`
        : `No saved ${label} API key found.
`,
    );
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run i4s in an interactive terminal, or use --help.');
  }

  if (!values.plain) {
    const { render } = await import('ink');
    const { App } = await import('./ui/app.js');
    await render(<App />).waitUntilExit();
    return;
  }

  const callLimit = Number(values['call-limit'] ?? 100);
  if (!Number.isInteger(callLimit) || callLimit <= 0) {
    throw new Error('--call-limit must be a positive whole number.');
  }
  const wordsPerMinute = Number(values.wpm ?? 340);
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute < 0) {
    throw new Error('--wpm must be 0 or a positive number.');
  }
  const { panel } = await import('./agents/panel.js');
  const { parseTemperatures } = await import('./ui/temperature.js');
  const temperatures =
    values.temperature === undefined
      ? []
      : parseTemperatures(
          values.temperature,
          panel.map((agent) => agent.id),
        );
  if (!temperatures) {
    throw new Error(
      '--temperature takes 0 to 1, e.g. "0.7" or "yellow=0.9,blue=0.2".',
    );
  }

  const { chooseProvider } = await import('./ui/setup.js');
  const { provider: providerId, apiKey } = await chooseProvider(requested);
  const preset: ProviderPreset = presets[providerId];
  const models = values.model
    ? { draft: values.model, review: values.model, summary: values.model }
    : preset.models;
  if (!models) throw new Error(`${preset.label} needs --model.`);

  let provider: ModelProvider;
  if (preset.api === 'anthropic') {
    const { AnthropicProvider } = await import('./providers/anthropic.js');
    provider = new AnthropicProvider({ apiKey, models });
  } else {
    const baseUrl = values['base-url'] ?? preset.baseUrl;
    if (!baseUrl) throw new Error(`${preset.label} needs --base-url.`);
    const { OpenAICompatibleProvider } =
      await import('./providers/openai-compatible.js');
    provider = new OpenAICompatibleProvider({
      baseUrl,
      apiKey,
      models,
      maxTokensField: preset.maxTokensField,
      ...(preset.extraBody && { extraBody: preset.extraBody }),
      ...(preset.highEffort && { highEffort: preset.highEffort }),
    });
  }

  process.stdout.write(`Using ${preset.label} (${models.draft}).\n`);
  const { chooseSession } = await import('./ui/setup.js');
  const { newSessionId, saveSession, titleFor } =
    await import('./storage/sessions.js');
  const session = await chooseSession();

  const { Orchestrator } = await import('./core/orchestrator.js');
  const { runPlain } = await import('./ui/plain.js');
  const orchestrator = new Orchestrator({
    agents: panel,
    provider,
    callLimit,
    ...(session && { restore: session.discussion }),
  });
  // A flag given now wins over what the discussion was saved with.
  if (values.angry) orchestrator.setAngry(true);
  for (const { target, value } of temperatures) {
    orchestrator.setTemperature(target, value);
  }
  const id = session?.id ?? newSessionId();
  const createdAt = session?.createdAt ?? new Date().toISOString();
  await runPlain(orchestrator, panel, {
    wordsPerMinute,
    // Saved after every round, so quitting at any prompt loses nothing.
    afterRound: async () => {
      const discussion = orchestrator.save();
      await saveSession({
        version: 1,
        id,
        title: session?.title ?? titleFor(discussion),
        createdAt,
        updatedAt: new Date().toISOString(),
        discussion,
      });
    },
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Unable to start The Idiots.'}\n`,
  );
  process.exitCode = 1;
});
