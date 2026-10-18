import { stripVTControlCharacters } from 'node:util';

export function terminalLink(label: string, url: string): string {
  if (
    Array.from(url).some(
      (char) =>
        char.charCodeAt(0) <= 32 ||
        (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
    ) ||
    !/^(?:https?:|file:)/u.test(url)
  )
    throw new Error('Invalid drawing link.');
  return `\x1b]8;;${url}\x1b\\${stripVTControlCharacters(label)}\x1b]8;;\x1b\\`;
}
