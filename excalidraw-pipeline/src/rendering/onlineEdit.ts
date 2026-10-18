import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExcalidrawScene } from './excalidrawAdapter.js';

/** Excalidraw's #url importer accepts a data URL. The fragment is not uploaded. */
export function onlineEditUrl(scene: ExcalidrawScene): string {
  const document = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: scene.elements.map((element) => {
      const visual = { ...element };
      delete visual.customData;
      return visual;
    }),
    appState: { viewBackgroundColor: scene.appState.viewBackgroundColor },
    files: scene.files,
  };
  return `https://excalidraw.com/#url=${encodeURIComponent(`data:application/json;base64,${Buffer.from(JSON.stringify(document)).toString('base64')}`)}`;
}

/** A short file link avoids passing a huge scene URL through the terminal/shell. */
export function onlineEditPage(scene: ExcalidrawScene): string {
  const url = onlineEditUrl(scene);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Go online to edit</title>
<meta name="referrer" content="no-referrer"><style>body{font:18px system-ui;max-width:700px;margin:60px auto;padding:24px}a{color:#4263eb}</style>
<h1>Go online to edit</h1><p>Opening your two maps in Excalidraw…</p>
<p>The drawing is passed in the URL fragment, not uploaded to a sharing service. No raw conversation is included. Excalidraw runs online; its browser app can read the drawing. Edits do not change your saved run.</p>
<p><a id="edit" href="${url}">Go online to edit</a></p>
<p>If the browser blocks the import, open <a href="https://excalidraw.com" target="_blank" rel="noreferrer">excalidraw.com</a> and import <a href="project-plan.excalidraw" download>project-plan.excalidraw</a>.</p>
<script>location.replace(document.getElementById('edit').href)</script></html>`;
}

/** Link-only handoff: no browser process, image export, or additional model call. */
export async function exportOnlineEdit(
  scene: ExcalidrawScene,
  directory: string,
): Promise<string> {
  const filePath = join(directory, 'edit.html');
  await writeFile(filePath, onlineEditPage(scene), { flag: 'wx' });
  return pathToFileURL(filePath).href;
}
