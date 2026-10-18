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
          message: 'Which provider should the panel use?',
          choices: [
            ...found.map((key) => ({
              name: describe(key),
              value: key.provider,
            })),
            { name: 'Add or change an API key', value: 'add' as const },
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
      message: 'Which provider is this key for?',
      choices: MENU_PROVIDERS.map((id) => ({
        name: presets[id].label,
        value: id,
      })),
    }));
  await keychain.set(resolved, apiKey);
  process.stdout.write(
    `${presets[resolved].label} key saved to your system keychain.\n`,
  );
  return { provider: resolved, apiKey };
}
