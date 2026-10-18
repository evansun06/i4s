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
import { edit, editorWindow, step, type EditorState } from './editor.js';
import { DrawingLink } from './drawing.js';
import {
  boldRuns,
  lightRuns,
  shimmerBand,
  type TextRun,
} from './message-text.js';
import {
  FloorAnimation,
  loadKorgSprites,
  loopingFrame,
  scaleFrame,
  type SpriteAnimations,
  type SpriteFrame,
} from './sprites.js';
import { dimAvatarColor, lighten, theme, visibleText } from './theme.js';

export function activityLabel(
  state: PresentationSnapshot,
  id: AgentId,
): string {
  if (state.drawing?.status === 'running') return 'paused';
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
  if (state.drawing?.status === 'running') return undefined;
  return state.displaying ?? state.question?.agent;
}

export function Avatar({
  frame,
  dimmed = false,
}: {
  frame: SpriteFrame;
  dimmed?: boolean;
}) {
  return (
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
                  ? dimAvatarColor(cell.background ?? theme.background)
                  : (cell.background ?? theme.background)
              }
            >
              {cell.glyph}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

function Korg({
  tick,
  reducedMotion,
  size,
}: {
  tick: number;
  reducedMotion: boolean;
  /** Sprite size in pixels; undefined shows only his name and state. */
  size: number | undefined;
}) {
  const [sprites] = useState(loadKorgSprites);
  const [started] = useState(Date.now);
  const frame = reducedMotion
    ? sprites.idle[0]!
    : loopingFrame(sprites.idle, tick - started);
  return (
    <Box width={16} flexShrink={0} flexDirection="column" alignItems="center">
      {size !== undefined && <Avatar frame={scaleFrame(frame, size)} />}
      <Text color={theme.bright} bold>
        Korg
      </Text>
      <Text color={theme.text}>drawing</Text>
    </Box>
  );
}

/**
 * Where the transcript sits in the chat area. `bottom` is the furthest it
 * scrolls; `offset` is how far it is scrolled (undefined `scrollTop` follows
 * the live end). A short conversation sits at the bottom, just above the
 * status lines, so new messages push older ones up.
 */
export function chatPosition(
  contentHeight: number,
  chatHeight: number,
  scrollTop?: number,
): { bottom: number; offset: number; top: number } {
  const bottom = Math.max(0, contentHeight - chatHeight);
  const offset = Math.min(scrollTop ?? bottom, bottom);
  return {
    bottom,
    offset,
    top: Math.max(0, chatHeight - contentHeight) - offset,
  };
}

/** Message text starts under the name: the orb and its space. */
const MESSAGE_INDENT = 2;

/**
 * The speaker's orb pulses by size, shrinking and growing in its own color.
 * Every glyph is one column wide, so the name beside it never shifts.
 */
export const ORB_SIZES = ['●', '•', '·', '•'] as const;

/**
 * Text with a light band sweeping left to right through it while `now` is
 * set: the speaker's "Name · speaking" label, or Korg's "Korg · drawing".
 */
function Shimmer({
  runs,
  color,
  now,
}: {
  runs: readonly TextRun[];
  /** The text's own color; the band is a lighter shade of it. */
  color: string;
  now: number | undefined;
}) {
  const length = runs.reduce((total, run) => total + run.text.length, 0);
  const [from, to] =
    now === undefined ? [0, 0] : shimmerBand(length, now, 4, 1600);
  return lightRuns(runs, from, to).map((run, i) => (
    <Text
      key={i}
      bold={run.bold}
      color={run.lit ? lighten(color, 0.25) : color}
    >
      {run.text}
    </Text>
  ));
}

/** Sprite sizes in pixels square; the hand-drawn art is 16. */
export const MAX_SPRITE = 14;
export const MIN_SPRITE = 10;

/**
 * How big the characters are drawn for this terminal: they take at most
 * about a quarter of its height, between MIN_SPRITE and MAX_SPRITE pixels.
 * Undefined when even the minimum doesn't fit: names and states only.
 */
export function spriteSize(
  columns: number,
  rows: number,
  drawing = false,
): number | undefined {
  if (columns < (drawing ? 82 : 76)) return undefined;
  const size = Math.min(MAX_SPRITE, Math.floor(rows * 0.23) * 2);
  return size >= MIN_SPRITE ? size : undefined;
}

export function CharacterRow({
  state,
  sprites,
  size,
  tick,
}: {
  state: PresentationSnapshot;
  sprites: Record<AgentId, SpriteAnimations>;
  /** From spriteSize(); undefined shows names and states only. */
  size: number | undefined;
  tick: number;
}) {
  const compact = size === undefined;
  const reducedMotion =
    useIsScreenReaderEnabled() || process.env.NO_COLOR !== undefined;
  const drawing = state.drawing?.status === 'running';
  const speaker = floorAgent(state);
  const clocks = useMemo(
    () =>
      Object.fromEntries(
        agentIds.map((id) => [id, new FloorAnimation(sprites[id], Date.now())]),
      ) as Record<AgentId, FloorAnimation>,
    [sprites],
  );
  const agents = (
    <Box
      justifyContent="center"
      flexGrow={drawing ? 1 : 0}
      minWidth={0}
      columnGap={drawing ? 0 : compact ? 1 : 3}
      alignItems="center"
      rowGap={0}
      flexShrink={0}
      flexWrap={compact && !drawing ? 'wrap' : 'nowrap'}
    >
      {agentIds.map((id) => {
        const frame = clocks[id].frame(tick, speaker === id, reducedMotion);
        const colors = theme.agents[id];
        const dimmed = drawing || (speaker !== undefined && speaker !== id);
        return (
          <Box
            key={id}
            width={drawing ? undefined : compact ? 15 : 16}
            flexBasis={drawing ? 0 : undefined}
            flexGrow={drawing ? 1 : 0}
            maxWidth={drawing ? 16 : undefined}
            minWidth={0}
            flexDirection="column"
            alignItems="center"
          >
            {size !== undefined && (
              <Avatar frame={scaleFrame(frame, size)} dimmed={dimmed} />
            )}
            <Text
              color={dimmed ? dimAvatarColor(colors.light) : colors.light}
              bold
            >
              {identities[id].name}
            </Text>
            <Text
              color={
                dimmed
                  ? dimAvatarColor(theme.text)
                  : state.displaying === id
                    ? colors.glow
                    : theme.text
              }
              wrap="truncate"
            >
              {activityLabel(state, id)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
  if (!drawing) return agents;
  // Korg stands in the right-hand corner while drawing. A matching space on
  // the left keeps the four centered where they normally stand; it gives way
  // first when the terminal is narrow.
  return (
    <Box flexShrink={0} alignItems="center">
      {!compact && <Box width={16} flexShrink={1} minWidth={0} />}
      {agents}
      <Korg tick={tick} reducedMotion={reducedMotion} size={size} />
    </Box>
  );
}

export function App({
  controller,
  sprites,
  providerLabel,
  onClose,
}: {
  controller: ChatController;
  sprites: Record<AgentId, SpriteAnimations>;
  providerLabel: string;
  /** Called once the chat is saved and closed; without it the app exits. */
  onClose?: (to: 'quit' | 'lobby') => void;
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
  const size = spriteSize(columns, rows, state.drawing?.status === 'running');
  // Sprite rows plus name and state; text-only names may wrap when narrow.
  const characterHeight =
    size !== undefined
      ? size / 2 + 2
      : state.drawing?.status === 'running'
        ? 2
        : Math.ceil(4 / Math.max(1, Math.floor((columns - 1) / 16))) * 2;
  const suggestionCount = Math.max(0, Math.min(4, rows - characterHeight - 11));
  const suggestionStart = Math.max(0, selection - suggestionCount + 1);
  const visibleSuggestions = suggestions.slice(
    suggestionStart,
    suggestionStart + suggestionCount,
  );
  const chatHeight = Math.max(
    1,
    rows - characterHeight - 11 - visibleSuggestions.length,
  );
  const {
    bottom,
    offset,
    top: contentTop,
  } = chatPosition(content.height, chatHeight, scrollTop);
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

  const drawing = state.drawing?.status === 'running';
  // Faster frames while text shimmers: a reply being spoken, or Korg drawing.
  const shimmering =
    drawing || (state.displaying !== undefined && state.room.mode !== 'paused');
  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setTick(Date.now()), shimmering ? 50 : 100);
    return () => clearInterval(timer);
  }, [reducedMotion, shimmering]);
  useEffect(() => {
    if (reducedMotion || !shimmering) return;
    const timer = setInterval(() => setPulse((value) => (value + 1) % 4), 250);
    return () => {
      clearInterval(timer);
      // A still orb is always full size, never frozen mid-shrink.
      setPulse(0);
    };
  }, [reducedMotion, shimmering]);

  const quit = useCallback(
    (to: 'quit' | 'lobby' = 'quit') => {
      if (closeStarted.current) return;
      closeStarted.current = true;
      void controller.close().then(
        () => (onClose ? onClose(to) : exit()),
        (error: unknown) =>
          exit(error instanceof Error ? error : new Error('Could not save.')),
      );
    },
    [controller, exit, onClose],
  );
  useEffect(() => {
    const terminate = () => quit();
    process.on('SIGTERM', terminate);
    return () => {
      process.off('SIGTERM', terminate);
    };
  }, [quit]);

  const insert = (text: string) => {
    setEditor((current) => edit(current, { kind: 'insert', text }));
    setDismissed(false);
    setSelected(0);
  };
  usePaste(insert, {
    isActive: !state.closing,
  });
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
    // Esc closes suggestions first; otherwise it interrupts the discussion.
    if (key.escape) {
      if (suggestions.length) setDismissed(true);
      else controller.interrupt();
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
        setSelected(step(selection, key.upArrow ? -1 : 1, suggestions.length));
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
      const leaving = controller.accept(text);
      if (leaving) quit(leaving);
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
  // Left of the calls/speed line: who speaks next.
  const queueLabel =
    scrollTop !== undefined
      ? 'Reading history · Ctrl+End to follow live'
      : state.drawing?.status === 'running'
        ? 'Paused'
        : state.queued.length
          ? visibleText(
              `${state.queued.length} queued${state.room.mode === 'paused' ? ' · paused' : state.question ? ' · held for your answer' : ''} · ${state.queued[0]!.text}`,
            )
          : state.room.queue.length
            ? `Next: ${state.room.queue.map((id) => identities[id].name).join(' → ')}`
            : ' ';
  const notice = state.closing
    ? 'Saving…'
    : state.drawing?.status === 'running'
      ? 'Drawing maps · All agents paused'
      : state.question
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
      {/* Breathing room above and beside the header. */}
      <Box height={1} flexShrink={0} />
      <Box height={1} flexShrink={0} paddingX={1}>
        <Text color={theme.bright} bold>
          THE IDIOTS
        </Text>
      </Box>
      <Box height={1} flexShrink={0} paddingX={1}>
        <Text color={theme.muted} wrap="truncate">
          {visibleText(providerLabel)}
        </Text>
      </Box>
      {/* Divides the header from the chat, in the row its margin used. */}
      <Box height={1} flexShrink={0}>
        <Text color={theme.border} wrap="truncate">
          {'─'.repeat(Math.max(1, columns - 2))}
        </Text>
      </Box>
      <Box height={chatHeight} flexShrink={0} overflow="hidden">
        <Box
          ref={contentRef}
          position="absolute"
          top={contentTop}
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
              message.speaker !== 'user' &&
              message.speaker !== 'system' &&
              message.speaker !== 'korg'
                ? message.speaker
                : undefined;
            const korg = message.speaker === 'korg';
            const colors = id ? theme.agents[id] : undefined;
            const active = message.key === state.activeKey;
            // Korg reports drawing results under his own silver orb.
            const orb = colors
              ? active
                ? colors.light
                : colors.base
              : korg
                ? theme.text
                : theme.muted;
            const name = id
              ? identities[id].name
              : message.speaker === 'user'
                ? 'You'
                : korg
                  ? 'Korg'
                  : 'Room';
            return (
              <Box key={message.key} flexDirection="column" marginBottom={1}>
                <Text
                  color={colors?.light ?? (korg ? theme.text : theme.bright)}
                >
                  <Text color={message.speaker === 'user' ? theme.bright : orb}>
                    {message.speaker === 'system'
                      ? '·'
                      : active
                        ? ORB_SIZES[pulse]
                        : '●'}
                  </Text>{' '}
                  <Shimmer
                    runs={[
                      {
                        text: `${name}${active ? ' · speaking' : ''}`,
                        bold: false,
                      },
                    ]}
                    color={colors?.light ?? (korg ? theme.text : theme.bright)}
                    now={
                      active && !reducedMotion && state.room.mode !== 'paused'
                        ? tick
                        : undefined
                    }
                  />
                  {message.failed ? ' · interrupted' : ''}
                </Text>
                {/* Text lines up with the name, past the orb; same margin right. */}
                <Box flexDirection="column" paddingX={MESSAGE_INDENT}>
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
                  {message.link && (
                    <DrawingLink
                      label={message.link.label}
                      url={message.link.url}
                    />
                  )}
                </Box>
              </Box>
            );
          })}
          {drawing && state.drawing?.status === 'running' && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color={theme.text}>
                <Text color={theme.text}>{ORB_SIZES[pulse]}</Text>{' '}
                <Shimmer
                  runs={[{ text: 'Korg · drawing', bold: false }]}
                  color={theme.text}
                  now={reducedMotion ? undefined : tick}
                />
              </Text>
              <Box paddingX={MESSAGE_INDENT}>
                <Text color={theme.text}>
                  {visibleText(state.drawing.message)}
                </Text>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
      <Box height={1} flexShrink={0} columnGap={2}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={theme.text} wrap="truncate">
            {queueLabel}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={theme.text}>
            {state.room.callsUsed}/{state.room.callLimit} calls ·{' '}
            {state.wordsPerMinute ? `${state.wordsPerMinute} wpm` : 'instant'}
          </Text>
        </Box>
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
      <CharacterRow state={state} sprites={sprites} size={size} tick={tick} />
      <Box height={1} flexShrink={0} />
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
      {/* Lines up with the input's › inside the box border. */}
      <Box height={1} flexShrink={0} paddingLeft={2}>
        <Text color={theme.muted} wrap="truncate">
          /commands · Esc interrupt · Ctrl+R raise hand · Ctrl+C quit
        </Text>
      </Box>
    </Box>
  );
}
