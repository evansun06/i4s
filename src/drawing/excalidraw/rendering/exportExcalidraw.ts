import { mkdir, open, readFile, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, join, basename } from 'node:path';
import type { ExcalidrawScene, ExportResult } from './excalidrawAdapter.js';

/** Single inexpensive scene check, then verified no-clobber publication. */
export async function exportExcalidraw(
  scene: ExcalidrawScene,
  outputPath: string,
): Promise<ExportResult> {
  const ids = new Set(scene.elements.map((e) => e.id));
  if (ids.size !== scene.elements.length)
    throw new Error('Excalidraw element IDs must be unique.');
  const shapes = new Set(
    scene.elements.filter((e) => e.type === 'rectangle').map((e) => e.id),
  );
  for (const element of scene.elements) {
    if (
      ![
        element.x,
        element.y,
        element.width,
        element.height,
        element.angle,
      ].every(Number.isFinite) ||
      element.width < 0 ||
      element.height < 0
    )
      throw new Error(`Invalid Excalidraw geometry: ${element.id}.`);
    for (const binding of element.boundElements ?? [])
      if (!ids.has(binding.id))
        throw new Error(`Missing bound element ${binding.id}.`);
    if (
      element.type === 'text' &&
      element.containerId &&
      !ids.has(element.containerId)
    )
      throw new Error(`Missing text container ${element.containerId}.`);
    if (element.type === 'arrow') {
      if (
        element.points.length < 2 ||
        !element.points.every((p) => p.every(Number.isFinite))
      )
        throw new Error(`Invalid connector points: ${element.id}.`);
      for (const binding of [element.startBinding, element.endBinding])
        if (!binding || !shapes.has(binding.elementId))
          throw new Error(`Invalid connector binding: ${element.id}.`);
    }
  }
  for (const region of ['decision', 'implementation'])
    if (
      !scene.elements.some(
        (e) => e.customData?.role === 'region' && e.customData.graph === region,
      )
    )
      throw new Error(`Missing ${region} diagram region.`);
  const document = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
  };
  const filePath = resolve(outputPath);
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`,
  );
  try {
    const file = await open(temporaryPath, 'wx');
    try {
      await file.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    const parsed: unknown = JSON.parse(await readFile(temporaryPath, 'utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('type' in parsed) ||
      parsed.type !== 'excalidraw' ||
      !('version' in parsed) ||
      parsed.version !== 2 ||
      !('elements' in parsed) ||
      !Array.isArray(parsed.elements) ||
      parsed.elements.length !== scene.elements.length ||
      !('appState' in parsed) ||
      !('files' in parsed)
    )
      throw new Error('Excalidraw readback verification failed.');
    // Hard-link publication is atomic on the same filesystem and refuses existing files.
    await link(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    });
  }
  return {
    filePath,
    elementCount: scene.elements.length,
    warnings: [...scene.warnings],
  };
}
