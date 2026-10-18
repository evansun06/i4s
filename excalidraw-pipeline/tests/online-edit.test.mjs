import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildExcalidrawScene } from '../dist/rendering/buildExcalidrawScene.js';
import { defaultPresentation } from '../dist/rendering/presentation.js';
import {
  exportOnlineEdit,
  onlineEditPage,
  onlineEditUrl,
} from '../dist/rendering/onlineEdit.js';

async function fixture() {
  const knowledge = JSON.parse(
    await readFile(
      new URL('./fixtures/step1-knowledge.json', import.meta.url),
      'utf8',
    ),
  );
  const planning = JSON.parse(
    await readFile(
      new URL('./fixtures/step2-planning.json', import.meta.url),
      'utf8',
    ),
  );
  return buildExcalidrawScene(
    planning,
    knowledge,
    defaultPresentation(planning.planningGraphs, knowledge.knowledgeGraph),
  );
}

test('online edit imports both native maps without an upload, raw conversation or internal provenance', async () => {
  const scene = await fixture();
  const original = JSON.stringify(scene);
  const url = new URL(onlineEditUrl(scene));
  assert.equal(url.origin, 'https://excalidraw.com');
  assert.equal(url.search, '');
  const data = decodeURIComponent(url.hash.slice('#url='.length));
  assert.ok(data.startsWith('data:application/json;base64,'));
  const document = JSON.parse(
    Buffer.from(data.split(',')[1], 'base64').toString('utf8'),
  );
  assert.equal(document.type, 'excalidraw');
  assert.equal(document.version, 2);
  assert.equal(document.elements.length, scene.elements.length);
  assert.ok(document.elements.some((element) => element.type === 'arrow'));
  assert.ok(document.elements.every((element) => !('customData' in element)));
  assert.equal(JSON.stringify(scene), original);
  const html = onlineEditPage(scene);
  assert.match(html, /Go online to edit/);
  assert.match(html, /location.replace/);
  assert.match(html, /download>project-plan.excalidraw/);
  assert.doesNotMatch(html, /fetch\(|api\/v2\/post/);
});

test('link-only export writes just edit.html, needs no browser, and never overwrites a run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i4s-online-edit-'));
  const scene = await fixture();
  const url = await exportOnlineEdit(scene, directory);
  assert.equal(url, pathToFileURL(join(directory, 'edit.html')).href);
  assert.deepEqual(await readdir(directory), ['edit.html']);
  assert.match(
    await readFile(join(directory, 'edit.html'), 'utf8'),
    /Go online to edit/,
  );
  await assert.rejects(exportOnlineEdit(scene, directory), /EEXIST/);
});
