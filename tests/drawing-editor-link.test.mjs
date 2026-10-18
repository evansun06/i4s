import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditorLinks } from '../dist/drawing/editor-link.js';

test('browser handoff is a short loopback HTTP link, with only scoped drawing access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i4s-browser-link-'));
  const page =
    '<!doctype html><a href="project-plan.excalidraw" download>drawing</a><script>location.replace("https://excalidraw.com")</script>';
  const scene = '{"type":"excalidraw","elements":[]}';
  await writeFile(join(directory, 'edit.html'), page);
  await writeFile(join(directory, 'project-plan.excalidraw'), scene);
  const links = createEditorLinks();
  try {
    const url = await links.publish(directory);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/drawing\/[a-f0-9]{48}$/);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /location.replace/);
    assert.equal(await (await fetch(`${url}/file`)).text(), scene);
    assert.equal((await fetch(new URL('/input.log.json', url))).status, 404);
    assert.equal((await fetch(`${url}/../../input.log.json`)).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    assert.notEqual(await links.publish(directory), url);
  } finally {
    await links.close();
  }
  await assert.rejects(links.publish(directory), /closed/);
});

test('legacy runs without an edit handoff use manual Excalidraw import', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i4s-legacy-drawing-'));
  const links = createEditorLinks();
  try {
    assert.equal(await links.publish(directory), 'https://excalidraw.com');
  } finally {
    await links.close();
  }
});
