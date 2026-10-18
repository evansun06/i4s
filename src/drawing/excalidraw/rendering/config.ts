/** Display choices only; no planning semantics live here. */
export const renderingConfig = {
  nodeWidth: 260,
  fontSize: 17,
  noteFontSize: 14,
  padding: 16,
  gap: 80,
  mapGap: 300,
  detailWidth: 340,
  colors: {
    ink: '#1e1e1e',
    purple: '#7041a6',
    blue: '#245ea8',
    green: '#237344',
    amber: '#925b08',
    rejected: '#9a3c3c',
    muted: '#596579',
    red: '#a42f35',
    yellow: '#856000',
  },
  fills: {
    purple: '#e5dbff',
    blue: '#d0ebff',
    green: '#d3f9d8',
    amber: '#fff3bf',
    rejected: '#ffe3e3',
    neutral: '#fff9ef',
  },
} as const;

/** Conservatively estimate handwritten label width, including long words and Unicode. */
export function wrapText(
  text: string,
  width: number,
  fontSize: number,
): string {
  const columns = Math.max(8, Math.floor(width / (fontSize * 0.62)));
  return text
    .split('\n')
    .flatMap((line) => {
      const lines: string[] = [];
      let current = '';
      for (const word of line.split(/\s+/u)) {
        const chars = [...word];
        if (current && [...current].length + chars.length + 1 > columns) {
          lines.push(current);
          current = '';
        }
        while (chars.length > columns) {
          lines.push(chars.splice(0, columns).join(''));
        }
        if (chars.length) current += `${current ? ' ' : ''}${chars.join('')}`;
      }
      lines.push(current);
      return lines;
    })
    .join('\n');
}

export function textHeight(text: string, fontSize: number): number {
  return Math.ceil(text.split('\n').length * fontSize * 1.3);
}
