import { useState } from 'react';
import { Box, Text, useInput, usePaste, useWindowSize } from 'ink';
import {
  detectProvider,
  presets,
  type ProviderId,
} from '../providers/presets.js';
import { step } from './editor.js';
import { describeKey, MENU_PROVIDERS, type ApiKey } from './keys.js';
import { Screen, Title } from './lobby.js';
import { theme, visibleText } from './theme.js';

/**
 * Paste (or type) an API key. The provider is worked out from the key, and
 * asked for only when it can't be. The key itself is never shown.
 */
export function KeyEntry({
  first,
  provider,
  onSubmit,
  onBack,
  onQuit,
}: {
  /** No keys yet: the welcome screen, where Esc quits. */
  first: boolean;
  /** Required provider (from --provider), skipping detection. */
  provider?: ProviderId | undefined;
  onSubmit: (provider: ProviderId, apiKey: string) => void;
  onBack: () => void;
  onQuit: () => void;
}) {
  const { columns } = useWindowSize();
  const [text, setText] = useState('');
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string>();
  const width = Math.max(20, Math.min(columns - 4, 64));
  const append = (value: string) => {
    setText((current) => current + value.replace(/\s+/g, ''));
    setError(undefined);
  };
  usePaste(append, { isActive: !picking });
  useInput((input, key) => {
    if (key.ctrl && input === 'c') return onQuit();
    if (picking) {
      const count = MENU_PROVIDERS.length;
      if (key.escape) setPicking(false);
      else if (key.upArrow) setSelected(step(selected, -1, count));
      else if (key.downArrow) setSelected(step(selected, 1, count));
      else if (key.return) onSubmit(MENU_PROVIDERS[selected]!, text);
      return;
    }
    if (key.escape) return first ? onQuit() : onBack();
    if (key.return) {
      if (!text) return setError('Paste a key first.');
      const found = provider ?? detectProvider(text);
      if (found) onSubmit(found, text);
      else setPicking(true);
      return;
    }
    if (key.backspace || key.delete) setText((current) => current.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) append(input);
  });

  return (
    <Screen>
      {first && (
        <>
          <Box height={2} flexShrink={0} />
          <Title columns={columns} />
          <Box height={2} flexShrink={0} />
        </>
      )}
      <Text color={theme.bright} bold>
        {first
          ? 'Paste in your first key to get started'
          : provider
            ? `Add your ${presets[provider].label} API key`
            : 'Add an API key'}
      </Text>
      <Box width={width} marginTop={1} flexDirection="column">
        {provider ? null : (
          <Text color={theme.text}>
            Gemini (AIza…), Claude (sk-ant-…), ChatGPT (sk-…), or OpenRouter
            (sk-or-…). The provider is detected from the key.
          </Text>
        )}
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={theme.border}
          paddingX={1}
        >
          <Text color={text ? theme.bright : theme.muted} wrap="truncate">
            {text
              ? `${'•'.repeat(Math.min(text.length, width - 20))} ${text.length} characters`
              : 'Paste your key here…'}
          </Text>
        </Box>
        {picking ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.text}>Which provider is this key for?</Text>
            {MENU_PROVIDERS.map((id, index) => (
              <Text
                key={id}
                color={index === selected ? theme.bright : theme.text}
                bold={index === selected}
              >
                {index === selected ? '› ' : '  '}
                {presets[id].label}
              </Text>
            ))}
          </Box>
        ) : (
          <Text color={error ? theme.agents.red.light : theme.muted}>
            {error ??
              'Saved in your system keychain, and sent only to that provider.'}
          </Text>
        )}
      </Box>
      <Box width={width} marginTop={1}>
        <Text color={theme.muted}>
          {picking
            ? '↑↓ choose · Enter save · Esc back'
            : `Enter save · Backspace delete · Esc ${first ? 'quit' : 'back'}`}
        </Text>
      </Box>
    </Screen>
  );
}

/** Saved keys: choose the one chats use, remove one, or add another. */
export function KeyList({
  keys,
  active,
  notice,
  onUse,
  onRemove,
  onAdd,
  onBack,
  onQuit,
}: {
  keys: readonly ApiKey[];
  active: ApiKey | undefined;
  notice?: string | undefined;
  onUse: (key: ApiKey) => void;
  onRemove: (key: ApiKey) => void;
  onAdd: () => void;
  onBack: () => void;
  onQuit: () => void;
}) {
  const { columns } = useWindowSize();
  const [selected, setSelected] = useState(0);
  const count = keys.length + 1;
  const selection = Math.min(selected, count - 1);
  const current = keys[selection];
  const width = Math.max(20, Math.min(columns - 4, 64));
  useInput((input, key) => {
    if (key.ctrl && input === 'c') onQuit();
    else if (key.escape) onBack();
    else if (key.upArrow) setSelected(step(selection, -1, count));
    else if (key.downArrow) setSelected(step(selection, 1, count));
    else if (key.return) {
      if (current) onUse(current);
      else onAdd();
    } else if ((key.backspace || key.delete) && current) onRemove(current);
  });
  return (
    <Screen>
      <Text color={theme.bright} bold>
        API keys
      </Text>
      <Box width={width} marginTop={1} flexDirection="column">
        {keys.map((key, index) => {
          const chosen = index === selection;
          const inUse = key.provider === active?.provider;
          return (
            <Box key={key.provider} columnGap={1}>
              <Text color={chosen ? theme.bright : theme.muted}>
                {chosen ? '›' : ' '}
              </Text>
              <Text color={inUse ? theme.bright : theme.muted}>
                {inUse ? '●' : '○'}
              </Text>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text
                  color={chosen ? theme.bright : theme.text}
                  bold={chosen}
                  wrap="truncate"
                >
                  {describeKey(key)}
                </Text>
              </Box>
              {inUse && <Text color={theme.muted}>in use</Text>}
            </Box>
          );
        })}
        <Box columnGap={1}>
          <Text color={selection === keys.length ? theme.bright : theme.muted}>
            {selection === keys.length ? '›' : ' '}
          </Text>
          <Text
            color={selection === keys.length ? theme.bright : theme.text}
            bold={selection === keys.length}
          >
            + Add a key
          </Text>
        </Box>
      </Box>
      <Box width={width} marginTop={1}>
        <Text color={theme.text} wrap="truncate">
          {notice ? visibleText(notice) : ' '}
        </Text>
      </Box>
      <Box width={width}>
        <Text color={theme.muted} wrap="truncate">
          ↑↓ choose · Enter use · Backspace remove · Esc back
        </Text>
      </Box>
    </Screen>
  );
}
