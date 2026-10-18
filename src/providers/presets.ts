import type { ModelRequest } from './model.js';
import type { OpenAICompatibleOptions } from './openai-compatible.js';

type Models = Readonly<Record<ModelRequest['kind'], string>>;

export interface ProviderPreset {
  readonly label: string;
  /** Which adapter talks to this provider. */
  readonly api: 'openai-compatible' | 'anthropic';
  readonly baseUrl?: string;
  /** Checked before the OS keychain. */
  readonly envVar: string;
  /** Recognizes this provider's keys, so a pasted key picks its provider. */
  readonly keyPattern?: RegExp;
  readonly models?: Models;
  readonly maxTokensField: OpenAICompatibleOptions['maxTokensField'];
  readonly extraBody?: OpenAICompatibleOptions['extraBody'];
  /** How to ask for high reasoning effort; absent means it isn't sent. */
  readonly highEffort?: OpenAICompatibleOptions['highEffort'];
}

const every = (model: string): Models => ({
  draft: model,
  review: model,
  summary: model,
});

// Key patterns are checked in this order, so the more specific `sk-ant-` and
// `sk-or-` prefixes come before OpenAI's plain `sk-`.
export const presets = {
  gemini: {
    label: 'Gemini',
    api: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envVar: 'GEMINI_API_KEY',
    keyPattern: /^AIza/,
    models: every('gemini-3.8-flash'),
    maxTokensField: 'max_tokens',
    extraBody: { reasoning_effort: 'low' },
    highEffort: { reasoning_effort: 'high' },
  },
  anthropic: {
    label: 'Claude',
    api: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    keyPattern: /^sk-ant-/,
    models: every('claude-opus-5-5'),
    maxTokensField: 'max_tokens',
  },
  openrouter: {
    label: 'OpenRouter',
    api: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    keyPattern: /^sk-or-/,
    models: every('openrouter/auto'),
    maxTokensField: 'max_tokens',
    highEffort: { reasoning: { effort: 'high' } },
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    api: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
    keyPattern: /^sk-/,
    models: every('gpt-5.5'),
    maxTokensField: 'max_completion_tokens',
    highEffort: { reasoning_effort: 'high' },
  },
  // Any other OpenAI-compatible server, including local ones; needs --base-url.
  custom: {
    label: 'Custom',
    api: 'openai-compatible',
    envVar: 'I4S_API_KEY',
    maxTokensField: 'max_tokens',
  },
} as const satisfies Record<string, ProviderPreset>;

export type ProviderId = keyof typeof presets;

export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(presets, value);
}

export function detectProvider(apiKey: string): ProviderId | undefined {
  return (Object.keys(presets) as ProviderId[]).find((id) => {
    const preset: ProviderPreset = presets[id];
    return preset.keyPattern?.test(apiKey);
  });
}
