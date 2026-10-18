import stringWidth from 'string-width';
import { visibleText } from './theme.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (text: string): string[] =>
  Array.from(segmenter.segment(text), ({ segment }) => segment);

export interface EditorState {
  readonly text: string;
  readonly cursor: number;
}
export type Edit =
  | { kind: 'insert'; text: string }
  | { kind: 'left' | 'right' | 'home' | 'end' | 'backspace' | 'delete' };

export function edit(state: EditorState, action: Edit): EditorState {
  const before = state.text.slice(0, state.cursor),
    after = state.text.slice(state.cursor);
  const previous = graphemes(before).at(-1)?.length ?? 0;
  const next = graphemes(after)[0]?.length ?? 0;
  switch (action.kind) {
    case 'insert': {
      const text = visibleText(action.text.replace(/[\r\n\t]+/g, ' '));
      return {
        text: before + text + after,
        cursor: state.cursor + text.length,
      };
    }
    case 'left':
      return { ...state, cursor: state.cursor - previous };
    case 'right':
      return { ...state, cursor: state.cursor + next };
    case 'home':
      return { ...state, cursor: 0 };
    case 'end':
      return { ...state, cursor: state.text.length };
    case 'backspace':
      return {
        text: before.slice(0, before.length - previous) + after,
        cursor: state.cursor - previous,
      };
    case 'delete':
      return { text: before + after.slice(next), cursor: state.cursor };
  }
}

export function editorWindow(
  state: EditorState,
  columns: number,
): { before: string; cursor: string; after: string } {
  const limit = Math.max(1, columns);
  const left = graphemes(state.text.slice(0, state.cursor));
  const right = graphemes(state.text.slice(state.cursor));
  const cursor = right.shift() ?? ' ';
  while (
    left.length &&
    stringWidth(left.join('')) + stringWidth(cursor) > limit
  )
    left.shift();
  let after = '';
  for (const char of right) {
    if (stringWidth(left.join('') + cursor + after + char) > limit) break;
    after += char;
  }
  return { before: left.join(''), cursor, after };
}
