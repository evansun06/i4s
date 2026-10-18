import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DrawPipeline } from './maps.js';
import { createEditorLinks } from './editor-link.js';

const labels: Record<string, string> = {
  extract: 'Step 1: extracting decisions and approved work…',
  decision: 'Step 2: building the decision map…',
  implementation: 'Step 2: building the implementation map…',
  presentation: 'Step 3: arranging the maps and exporting Excalidraw…',
};

/** Keep the pipeline's runtime/dependencies separate from the discussion engine. */
export function createDrawingPipeline(options: {
  sessionFile: string;
  outputDirectory: string;
  pipelineDirectory?: string;
}): DrawPipeline {
  const pipeline =
    options.pipelineDirectory ??
    fileURLToPath(new URL('../../excalidraw-pipeline/', import.meta.url));
  const outputDirectory = resolve(options.outputDirectory);
  const links = createEditorLinks();
  const draw: DrawPipeline = async ({ signal, onProgress, onCall }) => {
    signal.throwIfAborted();
    const entry = join(pipeline, 'src/cli.ts');
    try {
      await access(entry);
    } catch {
      throw new Error(
        'Drawing pipeline is not installed. Use this repository checkout and run npm ci in excalidraw-pipeline.',
      );
    }
    let directory: string | undefined;
    let pending = '';
    let diagnostics = '';
    const consume = (line: string) => {
      if (!line.startsWith('I4S_DRAW ')) {
        diagnostics = (diagnostics + line + '\n').slice(-4000);
        return;
      }
      const event: unknown = JSON.parse(line.slice(9));
      if (!event || typeof event !== 'object')
        throw new Error('Invalid drawing progress.');
      if ('type' in event && event.type === 'call') {
        onCall();
        const stage =
          'stage' in event && typeof event.stage === 'string'
            ? event.stage
            : '';
        onProgress(labels[stage] ?? 'Generating maps…');
      } else if ('type' in event && event.type === 'reuse') {
        onProgress(
          'Step 1: reusing validated extraction for this unchanged conversation…',
        );
      } else if (
        'type' in event &&
        event.type === 'run' &&
        'directory' in event &&
        typeof event.directory === 'string'
      ) {
        const path = resolve(event.directory);
        const childPath = relative(outputDirectory, path);
        if (!childPath || childPath.startsWith('..') || isAbsolute(childPath))
          throw new Error('Drawing output escaped its run directory.');
        directory = path;
      }
    };
    await new Promise<void>((done, fail) => {
      const child = spawn(
        process.execPath,
        [
          '--env-file-if-exists=.env',
          '--import',
          import.meta.resolve('tsx'),
          entry,
          '--session-file',
          resolve(options.sessionFile),
          '--out',
          outputDirectory,
          '--progress-json',
          '--reuse-extraction',
        ],
        { cwd: pipeline, stdio: ['ignore', 'ignore', 'pipe'], signal },
      );
      let error: Error | undefined;
      child.on('error', (value) => {
        error = value;
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        try {
          pending += chunk;
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          if (pending.length > 65536)
            throw new Error('Oversized drawing progress.');
          for (const line of lines) consume(line);
        } catch (cause) {
          error =
            cause instanceof Error
              ? cause
              : new Error('Invalid drawing progress.');
          child.kill();
        }
      });
      child.on('close', (code) => {
        try {
          if (pending) consume(pending);
        } catch (cause) {
          error =
            cause instanceof Error
              ? cause
              : new Error('Invalid drawing progress.');
        }
        if (signal.aborted) {
          fail(new Error('Drawing cancelled.'));
          return;
        }
        if (error) {
          fail(error);
          return;
        }
        if (code !== 0 || !directory) {
          fail(
            new Error(
              `Drawing failed.${directory ? ` Inspect ${directory}.` : ''}\n${diagnostics.trim() || 'Check pipeline dependencies and OPENAI_API_KEY in excalidraw-pipeline/.env.'}`,
            ),
          );
          return;
        }
        done();
      });
    });
    signal.throwIfAborted();
    if (!directory)
      throw new Error('Drawing pipeline returned no output folder.');
    const completion = JSON.parse(
      await readFile(join(directory, 'completion.json'), 'utf8'),
    ) as { status?: string };
    if (completion.status !== 'completed')
      throw new Error(`Drawing failed. Inspect ${directory}.`);
    const filePath = join(directory, 'project-plan.excalidraw');
    await access(filePath);
    return {
      directory,
      filePath,
      editUrl: await links.publish(directory),
    };
  };
  draw.close = () => links.close();
  return draw;
}
