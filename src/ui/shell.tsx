import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, useApp } from 'ink';
import type { AgentId } from '../core/types.js';
import { presets, type ProviderId } from '../providers/presets.js';
import type { Session } from '../storage/sessions.js';
import { App } from './app.js';
import type { ChatController } from './controller.js';
import { KeyEntry, KeyList } from './key-screens.js';
import { describeKey, type ApiKey, type KeyStore } from './keys.js';
import { Lobby, Screen, type LobbyChoice } from './lobby.js';
import type { SpriteAnimations } from './sprites.js';
import { theme } from './theme.js';

type View =
  | { kind: 'loading' }
  | { kind: 'lobby' }
  | { kind: 'keys' }
  | { kind: 'add'; first: boolean; provider?: ProviderId | undefined }
  | { kind: 'chat'; id: number; controller: ChatController; label: string };

/**
 * The full-screen app: the lobby, its key screens, and the chat opened from
 * it. /lobby saves and closes the chat, then returns here.
 */
export function Shell({
  keys,
  requested,
  loadSessions,
  openChat,
  labelFor,
  sprites,
}: {
  keys: KeyStore;
  /** --provider: chats use this provider's key, asking for it if missing. */
  requested?: ProviderId | undefined;
  loadSessions: () => Promise<readonly Session[]>;
  /** Builds the room for a new (undefined) or saved discussion; may throw. */
  openChat: (choice: LobbyChoice, key: ApiKey) => ChatController;
  /** The provider and model a key chats with. */
  labelFor: (key: ApiKey) => string;
  sprites: Record<AgentId, SpriteAnimations>;
}) {
  const { exit } = useApp();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [saved, setSaved] = useState<readonly ApiKey[]>([]);
  const [active, setActive] = useState<ApiKey>();
  const [sessions, setSessions] = useState<readonly Session[]>();
  const [notice, setNotice] = useState<string>();
  const opened = useRef(0);

  const refresh = useCallback(async () => {
    const [list, current] = await Promise.all([keys.list(), keys.active()]);
    setSaved(list);
    setActive(current);
    return list;
  }, [keys]);
  const report = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : 'Something went wrong.');
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await refresh();
      if (requested && !list.some((key) => key.provider === requested)) {
        setView({ kind: 'add', first: !list.length, provider: requested });
        return;
      }
      if (requested) {
        await keys.use(requested);
        await refresh();
      }
      setView(list.length ? { kind: 'lobby' } : { kind: 'add', first: true });
    })().catch(report);
  }, [keys, refresh, report, requested]);

  const inLobby = view.kind === 'lobby';
  useEffect(() => {
    if (!inLobby) return;
    let live = true;
    void loadSessions().then(
      (list) => live && setSessions(list),
      () => live && setSessions([]),
    );
    return () => {
      live = false;
    };
  }, [inLobby, loadSessions]);

  const quit = useCallback(() => exit(), [exit]);
  const toLobby = useCallback(() => setView({ kind: 'lobby' }), []);
  const choose = useCallback(
    (choice: LobbyChoice) => {
      if (!active) return setView({ kind: 'add', first: true });
      try {
        const controller = openChat(choice, active);
        setNotice(undefined);
        setView({
          kind: 'chat',
          id: ++opened.current,
          controller,
          label: labelFor(active),
        });
      } catch (error) {
        report(error);
      }
    },
    [active, labelFor, openChat, report],
  );
  const close = useCallback(
    (to: 'quit' | 'lobby') => (to === 'lobby' ? toLobby() : exit()),
    [exit, toLobby],
  );
  const add = useCallback(
    (provider: ProviderId, apiKey: string) => {
      void (async () => {
        const key = await keys.add(provider, apiKey);
        await refresh();
        const { label } = presets[provider];
        setNotice(
          key.source === 'keychain'
            ? `${label} key saved to your system keychain. New chats use it.`
            : `No system keychain is available, so this ${label} key lasts until you quit.`,
        );
        setView({ kind: 'lobby' });
      })().catch(report);
    },
    [keys, refresh, report],
  );
  const use = useCallback(
    (key: ApiKey) => {
      void (async () => {
        await keys.use(key.provider);
        await refresh();
        setNotice(`New chats use ${describeKey(key)}.`);
        setView({ kind: 'lobby' });
      })().catch(report);
    },
    [keys, refresh, report],
  );
  const remove = useCallback(
    (key: ApiKey) => {
      if (key.source === 'env') {
        setNotice(
          `That key comes from $${presets[key.provider].envVar}; unset it to remove it.`,
        );
        return;
      }
      void (async () => {
        await keys.remove(key.provider);
        const list = await refresh();
        setNotice(`Removed the ${presets[key.provider].label} key.`);
        if (!list.length) setView({ kind: 'add', first: true });
      })().catch(report);
    },
    [keys, refresh, report],
  );

  switch (view.kind) {
    case 'loading':
      return (
        <Screen>
          <Text color={theme.muted}>{notice ?? 'Loading…'}</Text>
        </Screen>
      );
    case 'chat':
      return (
        <App
          key={view.id}
          controller={view.controller}
          sprites={sprites}
          providerLabel={view.label}
          onClose={close}
        />
      );
    case 'add':
      return (
        <KeyEntry
          first={view.first}
          provider={view.provider}
          onSubmit={add}
          onBack={() => setView({ kind: 'keys' })}
          onQuit={quit}
        />
      );
    case 'keys':
      return (
        <KeyList
          keys={saved}
          active={active}
          notice={notice}
          onUse={use}
          onRemove={remove}
          onAdd={() => {
            setNotice(undefined);
            setView({ kind: 'add', first: false });
          }}
          onBack={toLobby}
          onQuit={quit}
        />
      );
    case 'lobby':
      return (
        <Lobby
          sessions={sessions}
          sprites={sprites}
          keyLabel={active ? labelFor(active) : ''}
          notice={notice}
          onChoose={choose}
          onKeys={() => {
            setNotice(undefined);
            setView({ kind: 'keys' });
          }}
          onQuit={quit}
        />
      );
  }
}
