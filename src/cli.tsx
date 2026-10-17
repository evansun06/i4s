#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(
      'The Idiots — four perspectives, one discussion.\n\nUsage: i4s [--help] [--version]\n\nLaunch from an interactive terminal. Press q or Ctrl+C to quit.\n',
    );
    return;
  }

  if (values.version) {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run i4s in an interactive terminal, or use --help.');
  }

  const { render } = await import('ink');
  const { App } = await import('./ui/app.js');
  await render(<App />).waitUntilExit();
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Unable to start The Idiots.'}\n`,
  );
  process.exitCode = 1;
});
