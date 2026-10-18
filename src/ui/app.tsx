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
  useStdout,
  useWindowSize,
  type DOMElement,
} from 'ink';
import { agentIds, identities } from '../agents/identity.js';
import type { AgentId } from '../core/types.js';
import { complete, completionOnEnter } from './commands.js';
import type { ChatController, PresentationSnapshot } from './controller.js';
import { edit, editorWindow, type EditorState } from './editor.js';
import { boldRuns } from './message-text.js';
import { FloorAnimation, type SpriteAnimations } from './sprites.js';
import { dimAvatarColor, theme, visibleText } from './theme.js';

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

/** Lines one mouse-wheel notch scrolls. */
const WHEEL_LINES = 3;

/**
 * Lines to scroll for a terminal mouse report (SGR encoding, as useInput
 * delivers it, with or without its escape): wheel up is negative, clicks 0.
 * Undefined when the input is not a mouse report, so mouse noise is never
 * typed into the editor.
 */
export function mouseWheel(input: string): number | undefined {
  let lines: number | undefined;
  for (const [, button] of input
    .replaceAll('\u001b', '')
    .matchAll(/\[<(\d+);\d+;\d+[Mm]/g)) {
    const code = Number(button);
    lines =
      (lines ?? 0) +
      (code === 64 ? -WHEEL_LINES : code === 65 ? WHEEL_LINES : 0);
  }
  return lines;
}

export function floorAgent(state: PresentationSnapshot): AgentId | undefined {
  return state.displaying ?? state.question?.agent;
}

export function CharacterRow({
  state,
  sprites,
  compact,
  tick,
}: {
  state: PresentationSnapshot;
  sprites: Record<AgentId, SpriteAnimations>;
  compact: boolean;
  tick: number;
}) {
  const reducedMotion =
    useIsScreenReaderEnabled() || process.env.NO_COLOR !== undefined;
  const speaker = floorAgent(state);
  const clocks = useMemo(
    () =>
      Object.fromEntries(
        agentIds.map((id) => [id, new FloorAnimation(sprites[id], Date.now())]),
      ) as Record<AgentId, FloorAnimation>,
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
        const frame = clocks[id].frame(tick, speaker === id, reducedMotion);
        const colors = theme.agents[id];
        const dimmed = speaker !== undefined && speaker !== id;
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
                        color={
                          dimmed
                            ? dimAvatarColor(cell.foreground ?? theme.text)
                            : (cell.foreground ?? theme.text)
                        }
                        backgroundColor={
                          dimmed
                            ? dimAvatarColor(
                                cell.background ?? theme.background,
                              )
                            : (cell.background ?? theme.background)
                        }
                      >
                        {cell.glyph}
                      </Text>
                    ))}
                  </Text>
                ))}
              </Box>
            )}
            <Text
              color={dimmed ? dimAvatarColor(colors.light) : colors.light}
              bold
            >
              {identities[id].name}{' '}
              <Text color={dimmed ? dimAvatarColor(theme.muted) : theme.muted}>
                {id}
              </Text>
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
  sprites: Record<AgentId, SpriteAnimations>;
  providerLabel: string;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const { exit } = useApp();
  const { stdout } = useStdout();
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
  /** Scrolling back to the bottom resumes following the live discussion. */
  const scrollBy = (lines: number) => {
    const next = Math.max(0, Math.min(bottom, offset + lines));
    setScrollTop(next >= bottom ? undefined : next);
  };

  // Have the terminal report the mouse wheel, so it scrolls the chat while the
  // input bar and characters stay put. Turned off again on exit. Selecting
  // text with the mouse needs Shift held meanwhile, in most terminals.
  useEffect(() => {
    if (!stdout.isTTY) return;
    const off = () => stdout.write('\u001b[?1000l\u001b[?1006l');
    stdout.write('\u001b[?1000h\u001b[?1006h');
    process.once('exit', off);
    return () => {
      off();
      process.off('exit', off);
    };
  }, [stdout]);

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
    // Mouse reports arrive as input; never type them into the editor.
    const wheel = mouseWheel(input);
    if (wheel !== undefined) {
      if (wheel && !state.closing) scrollBy(wheel);
      return;
    }
    if (state.closing) return;
    // Reading speed, any time, even mid-reply. Ctrl or Alt: terminals never
    // pass the Command key through.
    if ((key.ctrl || key.meta) && (input === 'q' || input === 'e')) {
      controller.adjustReadingSpeed(input === 'e' ? 1 : -1);
      return;
    }
    if (key.ctrl && input === 'r') {
      controller.raiseHand();
      return;
    }
    if (key.ctrl && key.end) {
      setScrollTop(undefined);
      return;
    }
    if (key.pageUp || key.pageDown) {
      scrollBy((key.pageUp ? -1 : 1) * Math.max(1, chatHeight - 1));
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
    // Arrows pick a suggestion while the list is open, else scroll the chat.
    if (key.upArrow || key.downArrow) {
      if (suggestions.length) {
        setSelected(
          (selection + (key.upArrow ? -1 : 1) + suggestions.length) %
            suggestions.length,
        );
      } else scrollBy(key.upArrow ? -1 : 1);
      return;
    }
    if (key.ctrl && (input === 'p' || input === 'n')) {
      if (historyAt.current === history.current.length)
        historyDraft.current = editor.text;
      historyAt.current = Math.max(
        0,
        Math.min(
          history.current.length,
          historyAt.current + (input === 'p' ? -1 : 1),
        ),
      );
      const text = history.current[historyAt.current] ?? historyDraft.current;
      setEditor({ text, cursor: text.length });
      return;
    }
    if (key.return) {
      // With / or @ suggestions open, Enter completes like Tab; once the
      // text already matches, it sends.
      const choice = suggestions.length
        ? completionOnEnter(editor.text, editor.cursor, selection)
        : undefined;
      if (choice) {
        setEditor({ text: choice.value, cursor: choice.cursor });
        setSelected(0);
        setDismissed(false);
        return;
      }
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
          : key.end
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
          calls ·{' '}
          {state.wordsPerMinute ? `${state.wordsPerMinute} wpm` : 'instant'}
        </Text>
      </Box>
      <Box height={1} flexShrink={0}>
        <Text color={theme.muted} wrap="truncate">
          {visibleText(providerLabel)}
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
                  <Text color={message.speaker === 'user' ? theme.bright : orb}>
                    {message.speaker === 'system' ? '·' : '●'}
                  </Text>{' '}
                  {name}
                  {active ? ' · speaking' : ''}
                  {message.failed ? ' · interrupted' : ''}
                </Text>
                <Text
                  color={
                    message.speaker === 'system' ? theme.muted : theme.text
                  }
                >
                  {boldRuns(visibleText(message.text), !message.complete).map(
                    (run, i) => (
                      <Text key={i} bold={run.bold}>
                        {run.text}
                      </Text>
                    ),
                  )}
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
          / commands · Enter or Tab complete · ↑↓ or wheel scroll · Ctrl+Q/E
          slower/faster · Ctrl+R raise hand · Ctrl+C quit
        </Text>
      </Box>
    </Box>
  );
}
