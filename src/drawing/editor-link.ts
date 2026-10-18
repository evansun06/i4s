import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

/** A browser URL, not a file:// link that an IDE may open as source code.
 * Loopback only, random per-drawing paths, no directory browsing or file API.
 */
export function createEditorLinks() {
  let server: Server | undefined;
  let starting: Promise<string> | undefined;
  let closed = false;
  const pages = new Map<string, { body: string; download: boolean }>();
  const start = () => {
    starting ??= new Promise<string>((resolve, reject) => {
      server = createServer((request, response) => {
        const address = server?.address();
        const expectedHost =
          address && typeof address === 'object'
            ? `127.0.0.1:${address.port}`
            : '';
        const page = pages.get(request.url ?? '');
        if (
          request.headers.host !== expectedHost ||
          !page ||
          !['GET', 'HEAD'].includes(request.method ?? '')
        ) {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, {
          'content-type': page.download
            ? 'application/json'
            : 'text/html; charset=utf-8',
          ...(page.download
            ? {
                'content-disposition':
                  'attachment; filename="project-plan.excalidraw"',
              }
            : {}),
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        });
        response.end(request.method === 'HEAD' ? undefined : page.body);
      });
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not start drawing link.'));
          return;
        }
        server?.unref();
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    return starting;
  };
  return {
    async publish(directory: string): Promise<string> {
      if (closed) throw new Error('Drawing links are closed.');
      let page: string;
      try {
        page = await readFile(join(directory, 'edit.html'), 'utf8');
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return 'https://excalidraw.com';
        throw error;
      }
      const origin = await start();
      if (closed) throw new Error('Drawing links are closed.');
      const path = `/drawing/${randomBytes(24).toString('hex')}`;
      const native = await readFile(
        join(directory, 'project-plan.excalidraw'),
        'utf8',
      );
      pages.set(path, {
        body: page.replace(
          'href="project-plan.excalidraw" download',
          `href="${path}/file" download`,
        ),
        download: false,
      });
      pages.set(`${path}/file`, { body: native, download: true });
      return origin + path;
    },
    async close(): Promise<void> {
      closed = true;
      await starting?.catch(() => {});
      pages.clear();
      if (server?.listening) {
        const active = server;
        await new Promise<void>((resolve, reject) => {
          active.close((error) => {
            if (error) reject(error);
            else resolve();
          });
          active.closeAllConnections();
        });
      }
    },
  };
}
