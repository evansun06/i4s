import password from '@inquirer/password';
import select from '@inquirer/select';
import {
  detectProvider,
  presets,
  type ProviderId,
} from '../providers/presets.js';
import {
  keychain,
  loadSettings,
  saveSettings,
} from '../storage/credentials.js';
import { listSessions, type Session } from '../storage/sessions.js';
import { promptTheme, ansiColor, theme, visibleText } from './theme.js';

const RECENT_SESSIONS = 15;
const choiceText = (text: string) => ansiColor(visibleText(text), theme.text);

/** Offers recent discussions to continue; undefined means start a new one. */
export async function chooseSession(): Promise<Session | undefined> {
  const sessions = (await listSessions()).slice(0, RECENT_SESSIONS);
  if (!sessions.length) return undefined;
  const choice = await select<string>({
    theme: promptTheme,
    message: 'Start a new discussion or continue one?',
    choices: [
      { name: choiceText('New discussion'), value: '' },
      ...sessions.map((session) => ({
        name: choiceText(
          `${session.title}  (${when(session.updatedAt)}, ${session.discussion.log.length} messages)`,
        ),
        value: session.id,
      })),
    ],
  });
  return sessions.find((session) => session.id === choice);
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface ChosenProvider {
  readonly provider: ProviderId;
  readonly apiKey: string;
}

interface FoundKey extends ChosenProvider {
  readonly fromEnv: boolean;
}

// Custom endpoints need --base-url, so they are only reachable through flags.
const MENU_PROVIDERS = [
  'gemini',
  'anthropic',
  'openai',
  'openrouter',
] as const satisfies readonly ProviderId[];

/**
 * Picks the provider and key for this session. With `--provider`, uses that
 * provider directly; otherwise offers every saved key plus a way to add one.
 */
export async function chooseProvider(
  requested?: ProviderId,
): Promise<ChosenProvider> {
  let chosen: ChosenProvider;
  if (requested) {
    chosen = (await findKey(requested)) ?? (await addKey(requested));
  } else {
    const { lastProvider } = await loadSettings();
    const found = (await Promise.all(MENU_PROVIDERS.map(findKey)))
      .filter((key) => key !== undefined)
      .sort(
        (a, b) =>
          Number(b.provider === lastProvider) -
          Number(a.provider === lastProvider),
      );
    const choice = found.length
      ? await select<ProviderId | 'add'>({
          theme: promptTheme,
          message: 'Which provider should the panel use?',
          choices: [
            ...found.map((key) => ({
              name: choiceText(describe(key)),
              value: key.provider,
            })),
            {
              name: choiceText('Add or change an API key'),
              value: 'add' as const,
            },
          ],
        })
      : 'add';
    chosen = found.find((key) => key.provider === choice) ?? (await addKey());
  }
  await saveSettings({ lastProvider: chosen.provider });
  return chosen;
}

async function findKey(provider: ProviderId): Promise<FoundKey | undefined> {
  const fromEnv = process.env[presets[provider].envVar]?.trim();
  if (fromEnv) return { provider, apiKey: fromEnv, fromEnv: true };
  const saved = await keychain.get(provider);
  return saved ? { provider, apiKey: saved, fromEnv: false } : undefined;
}

function describe({ provider, apiKey, fromEnv }: FoundKey): string {
  const { label, envVar } = presets[provider];
  const source = fromEnv ? `from $${envVar}` : `key ending ${apiKey.slice(-4)}`;
  return `${label} (${source})`;
}

/** Asks for a key, works out its provider if not given, and saves it. */
async function addKey(provider?: ProviderId): Promise<ChosenProvider> {
  let apiKey = '';
  while (!apiKey) {
    apiKey = (
      await password({
        theme: promptTheme,
        message: provider
          ? `Enter your ${presets[provider].label} API key:`
          : 'Paste an API key (Gemini, ChatGPT/OpenAI, Claude, or OpenRouter):',
        mask: true,
      })
    ).trim();
  }
  const resolved =
    provider ??
    detectProvider(apiKey) ??
    (await select<ProviderId>({
      theme: promptTheme,
      message: 'Which provider is this key for?',
      choices: MENU_PROVIDERS.map((id) => ({
        name: choiceText(presets[id].label),
        value: id,
      })),
    }));
  await keychain.set(resolved, apiKey);
  process.stdout.write(
    ansiColor(
      `${presets[resolved].label} key saved to your system keychain.\n`,
      theme.text,
    ),
  );
  return { provider: resolved, apiKey };
}
