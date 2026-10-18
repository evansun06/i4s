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
