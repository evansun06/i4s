import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import packageJson from '../package.json' with { type: 'json' };

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('help works without a terminal or credentials', () => {
  const result = run('--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: i4s/);
});

test('version matches the package', () => {
  const result = run('--version');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test('unknown arguments fail clearly', () => {
  const result = run('--unknown');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option/);
});

test('noninteractive launch exits instead of hanging', () => {
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
});
