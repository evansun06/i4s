import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { buildExcalidrawScene } from '../dist/drawing/excalidraw/rendering/buildExcalidrawScene.js';
import { exportExcalidraw } from '../dist/drawing/excalidraw/rendering/exportExcalidraw.js';
import { defaultPresentation } from '../dist/drawing/excalidraw/rendering/presentation.js';

const exec = promisify(execFile);
test(
  'the generated file imports into official Excalidraw and its boxes, text and arrows remain editable',
  { timeout: 60000 },
  async (t) => {
    const chrome =
      process.env.EXCALIDRAW_TEST_CHROME ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    try {
      await access(chrome);
    } catch {
      t.skip(
        'Set EXCALIDRAW_TEST_CHROME to a Chrome/Chromium executable for the real import check.',
      );
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'i4s-excalidraw-import-'));
    const knowledge = JSON.parse(
      await readFile(
        new URL('./pipeline/fixtures/step1-knowledge.json', import.meta.url),
        'utf8',
      ),
    );
    const planning = JSON.parse(
      await readFile(
        new URL('./pipeline/fixtures/step2-planning.json', import.meta.url),
        'utf8',
      ),
    );
    const scenePath = process.env.EXCALIDRAW_TEST_SCENE;
    const exported = scenePath
      ? {
          filePath: scenePath,
          elementCount: JSON.parse(await readFile(scenePath, 'utf8')).elements
            .length,
        }
      : await exportExcalidraw(
          await buildExcalidrawScene(
            planning,
            knowledge,
            defaultPresentation(
              planning.planningGraphs,
              knowledge.knowledgeGraph,
            ),
          ),
          join(directory, 'project-plan.excalidraw'),
        );
    const source = await readFile(exported.filePath, 'utf8');
    const assets = new URL(
      '../node_modules/@excalidraw/excalidraw/dist/prod/',
      import.meta.url,
    ).href;
    await build({
      entryPoints: [
        fileURLToPath(
          new URL('./pipeline/excalidraw-browser-entry.mjs', import.meta.url),
        ),
      ],
      outfile: join(directory, 'smoke.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      conditions: ['production'],
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.url': '""',
      },
      loader: {
        '.woff2': 'file',
        '.woff': 'file',
        '.ttf': 'file',
        '.png': 'file',
        '.svg': 'file',
      },
      logLevel: 'silent',
    });
    await writeFile(
      join(directory, 'smoke.html'),
      `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="smoke.css"><style>html,body,#root{margin:0;width:100%;height:100%}#result{position:absolute;left:-10000px}</style><div id="root"></div><pre id="result"></pre><script id="scene" type="application/json">${source.replaceAll('<', '\\u003c')}</script><script>window.EXCALIDRAW_ASSET_PATH=${JSON.stringify(assets)}</script><script src="smoke.js"></script>`,
    );
    const { stdout } = await exec(
      chrome,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${join(directory, 'profile')}`,
        '--window-size=1800,1200',
        '--virtual-time-budget=12000',
        `--screenshot=${join(directory, 'import.png')}`,
        '--dump-dom',
        pathToFileURL(join(directory, 'smoke.html')).href,
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: 45000 },
    );
    const encoded = stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    assert.ok(
      encoded,
      `Excalidraw import did not finish. Inspect ${directory}/smoke.html`,
    );
    const report = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify(report, null, 2),
    );
    assert.equal(report.passed, true, report.error);
    assert.equal(report.importedElements, exported.elementCount);
    assert.equal(report.editedBoxes, 2);
    if (JSON.parse(source).elements.some((e) => e.fontFamily === 5))
      assert.equal(report.handwrittenFontLoaded, true);
    t.diagnostic(
      `Official Excalidraw import/edit report and screenshot: ${directory}`,
    );
  },
);
