import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Text,
  useInput,
  useIsScreenReaderEnabled,
  useWindowSize,
} from 'ink';
import { agentIds, identities } from '../agents/identity.js';
import type { AgentId } from '../core/types.js';
import type { Session } from '../storage/sessions.js';
import { Avatar } from './app.js';
import { step } from './editor.js';
import { when } from './setup.js';
import { FloorAnimation, type SpriteAnimations } from './sprites.js';
import { theme, visibleText } from './theme.js';

/**
 * A small chunky pixel font (after Press Start 2P), 5 pixels tall:
 * two-pixel vertical strokes, one-pixel horizontals, notched corners.
 */
const FONT: Record<string, readonly string[]> = {
  T: ['######', '..##..', '..##..', '..##..', '..##..'],
  H: ['##.##', '##.##', '#####', '##.##', '##.##'],
  E: ['#####', '##...', '####.', '##...', '#####'],
  I: ['####', '.##.', '.##.', '.##.', '####'],
  D: ['####.', '##.##', '##.##', '##.##', '####.'],
  O: ['.###.', '##.##', '##.##', '##.##', '.###.'],
  S: ['.####', '##...', '.###.', '...##', '####.'],
  ' ': ['..', '..', '..', '..', '..'],
};
const TITLE = 'THE IDIOTS';

/** The title as rows of pixels, one blank pixel between letters. */
export function titlePixels(): string[] {
  const letters = [...TITLE].map((letter) => FONT[letter]!);
  return letters[0]!.map((_, y) => letters.map((glyph) => glyph[y]).join('.'));
}

/** Pixels drawn two to a cell with half blocks, so each one is square. */
export function titleRows(): string[] {
  const pixels = titlePixels();
  const rows: string[] = [];
  for (let y = 0; y < pixels.length; y += 2) {
    const top = pixels[y]!;
    const bottom = pixels[y + 1] ?? '';
    rows.push(
      [...top]
        .map((pixel, x) => {
          const below = bottom[x] === '#';
          return pixel === '#' ? (below ? '█' : '▀') : below ? '▄' : ' ';
        })
        .join(''),
    );
  }
  return rows;
}

/** Columns the title needs. */
export const TITLE_WIDTH = titlePixels()[0]!.length;

export function Title({ columns }: { columns: number }) {
  if (columns < TITLE_WIDTH + 4)
    return (
      <Text color={theme.bright} bold>
        {TITLE}
      </Text>
    );
  return (
    <Box flexDirection="column" flexShrink={0} aria-label={TITLE}>
      {titleRows().map((row, y) => (
        <Text key={y} color={theme.bright} aria-hidden>
          {row}
        </Text>
      ))}
    </Box>
  );
}

/** The full-screen frame shared by the lobby and its key screens. */
export function Screen({ children }: { children: ReactNode }) {
  const { columns, rows } = useWindowSize();
  return (
    <Box
      width={columns}
      height={rows}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme.background}
      paddingX={1}
    >
      {children}
    </Box>
  );
}

/** The four advisors idling (bobbing) side by side; animation is local only. */
function Cast({ sprites }: { sprites: Record<AgentId, SpriteAnimations> }) {
  const reducedMotion =
    useIsScreenReaderEnabled() || process.env.NO_COLOR !== undefined;
  const [tick, setTick] = useState(Date.now);
  const clocks = useMemo(
    () =>
      Object.fromEntries(
        agentIds.map((id) => [id, new FloorAnimation(sprites[id], Date.now())]),
      ) as Record<AgentId, FloorAnimation>,
    [sprites],
  );
  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setTick(Date.now()), 100);
    return () => clearInterval(timer);
  }, [reducedMotion]);
  return (
    <Box marginTop={1} columnGap={3}>
      {agentIds.map((id) => (
        <Box key={id} flexDirection="column" alignItems="center">
          <Avatar frame={clocks[id].frame(tick, false, reducedMotion)} />
          <Text color={theme.agents[id].light} bold>
            {identities[id].name}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** Where to go from the lobby: undefined starts a new discussion. */
export type LobbyChoice = Session | undefined;

export function Lobby({
  sessions,
  sprites,
  keyLabel,
  notice,
  onChoose,
  onKeys,
  onQuit,
}: {
  /** Saved discussions, newest first; undefined while loading. */
  sessions: readonly Session[] | undefined;
  sprites: Record<AgentId, SpriteAnimations>;
  /** The key and model new chats use. */
  keyLabel: string;
  /** A one-line message, such as a key just saved or an error. */
  notice?: string | undefined;
  onChoose: (choice: LobbyChoice) => void;
  onKeys: () => void;
  onQuit: () => void;
}) {
  const { columns, rows } = useWindowSize();
  const [selected, setSelected] = useState(0);
  const saved = sessions ?? [];
  const count = saved.length + 1;
  const selection = Math.min(selected, count - 1);

  useEffect(() => {
    process.on('SIGTERM', onQuit);
    return () => {
      process.off('SIGTERM', onQuit);
    };
  }, [onQuit]);
  useInput((input, key) => {
    if ((key.ctrl && input === 'c') || key.escape) onQuit();
    else if (key.ctrl && input === 'k') onKeys();
    else if (key.upArrow) setSelected(step(selection, -1, count));
    else if (key.downArrow) setSelected(step(selection, 1, count));
    else if (key.return)
      onChoose(selection === 0 ? undefined : saved[selection - 1]);
  });

  const width = Math.max(20, Math.min(columns - 4, 72));
  const showCast = rows >= 34 && columns >= 76;
  // Top padding, title, tagline, gaps, menu heading, notice and footer take
  // about 15 rows; the cast takes 11 more. The menu scrolls within the rest.
  const menuRows = Math.max(3, rows - 15 - (showCast ? 11 : 0));
  const first = Math.max(
    0,
    Math.min(selection - Math.floor(menuRows / 2), count - menuRows),
  );
  const options = [undefined, ...saved].slice(first, first + menuRows);

  return (
    <Screen>
      <Box height={2} flexShrink={0} />
      <Title columns={columns} />
      <Box height={2} flexShrink={0} />
      <Text color={theme.bright} bold>
        Four perspectives.
      </Text>
      {showCast && <Cast sprites={sprites} />}
      <Box width={width} marginTop={1} flexDirection="column">
        <Text color={theme.muted}>
          {sessions === undefined
            ? 'Loading saved discussions…'
            : saved.length
              ? 'Start a new discussion or continue one'
              : 'Start your first discussion'}
        </Text>
        {options.map((session, index) => {
          const active = first + index === selection;
          return (
            <Box key={session?.id ?? 'new'} columnGap={1}>
              <Text color={active ? theme.bright : theme.muted}>
                {active ? '›' : ' '}
              </Text>
              {session ? (
                <>
                  <Box flexGrow={1} flexShrink={1} minWidth={0}>
                    <Text
                      color={active ? theme.bright : theme.text}
                      bold={active}
                      wrap="truncate"
                    >
                      {visibleText(session.title)}
                    </Text>
                  </Box>
                  <Box flexShrink={0}>
                    <Text color={theme.muted}>
                      {when(session.updatedAt)} ·{' '}
                      {session.discussion.log.length} messages
                    </Text>
                  </Box>
                </>
              ) : (
                <Text color={active ? theme.bright : theme.text} bold={active}>
                  + New discussion
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Box width={width} marginTop={1}>
        <Text color={theme.text} wrap="truncate">
          {notice ? visibleText(notice) : ' '}
        </Text>
      </Box>
      <Box width={width} justifyContent="space-between" columnGap={2}>
        <Text color={theme.muted} wrap="truncate">
          Enter open · Ctrl+K keys
        </Text>
        <Text color={theme.muted} wrap="truncate">
          {visibleText(keyLabel)}
        </Text>
      </Box>
    </Screen>
  );
}
