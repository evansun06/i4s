import assert from 'node:assert/strict';
import test from 'node:test';
import { Pacer } from '../dist/ui/pacer.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('replies stream letter by letter, in order, with a pause between speakers', async () => {
  const writes = [];
  const pacer = new Pacer((text) => writes.push([Date.now(), text]), {
    wordsPerMinute: 1000, // 100 letters a second, so the test runs quickly
    pauseBetweenSpeakersMs: 50,
  });
  pacer.line('status\n');
  const red = pacer.speech('RED: ');
  const blue = pacer.speech('BLUE: ');
  red.update('Ship it now.');
  red.finish();
  blue.update('Wait.');
  blue.finish();
  await pacer.idle();

  const text = writes.map(([, t]) => t).join('');
  assert.equal(text, 'status\nRED: Ship it now.\n\nBLUE: Wait.\n\n');
  // Small pieces, not whole words: no write of Red's reply exceeds 4 letters.
  const label = writes.findIndex(([, t]) => t === 'RED: ');
  const end = writes.findIndex(([, t]) => t === '\n\n');
  const pieces = writes.slice(label + 1, end).map(([, t]) => t);
  assert.ok(pieces.length >= 4);
  assert.ok(pieces.every((piece) => piece.length <= 4));
  const blueStart = writes.findIndex(([, t]) => t === 'BLUE: ');
  assert.ok(writes[blueStart][0] - writes[end][0] >= 45);
});

test('text is shown only as fast as it arrives', async () => {
  const writes = [];
  const pacer = new Pacer((text) => writes.push(text), {
    wordsPerMinute: 6000,
    pauseBetweenSpeakersMs: 0,
  });
  const reply = pacer.speech('');
  reply.update('Hel');
  await delay(30);
  assert.equal(writes.join(''), 'Hel');
  reply.update('Hello.');
  reply.finish();
  await pacer.idle();
  assert.equal(writes.join(''), 'Hello.\n\n');
});

test('reading speed sets how long a reply takes to show', async () => {
  const pacer = new Pacer(() => {}, {
    wordsPerMinute: 600, // 60 letters a second
    pauseBetweenSpeakersMs: 0,
  });
  const reply = pacer.speech('');
  reply.update('one two three four five six'); // 27 letters, about 450 ms
  reply.finish();
  const start = Date.now();
  await pacer.idle();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 350 && elapsed <= 900, `took ${elapsed} ms`);
});
