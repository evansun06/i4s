import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LogEvent } from '../core/types.js';
import type { ValidationReport } from '../drawing/excalidraw/contracts/domain.js';
import { ingestConversation } from '../drawing/excalidraw/conversation.js';
import { FinalOrchestrator } from '../drawing/excalidraw/finalOrchestrator.js';
import {
  OpenAICompatibleProvider,
  type ModelMeasurement,
} from '../drawing/excalidraw/provider.js';

/** The groups the evaluation reports; the raw codes are kept alongside. */
export type ReasonCategory =
  | 'cycle'
  | 'invalid-reference'
  | 'unsupported-commitment'
  | 'schema-or-generation'
  | 'other';

const INVALID_REFERENCE = new Set([
  'object_reference',
  'source_reference',
  'relationship_reference',
  'redirect_reference',
  'reply_reference',
  // A decision-history entry whose sequence does not match its cited message.
  'decision_history',
  'edge_endpoint',
  'decision_option',
  'orphan_option',
  'canonical_membership',
  'cross_links',
  'annotation_association',
  'duplicate_id',
  'missing_evidence',
  'excerpt',
  'attribution',
]);

const UNSUPPORTED_COMMITMENT = new Set([
  'approval_fidelity',
  'adoption_authority',
  'decision_authority',
  'decision_state',
  'historical_selection',
  'stale_selection',
  'selection_mode',
  'selection_relationship',
  'rejection_relationship',
  'question_state',
  'plan_status',
  'plan_origin',
  'plan_grounding',
  'technology_choice',
  'constraint_conflict',
  'origin',
  'inferred_origin',
  'edge_origin',
  'origin_classification',
]);

const GENERATION = new Set([
  'schema',
  'step1_generation',
  'step2_generation',
  'step2_repair_generation',
]);

export function categorize(code: string): ReasonCategory {
  if (code.includes('cycle')) return 'cycle';
  if (INVALID_REFERENCE.has(code)) return 'invalid-reference';
  if (UNSUPPORTED_COMMITMENT.has(code)) return 'unsupported-commitment';
  if (GENERATION.has(code)) return 'schema-or-generation';
  return 'other';
}

export interface StageOutcome {
  /** Errors on the first attempt; empty when it passed. */
  readonly initialErrors: readonly string[];
  readonly repaired: boolean;
  readonly passed: boolean;
  /** Errors left after any repair; empty when it passed. */
  readonly finalErrors: readonly string[];
}

export interface PipelineResult {
  readonly outcome: 'passed-first-try' | 'passed-after-repair' | 'rejected';
  /** Categories of the errors that caused rejection, or that repair fixed. */
  readonly reasons: readonly ReasonCategory[];
  readonly step1: StageOutcome;
  /** Absent when Step 1 failed and the graphs were never built. */
  readonly step2?: StageOutcome;
  readonly wallClockMs: number;
  readonly requests: readonly ModelMeasurement[];
  readonly error?: string;
}

const errorCodes = (report: ValidationReport | undefined) =>
  [
    ...new Set(
      (report?.issues ?? [])
        .filter((item) => item.severity === 'error')
        .map((item) => item.code),
    ),
  ].sort();

function stage(
  saved: ReadonlyMap<string, unknown>,
  name: 'step1' | 'step2',
  final: ValidationReport | undefined,
): StageOutcome {
  const initial = saved.get(`${name}.initial.validation.json`) as
    ValidationReport | undefined;
  const finalErrors = errorCodes(final);
  return {
    initialErrors: initial ? errorCodes(initial) : finalErrors,
    repaired: initial !== undefined,
    passed: final?.passed === true,
    finalErrors,
  };
}

/**
 * Runs the /draw extraction pipeline (Step 1 knowledge, Step 2 graphs) on a
 * debate's full log, as the app does, and records whether the graphs passed
 * validation first time, after the pipeline's bounded repair, or not at all.
 * Artifacts are written to `artifactDir` for inspection.
 */
export async function runPipeline(
  log: readonly LogEvent[],
  options: {
    readonly apiKey: string;
    readonly model: string;
    readonly specification: string;
    readonly artifactDir: string;
  },
): Promise<PipelineResult> {
  const requests: ModelMeasurement[] = [];
  const saved = new Map<string, unknown>();
  await mkdir(options.artifactDir, { recursive: true });
  const started = performance.now();
  const orchestrator = new FinalOrchestrator({
    provider: new OpenAICompatibleProvider({
      apiKey: options.apiKey,
      model: options.model,
      onComplete: (measurement) => requests.push(measurement),
    }),
    specification: options.specification,
    decisionBuilder: 'canonical',
    save: async (filename, content) => {
      if (filename.endsWith('.json')) saved.set(filename, JSON.parse(content));
      await writeFile(join(options.artifactDir, filename), content);
    },
  });
  try {
    const result = await orchestrator.processConversation(
      ingestConversation(log),
    );
    const step1 = stage(saved, 'step1', result.step1Report);
    const step2 = result.step2Report
      ? stage(saved, 'step2', result.step2Report)
      : undefined;
    // An HTTP failure says nothing about the graphs; report it as an error.
    const failedRequest = requests.find(
      (request) =>
        request.httpStatus !== undefined && request.httpStatus !== 200,
    );
    const passed = step1.passed && step2?.passed === true;
    const repaired = step1.repaired || step2?.repaired === true;
    const codes = passed
      ? [...step1.initialErrors, ...(step2?.initialErrors ?? [])]
      : [...step1.finalErrors, ...(step2?.finalErrors ?? [])];
    return {
      outcome: passed
        ? repaired
          ? 'passed-after-repair'
          : 'passed-first-try'
        : 'rejected',
      reasons: [...new Set(codes.map(categorize))].sort(),
      step1,
      ...(step2 && { step2 }),
      wallClockMs: Math.round(performance.now() - started),
      requests,
      ...(failedRequest && {
        error: `HTTP ${failedRequest.httpStatus} during ${failedRequest.kind}`,
      }),
    };
  } catch (error) {
    return {
      outcome: 'rejected',
      reasons: ['schema-or-generation'],
      step1: {
        initialErrors: [],
        repaired: false,
        passed: false,
        finalErrors: [],
      },
      wallClockMs: Math.round(performance.now() - started),
      requests,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
