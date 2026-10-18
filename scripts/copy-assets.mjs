import { copyFile, mkdir } from 'node:fs/promises';

const files = ['pallette/idiots.gpl'];
for (const name of ['ruby', 'lemon', 'jade', 'bleu']) {
  for (const extension of ['png', 'json'])
    files.push(`source/agents/${name}.${extension}`);
}
for (const file of files) {
  const source = new URL(`../src/assets/${file}`, import.meta.url);
  const target = new URL(`../dist/assets/${file}`, import.meta.url);
  await mkdir(new URL('.', target), { recursive: true });
  await copyFile(source, target);
}
