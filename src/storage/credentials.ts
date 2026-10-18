import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SERVICE_NAME = 'the-idiots';
const SETTINGS_FILE = join(homedir(), '.the-idiots', 'settings.json');

const account = (provider: string) => `${provider}-api-key`;

/** The part of keytar used here. */
interface Keytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}
let loading: Promise<Keytar | undefined> | undefined;

/**
 * keytar is an optional native module: its binary may be missing (blocked
 * install scripts, an unsupported platform) or the OS keychain unreachable
 * (Linux without libsecret). Any failure means "no keychain", never a crash.
 */
function loadKeytar(): Promise<Keytar | undefined> {
  // A CommonJS module: its functions arrive on `default` or at the top level.
  loading ??= import('keytar').then(
    (module: Keytar & { default?: Keytar }) => module.default ?? module,
    () => undefined,
  );
  return loading;
}

/**
 * API keys live in the OS keychain, one per provider. Without a keychain,
 * nothing is saved: keys come from environment variables or are asked for
 * each session.
 */
export const keychain = {
  async get(provider: string): Promise<string | null> {
    try {
      return (
        (await (
          await loadKeytar()
        )?.getPassword(SERVICE_NAME, account(provider))) ?? null
      );
    } catch {
      return null;
    }
  },
  /** Resolves false if the key could not be saved. */
  async set(provider: string, apiKey: string): Promise<boolean> {
    const keytar = await loadKeytar();
    if (!keytar) return false;
    try {
      await keytar.setPassword(SERVICE_NAME, account(provider), apiKey);
      return true;
    } catch {
      return false;
    }
  },
  async remove(provider: string): Promise<boolean> {
    try {
      return (
        (await (
          await loadKeytar()
        )?.deletePassword(SERVICE_NAME, account(provider))) ?? false
      );
    } catch {
      return false;
    }
  },
};

/** Non-secret preferences; never holds keys. */
export interface Settings {
  readonly lastProvider?: string;
}

export async function loadSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) as Settings;
  } catch {
    return {};
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
}
