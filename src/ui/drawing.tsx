import { Text, Transform } from 'ink';
import { terminalLink } from '../drawing/links.js';
import { theme } from './theme.js';

/** Structured system link: user/model text never controls terminal escape codes. */
export function DrawingLink({ label, url }: { label: string; url: string }) {
  return (
    <Text color={theme.agents.blue.light} underline>
      <Transform transform={(text) => terminalLink(text, url)}>
        <Text>{label}</Text>
      </Transform>
    </Text>
  );
}
