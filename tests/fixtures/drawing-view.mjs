// Manual real-terminal link check. Uses a saved run; no providers or network.
// node tests/fixtures/drawing-view.mjs <run-directory>
import React from 'react';
import { resolve } from 'node:path';
import { render, useApp, useInput, Box, Text } from 'ink';
import { DrawingLink } from '../../dist/ui/drawing.js';
import { createEditorLinks } from '../../dist/drawing/editor-link.js';
const directory = resolve(process.argv[2]);
const links = createEditorLinks();
const url = await links.publish(directory);
function LinkView() {
  const { exit } = useApp();
  useInput((input, key) => {
    if (input === 'q' || key.escape) exit();
  });
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, null, 'Room · Drawing ready; discussion paused'),
    React.createElement(DrawingLink, { label: 'Go online to edit', url }),
    React.createElement(Text, null, url),
  );
}
await render(React.createElement(LinkView), {
  alternateScreen: true,
  incrementalRendering: true,
}).waitUntilExit();
await links.close();
process.stdout.write('Drawing link closed; discussion remains paused.\n');
