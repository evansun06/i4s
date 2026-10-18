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
    });
  }

  const { Orchestrator } = await import('./core/orchestrator.js');
  const { panel } = await import('./agents/panel.js');
  const { runPlain } = await import('./ui/plain.js');
  process.stdout.write(`Using ${preset.label} (${models.draft}).
`);
  await runPlain(
    new Orchestrator({ agents: panel, provider, callLimit }),
    panel,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Unable to start The Idiots.'}\n`,
  );
  process.exitCode = 1;
});
