import keytar from 'keytar';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SERVICE_NAME = 'the-idiots';
const SETTINGS_FILE = join(homedir(), '.the-idiots', 'settings.json');

const account = (provider: string) => `${provider}-api-key`;

/** API keys live in the OS keychain, one per provider. */
export const keychain = {
  get: (provider: string) =>
    keytar.getPassword(SERVICE_NAME, account(provider)),
  set: (provider: string, apiKey: string) =>
    keytar.setPassword(SERVICE_NAME, account(provider), apiKey),
  remove: (provider: string) =>
    keytar.deletePassword(SERVICE_NAME, account(provider)),
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
