import { presets, type ProviderId } from '../providers/presets.js';
import {
  keychain as systemKeychain,
  loadSettings,
  saveSettings,
  type Settings,
} from '../storage/credentials.js';

// Custom endpoints need --base-url, so they are only reachable through flags.
export const MENU_PROVIDERS = [
  'gemini',
  'anthropic',
  'openai',
  'openrouter',
] as const satisfies readonly ProviderId[];

export interface ApiKey {
  readonly provider: ProviderId;
  readonly apiKey: string;
  /** env: the provider's environment variable, which the app can't remove.
   * session: no keychain was available, so it lasts until the app quits. */
  readonly source: 'env' | 'keychain' | 'session';
}

export function describeKey({ provider, apiKey, source }: ApiKey): string {
  const { label, envVar } = presets[provider];
  return source === 'env'
    ? `${label} · from $${envVar}`
    : `${label} · key ending ${apiKey.slice(-4)}${source === 'session' ? ' · this session only' : ''}`;
}

/** The API keys the app can use, and which one chats use. */
export interface KeyStore {
  /** Every usable key, one per provider: environment first, then saved. */
  list(): Promise<ApiKey[]>;
  /** Saves to the keychain, or for this session when there is none. */
  add(provider: ProviderId, apiKey: string): Promise<ApiKey>;
  /** Forgets a saved key; environment keys stay. */
  remove(provider: ProviderId): Promise<void>;
  /** The key chats use: the last one chosen, else the first available. */
  active(): Promise<ApiKey | undefined>;
  use(provider: ProviderId): Promise<void>;
}

export function createKeyStore({
  providers = MENU_PROVIDERS,
  env = process.env,
  keychain = systemKeychain,
  settings = { load: loadSettings, save: saveSettings },
}: {
  providers?: readonly ProviderId[];
  env?: Record<string, string | undefined>;
  keychain?: Pick<typeof systemKeychain, 'get' | 'set' | 'remove'>;
  settings?: {
    load: () => Promise<Settings>;
    save: (settings: Settings) => Promise<void>;
  };
} = {}): KeyStore {
  const session = new Map<ProviderId, string>();
  const find = async (provider: ProviderId): Promise<ApiKey | undefined> => {
    const fromEnv = env[presets[provider].envVar]?.trim();
    if (fromEnv) return { provider, apiKey: fromEnv, source: 'env' };
    const saved = await keychain.get(provider);
    if (saved) return { provider, apiKey: saved, source: 'keychain' };
    const kept = session.get(provider);
    return kept ? { provider, apiKey: kept, source: 'session' } : undefined;
  };
  const store: KeyStore = {
    async list() {
      return (await Promise.all(providers.map(find))).filter(
        (key) => key !== undefined,
      );
    },
    async add(provider, apiKey) {
      const saved = await keychain.set(provider, apiKey);
      if (!saved) session.set(provider, apiKey);
      else session.delete(provider);
      await store.use(provider);
      return { provider, apiKey, source: saved ? 'keychain' : 'session' };
    },
    async remove(provider) {
      session.delete(provider);
      await keychain.remove(provider);
    },
    async active() {
      const keys = await store.list();
      const { lastProvider } = await settings.load();
      return keys.find((key) => key.provider === lastProvider) ?? keys[0];
    },
    async use(provider) {
      await settings.save({
        ...(await settings.load()),
        lastProvider: provider,
      });
    },
  };
  return store;
}
