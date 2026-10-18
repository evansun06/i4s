import assert from 'node:assert/strict';
import test from 'node:test';
import { terminalLink } from '../dist/drawing/links.js';

test('online edit labels are clickable OSC8 links without unsafe controls', () => {
  const url = 'file:///tmp/drawing%20run/edit.html';
  assert.equal(
    terminalLink('\x1b[34mGo online to edit\x1b[39m', url),
    `\x1b]8;;${url}\x1b\\Go online to edit\x1b]8;;\x1b\\`,
  );
  assert.throws(
    () => terminalLink('bad', 'file:///tmp/bad\x1b]8;;evil'),
    /Invalid/,
  );
  assert.throws(() => terminalLink('bad', 'javascript:alert(1)'), /Invalid/);
});
