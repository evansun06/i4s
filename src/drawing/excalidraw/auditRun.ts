import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decisionGraphSchema,
  implementationGraphSchema,
  knowledgeSchema,
  normalizeWireValue,
  parseContract,
} from './contracts.js';
import type { ConversationKnowledgeGraph } from './contracts/domain.js';
import { finalizePlanningGraphs } from './step2/finalize.js';

// Explicit offline diagnostics only: never a fallback for real model generation.
const source = process.argv[2];
if (!source) throw new Error('Usage: npm run audit-run -- <saved-run-folder>');
const sourceRun = resolve(source);
const load = async (name: string) =>
  JSON.parse(await readFile(join(sourceRun, name), 'utf8')) as unknown;
const loadDraft = async (kind: string) => {
  try {
    return await load(`step2.${kind}.repair.response.json`);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
    try {
      return await load(`step2.${kind}.response.json`);
    } catch (missing) {
      if (
        kind !== 'decision' ||
        !(missing instanceof Error) ||
        !('code' in missing) ||
        missing.code !== 'ENOENT'
      )
        throw missing;
      return load('step2.decision.json');
    }
  }
};
const knowledge = parseContract<ConversationKnowledgeGraph>(
  await load('knowledge.json'),
  knowledgeSchema,
);
const decision = normalizeWireValue(
  await loadDraft('decision'),
  decisionGraphSchema,
);
const implementation = normalizeWireValue(
  await loadDraft('implementation'),
  implementationGraphSchema,
);
let diagnostic: unknown;
const result = finalizePlanningGraphs(
  knowledge,
  decision,
  implementation,
  (value) => {
    diagnostic = value;
  },
);
const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'runs',
);
const output = await mkdtemp(
  join(root, `${new Date().toISOString().replaceAll(':', '-')}-audit-`),
);
const save = async (name: string, value: unknown) =>
  writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`);
await save('run.json', { mode: 'offline-audit', sourceRun, callsUsed: 0 });
await save('knowledge.json', knowledge);
if (diagnostic) await save('step2.candidate.json', diagnostic);
await save('step2.json', result);
await save('step2.validation.json', result.validationReport);
console.log(`Offline audit: ${output}`);
console.log(JSON.stringify(result.validationReport, null, 2));
