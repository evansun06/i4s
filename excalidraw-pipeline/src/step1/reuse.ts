import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  extractionSchema,
  validationReportSchema,
  validateSchema,
} from '../contracts.js';
import type { ConversationInput, Step1Result } from '../contracts/domain.js';
import { validateKnowledge } from './validate.js';
import { report } from '../common/validation.js';

/** Exact-snapshot reuse only. Saved reports alone never authorize cached knowledge. */
export async function reusableExtraction(
  parent: string,
  input: ConversationInput,
  specification: string,
  model: string,
): Promise<{ sourceRun: string; result: Step1Result } | undefined> {
  const entries = await readdir(parent, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, 20);
  const specificationSha256 = createHash('sha256')
    .update(specification)
    .digest('hex');
  for (const name of candidates) {
    const sourceRun = join(parent, name);
    try {
      const [run, conversation, schemas, validation, knowledge] =
        await Promise.all(
          [
            'run.json',
            'conversation.json',
            'schemas.json',
            'step1.validation.json',
            'knowledge.json',
          ].map(
            async (file) =>
              JSON.parse(
                await readFile(join(sourceRun, file), 'utf8'),
              ) as unknown,
          ),
        );
      if (
        !run ||
        typeof run !== 'object' ||
        !('model' in run) ||
        run.model !== model ||
        !('specificationSha256' in run) ||
        run.specificationSha256 !== specificationSha256 ||
        !isDeepStrictEqual(conversation, input) ||
        !schemas ||
        typeof schemas !== 'object' ||
        !('extraction' in schemas) ||
        !isDeepStrictEqual(schemas.extraction, extractionSchema) ||
        validateSchema(validation, validationReportSchema).length ||
        !(validation as Step1Result['validationReport']).passed ||
        (validation as Step1Result['validationReport']).issues.some(
          (i) => i.severity === 'error',
        )
      )
        continue;
      const result = validateKnowledge(knowledge, input);
      if (result.knowledgeGraph && result.validationReport.passed) {
        const issues = [
          ...(validation as Step1Result['validationReport']).issues,
          ...result.validationReport.issues,
        ];
        return {
          sourceRun,
          result: {
            knowledgeGraph: result.knowledgeGraph,
            validationReport: report([
              ...new Map(
                issues.map((item) => [JSON.stringify(item), item]),
              ).values(),
            ]),
          },
        };
      }
    } catch {
      // Incomplete, incompatible or corrupt runs are not reusable. Extract normally.
    }
  }
  return undefined;
}
