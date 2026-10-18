export interface TextRun {
  readonly text: string;
  readonly bold: boolean;
}

/**
 * Splits Markdown **bold** spans so they can be shown in bold without their
 * asterisks. An unmatched ** stays literal, except at the end of a reply
 * still streaming: there it starts bold at once, so the markers never flash
 * on screen before the closing pair arrives.
 */
export function boldRuns(text: string, streaming = false): TextRun[] {
  const runs: TextRun[] = [];
  let rest = text;
  while (rest) {
    const open = rest.indexOf('**');
    const close = open === -1 ? -1 : rest.indexOf('**', open + 2);
    if (open === -1 || (close === -1 && !streaming)) break;
    if (open > 0) runs.push({ text: rest.slice(0, open), bold: false });
    const inner = rest.slice(open + 2, close === -1 ? undefined : close);
    if (inner) runs.push({ text: inner, bold: true });
    rest = close === -1 ? '' : rest.slice(close + 2);
  }
  if (rest) runs.push({ text: rest, bold: false });
  return runs;
}

/** Hide the blocking-question protocol, including incomplete streamed markers. */
export function messageText(text: string, finished = false): string {
  const lines = text.split('\n');
  return lines
    .map((line, index) => {
      const prefix = line.trimStart().replace(/^\*+/, '').toUpperCase();
      if (
        !finished &&
        index === lines.length - 1 &&
        ('QUESTION:'.startsWith(prefix) || /^QUESTION:?\**:?\s*$/.test(prefix))
      )
        return '';
      return line.replace(/^\s*\**QUESTION\b:?\**:?\s*/i, '');
    })
    .join('\n');
}
