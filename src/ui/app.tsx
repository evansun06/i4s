import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Box,
  Text,
  useApp,
  useBoxMetrics,
  useInput,
  useIsScreenReaderEnabled,
  usePaste,
  useWindowSize,
  type DOMElement,
} from 'ink';
import { agentIds, identities } from '../agents/identity.js';
import type { AgentId } from '../core/types.js';
import { complete } from './commands.js';
import type { ChatController, PresentationSnapshot } from './controller.js';
import { edit, editorWindow, type EditorState } from './editor.js';
import { IdleAnimation, type SpriteFrame } from './sprites.js';
import { theme, visibleText } from './theme.js';

export function activityLabel(
  state: PresentationSnapshot,
  id: AgentId,
): string {
  if (state.displaying === id)
    return state.room.mode === 'paused' ? 'paused speaking' : 'speaking';
  if (state.waiting.includes(id)) return 'waiting';
  const activity = state.room.agents[id].activity;
  if (activity === 'speaking') return 'waiting';
  if (activity === 'has-question')
    return state.question?.agent === id ? 'asking you' : 'waiting';
  if (activity === 'deliberating') return 'thinking deeply';
  if (activity === 'passing') return 'passed';
  return activity;
}

export function roomLabel(state: PresentationSnapshot): string {
  if (state.closing) return 'Saving…';
  if (state.room.mode === 'paused') return 'Paused';
  if (state.displaying || state.waiting.length) return 'Discussion';
  if (state.question) return `Answer ${identities[state.question.agent].name}`;
  if (state.room.mode === 'initial-prompt') return 'Ready';
  return state.room.mode === 'running' ? 'Thinking' : 'Your turn';
}

export function CharacterRow({
  state,
  sprites,
  compact,
  tick,
}: {
  state: PresentationSnapshot;
  sprites: Record<AgentId, readonly SpriteFrame[]>;
  compact: boolean;
  tick: number;
}) {
  const reducedMotion =
    useIsScreenReaderEnabled() || process.env.NO_COLOR !== undefined;
  const clocks = useMemo(
    () =>
      Object.fromEntries(
        agentIds.map((id) => [
          id,
          new IdleAnimation(
            sprites[id].map((frame) => frame.duration),
            Date.now(),
          ),
        ]),
      ) as Record<AgentId, IdleAnimation>,
    [sprites],
  );
  return (
    <Box
      justifyContent="center"
      columnGap={compact ? 1 : 3}
      rowGap={0}
      flexShrink={0}
      flexWrap={compact ? 'wrap' : 'nowrap'}
    >
      {agentIds.map((id) => {
        const frame = sprites[id][reducedMotion ? 0 : clocks[id].frame(tick)]!;
        const colors = theme.agents[id];
        return (
          <Box
            key={id}
            width={compact ? 15 : 16}
            flexDirection="column"
            alignItems="center"
          >
            {!compact && (
              <Box flexDirection="column" aria-hidden>
                {frame.rows.map((row, y) => (
                  <Text key={y}>
                    {row.map((cell, x) => (
                      <Text
                        key={x}
                        color={cell.foreground ?? theme.text}
                        backgroundColor={cell.background ?? theme.background}
                      >
                        {cell.glyph}
                      </Text>
                    ))}
                  </Text>
                ))}
              </Box>
            )}
            <Text color={colors.light} bold>
              {identities[id].name} <Text color={theme.muted}>{id}</Text>
            </Text>
            <Text color={state.displaying === id ? colors.glow : theme.text}>
              {activityLabel(state, id)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function App({
  controller,
  sprites,
  providerLabel,
}: {
  controller: ChatController;
  sprites: Record<AgentId, readonly SpriteFrame[]>;
  providerLabel: string;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const reducedMotion =
    useIsScreenReaderEnabled() || process.env.NO_COLOR !== undefined;
  const [tick, setTick] = useState(Date.now);
  const [pulse, setPulse] = useState(0);
  const [editor, setEditor] = useState<EditorState>({ text: '', cursor: 0 });
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const history = useRef<string[]>([]);
  const historyDraft = useRef('');
  const historyAt = useRef(0);
  const [scrollTop, setScrollTop] = useState<number | undefined>();
  const contentRef = useRef<DOMElement>(null);
  const content = useBoxMetrics(contentRef);
  const closeStarted = useRef(false);
  const suggestions = dismissed ? [] : complete(editor.text, editor.cursor);
  const selection = Math.min(selected, Math.max(0, suggestions.length - 1));
  const compact = columns < 76 || rows < 24;
  const characterHeight = compact
    ? Math.ceil(4 / Math.max(1, Math.floor((columns - 1) / 16))) * 2
    : 10;
  const suggestionCount = Math.max(0, Math.min(4, rows - characterHeight - 10));
  const suggestionStart = Math.max(0, selection - suggestionCount + 1);
  const visibleSuggestions = suggestions.slice(
    suggestionStart,
    suggestionStart + suggestionCount,
  );
  const chatHeight = Math.max(
    1,
    rows - characterHeight - 9 - visibleSuggestions.length,
  );
  const bottom = Math.max(0, content.height - chatHeight);
  const offset = Math.min(scrollTop ?? bottom, bottom);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setTick(Date.now()), 100);
    return () => clearInterval(timer);
  }, [reducedMotion]);
  useEffect(() => {
    if (
      reducedMotion ||
      state.room.mode === 'paused' ||
      state.displaying === undefined
    )
      return;
    const timer = setInterval(() => setPulse((value) => (value + 1) % 4), 250);
    return () => clearInterval(timer);
  }, [reducedMotion, state.room.mode, state.displaying]);

  const quit = useCallback(() => {
    if (closeStarted.current) return;
    closeStarted.current = true;
    void controller.close().then(
      () => exit(),
      (error: unknown) =>
        exit(error instanceof Error ? error : new Error('Could not save.')),
    );
  }, [controller, exit]);
  useEffect(() => {
    process.on('SIGTERM', quit);
    return () => {
      process.off('SIGTERM', quit);
    };
  }, [quit]);

  const insert = (text: string) => {
    setEditor((current) => edit(current, { kind: 'insert', text }));
    setDismissed(false);
    setSelected(0);
  };
  usePaste(insert, { isActive: !state.closing });
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      quit();
      return;
    }
    if (state.closing) return;
    if (key.ctrl && input === 'r') {
      controller.raiseHand();
      return;
    }
    if (key.ctrl && key.end) {
      setScrollTop(undefined);
      return;
    }
    if (key.pageUp || key.pageDown) {
      const next = Math.max(
        0,
        Math.min(
          bottom,
          offset + (key.pageUp ? -1 : 1) * Math.max(1, chatHeight - 1),
        ),
      );
      setScrollTop(next >= bottom ? undefined : next);
      return;
    }
    if (key.escape) {
      setDismissed(true);
      return;
    }
    if (key.tab && suggestions.length) {
      const choice = suggestions[selection]!;
      setEditor({ text: choice.value, cursor: choice.cursor });
      setSelected(0);
      setDismissed(false);
      return;
    }
    if (key.upArrow || key.downArrow) {
      if (suggestions.length) {
        setSelected(
          (selection + (key.upArrow ? -1 : 1) + suggestions.length) %
            suggestions.length,
        );
      } else {
        if (historyAt.current === history.current.length)
          historyDraft.current = editor.text;
        historyAt.current = Math.max(
          0,
          Math.min(
            history.current.length,
            historyAt.current + (key.upArrow ? -1 : 1),
          ),
        );
        const text = history.current[historyAt.current] ?? historyDraft.current;
        setEditor({ text, cursor: text.length });
      }
      return;
    }
    if (key.return) {
      const text = editor.text.trim();
      if (!text) return;
      history.current.push(text);
      historyAt.current = history.current.length;
      historyDraft.current = '';
      setEditor({ text: '', cursor: 0 });
      setDismissed(false);
      setSelected(0);
      setScrollTop(undefined);
      if (controller.accept(text)) quit();
      return;
    }
    const action = key.leftArrow
      ? 'left'
      : key.rightArrow
        ? 'right'
        : key.home || (key.ctrl && input === 'a')
          ? 'home'
          : key.end || (key.ctrl && input === 'e')
            ? 'end'
            : key.backspace
              ? 'backspace'
              : key.delete
                ? 'delete'
                : undefined;
    if (action) {
      setEditor((current) => edit(current, { kind: action }));
      setDismissed(false);
      setSelected(0);
      return;
    }
    if (key.ctrl && input === 'u') {
      setEditor({ text: '', cursor: 0 });
      return;
    }
    if (!key.ctrl && !key.meta && !key.tab && input) insert(input);
  });

  const window = editorWindow(editor, Math.max(1, columns - 8));
  const queueLabel = state.queued.length
    ? `${state.queued.length} queued${state.room.mode === 'paused' ? ' · paused' : state.question ? ' · held for your answer' : ''} · ${state.queued[0]!.text}`
    : state.room.queue.length
      ? `Next: ${state.room.queue.map((id) => identities[id].name).join(' → ')}`
      : ' ';
  const notice = state.question
    ? `${identities[state.question.agent].name} is waiting for your reply`
    : state.room.mode === 'paused'
      ? (state.room.notice ?? 'Paused · /resume to continue')
      : state.room.handRaised
        ? state.displaying || state.waiting.length
          ? 'Hand raised · you speak next'
          : 'Your turn'
        : (state.room.notice ?? ' ');
  return (
    <Box
      width={columns}
      height={rows}
      flexDirection="column"
      backgroundColor={theme.background}
      paddingX={1}
    >
      <Box height={1} justifyContent="space-between" flexShrink={0}>
        <Text color={theme.bright} bold>
          THE IDIOTS
        </Text>
        <Text color={theme.text} wrap="truncate">
          {roomLabel(state)} · {state.room.callsUsed}/{state.room.callLimit}{' '}
          calls
        </Text>
      </Box>
      <Box height={1} flexShrink={0}>
        <Text color={theme.muted} wrap="truncate">
          {visibleText(providerLabel)} · Four perspectives. Your decision.
        </Text>
      </Box>
      <Box height={chatHeight} flexShrink={0} overflow="hidden" marginTop={1}>
        <Box
          ref={contentRef}
          position="absolute"
          top={-offset}
          width={Math.max(1, columns - 2)}
          flexDirection="column"
        >
          {!state.messages.length && (
            <Box flexDirection="column" paddingY={1}>
              <Text color={theme.bright}>What are we figuring out?</Text>
              <Text color={theme.text}>
                Bring a question, decision, or half-formed idea.
              </Text>
              <Text color={theme.muted}>
                Type / for commands or @ to address an idiot.
              </Text>
            </Box>
          )}
          {state.messages.map((message) => {
            const id =
              message.speaker !== 'user' && message.speaker !== 'system'
                ? message.speaker
                : undefined;
            const colors = id ? theme.agents[id] : undefined;
            const active = message.key === state.activeKey;
            const orb = colors
              ? active
                ? [colors.base, colors.light, colors.glow, colors.light][pulse]!
                : colors.base
              : theme.muted;
            const name = id
              ? identities[id].name
              : message.speaker === 'user'
                ? 'You'
                : 'Room';
            return (
              <Box key={message.key} flexDirection="column" marginBottom={1}>
                <Text color={colors?.light ?? theme.bright}>
                  <Text color={orb}>{id ? '●' : '·'}</Text> {name}
                  {active ? ' · speaking' : ''}
                  {message.failed ? ' · interrupted' : ''}
                </Text>
                <Text
                  color={
                    message.speaker === 'system' ? theme.muted : theme.text
                  }
                >
                  {visibleText(message.text)}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>
      <Box height={1} flexShrink={0}>
        <Text color={theme.muted} wrap="truncate">
          {scrollTop !== undefined
            ? 'Reading history · Ctrl+End to follow live'
            : visibleText(queueLabel)}
        </Text>
      </Box>
      <Box height={1} flexShrink={0}>
        <Text
          color={
            state.question
              ? theme.agents[state.question.agent].glow
              : theme.text
          }
          wrap="truncate"
        >
          {visibleText(notice)}
        </Text>
      </Box>
      <CharacterRow
        state={state}
        sprites={sprites}
        compact={compact}
        tick={tick}
      />
      <Box flexDirection="column" flexShrink={0}>
        {visibleSuggestions.map((suggestion, i) => (
          <Box
            key={suggestion.label}
            backgroundColor={
              i + suggestionStart === selection ? theme.panel : theme.background
            }
          >
            <Text
              color={
                i + suggestionStart === selection ? theme.bright : theme.text
              }
              wrap="truncate"
            >
              {i + suggestionStart === selection ? '›' : ' '} {suggestion.label}{' '}
              <Text color={theme.muted}>{suggestion.help}</Text>
            </Text>
          </Box>
        ))}
      </Box>
      <Box
        borderStyle="round"
        borderColor={
          state.question
            ? theme.agents[state.question.agent].light
            : theme.border
        }
        height={3}
        flexShrink={0}
        paddingX={1}
      >
        <Text color={theme.text}>
          › {window.before}
          <Text backgroundColor={theme.text} color={theme.background}>
            {window.cursor}
          </Text>
          {window.after}
        </Text>
        {!editor.text && (
          <Text color={theme.muted}>
            {state.question ? ' Answer the question…' : ' Message the idiots…'}
          </Text>
        )}
      </Box>
      <Box height={1} flexShrink={0}>
        <Text color={theme.muted} wrap="truncate">
          Ctrl+R raise hand · / commands · Tab complete · PgUp/PgDn history ·
          Ctrl+C quit
        </Text>
      </Box>
    </Box>
  );
}
