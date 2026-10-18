import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { ingestConversation } from './conversation.js';
import {
  extractionSchema,
  decisionGraphSchema,
  implementationGraphSchema,
  step2ResultSchema,
  validateSchema,
} from './contracts.js';
import {
  extractionPrompt,
  FinalOrchestrator,
  DEFAULT_CALL_LIMIT,
} from './finalOrchestrator.js';
import { OpenAICompatibleProvider, type ModelMeasurement } from './provider.js';
import { reusableExtraction } from './step1/reuse.js';
import type {
  FinalOrchestratorResult,
  Step2Result,
} from './contracts/domain.js';
import { issue, report } from './common/validation.js';
import { buildExcalidrawScene } from './rendering/buildExcalidrawScene.js';
import { exportExcalidraw } from './rendering/exportExcalidraw.js';
import {
  inferPresentation,
  normalizePresentation,
} from './rendering/presentation.js';
import { normalizeRenderingInputs } from './rendering/readableScene.js';
import { terminalMaps } from './rendering/terminalMaps.js';
import { exportOnlineEdit } from './rendering/onlineEdit.js';

// The repository (or installed package) root: src|dist/drawing/excalidraw/.
const root = new URL('../../../', import.meta.url);
async function main() {
  const started = performance.now();
  const requests: ModelMeasurement[] = [];
  const onComplete = (measurement: ModelMeasurement) =>
    requests.push(measurement);
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      'session-file': { type: 'string' },
      'progress-json': { type: 'boolean', default: false },
      out: { type: 'string' },
      spec: { type: 'string' },
      model: { type: 'string', default: 'gpt-6-luna' },
      prepare: { type: 'boolean', default: false },
      run: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      'render-run': { type: 'string' },
      deterministic: { type: 'boolean', default: false },
      'reuse-presentation': { type: 'boolean', default: false },
      'reuse-extraction': { type: 'boolean', default: false },
    },
  });
  const progress = (event: Record<string, unknown>) => {
    if (values['progress-json'])
      console.error(`I4S_DRAW ${JSON.stringify(event)}`);
  };
  const onRequest = (stage: string) => progress({ type: 'call', stage });
  if (values.input && values['session-file'])
    throw new Error('Choose --input or --session-file, not both.');
  if (values.help) {
    console.log(
      'npm run pipeline -- [--input conversation.json] [--out runs] [--model gpt-6-luna] [--prepare] [--reuse-extraction]\nnpm run pipeline -- --render-run runs/<saved-run> [--reuse-presentation | --deterministic]\nSuccessful planning is followed by presentation design and Excalidraw export. No final review runs. --reuse-extraction revalidates matching saved Step 1 knowledge from the output parent, skipping extraction only for an unchanged conversation/specification/model/schema. --render-run creates a new run folder. --reuse-presentation reuses saved map content without model calls and drops old review/comment sections. --deterministic uses the original renderer.',
    );
    return;
  }
  if (
    values['reuse-presentation'] &&
    (!values['render-run'] || values.deterministic)
  )
    throw new Error(
      '--reuse-presentation requires --render-run and cannot be combined with --deterministic.',
    );
  if (values['render-run']) {
    if (
      values.prepare ||
      values.run ||
      values.input ||
      values['session-file'] ||
      values['reuse-extraction']
    )
      throw new Error(
        '--render-run cannot be combined with --prepare, --run or --input.',
      );
    const source = resolve(values['render-run']);
    const [planning, knowledge] = await Promise.all([
      readFile(join(source, 'step2.json'), 'utf8'),
      readFile(join(source, 'knowledge.json'), 'utf8'),
    ]);
    const input = normalizeRenderingInputs(
      JSON.parse(planning),
      JSON.parse(knowledge),
    );
    const parent = values.out
      ? resolve(values.out)
      : fileURLToPath(new URL('runs/', root));
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(
      join(
        parent,
        `${new Date().toISOString().replaceAll(':', '-')}-presentation-`,
      ),
    );
    const saveText = (name: string, content: string) =>
      writeFile(join(directory, name), content, { flag: 'wx' });
    const save = (name: string, value: unknown) =>
      saveText(name, `${JSON.stringify(value, null, 2)}\n`);
    await save('run.json', {
      mode: 'presentation',
      sourceRun: source,
      model:
        values.deterministic || values['reuse-presentation']
          ? null
          : values.model,
      presentationSource: values.deterministic
        ? 'deterministic'
        : values['reuse-presentation']
          ? 'saved'
          : 'model',
      callLimit: values.deterministic || values['reuse-presentation'] ? 0 : 1,
    });
    await saveText('step2.json', planning);
    await save('knowledge.json', input.knowledge);
    console.error(`Run folder: ${directory}`);
    progress({ type: 'run', directory });
    let callsUsed = 0;
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!values.deterministic && !values['reuse-presentation'] && !apiKey)
        throw new Error(
          'OPENAI_API_KEY is required for presentation inference. --deterministic uses the original renderer.',
        );
      let presentation;
      if (values['reuse-presentation']) {
        let sourceArtifact = 'step3.presentation.json';
        let saved: string;
        try {
          saved = await readFile(join(source, sourceArtifact), 'utf8');
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            error.code !== 'ENOENT'
          )
            throw error;
          // Failed presentation attempts retain their raw response. Validate it fully,
          // rather than requesting a new model response or treating it as trusted.
          sourceArtifact = 'step3.presentation.response.json';
          saved = await readFile(join(source, sourceArtifact), 'utf8');
        }
        presentation = normalizePresentation(
          JSON.parse(saved),
          input.graphs,
          input.knowledge,
        );
        await save('step3.presentation.json', presentation);
        await save('step3.reuse.json', {
          sourceRun: source,
          sourceArtifact,
          validated: true,
        });
      } else if (!values.deterministic) {
        const provider = new OpenAICompatibleProvider({
          apiKey: apiKey!,
          model: values.model,
          onRequest,
          onComplete,
        });
        const stageSave = (name: string, content: string) => {
          if (name === 'step3.presentation.prompt.txt') callsUsed++;
          return saveText(name, content);
        };
        presentation = await inferPresentation(
          provider,
          input.graphs,
          input.knowledge,
          stageSave,
        );
      }
      const scene = await buildExcalidrawScene(
        input.graphs,
        input.knowledge,
        presentation,
      );
      const exported = await exportExcalidraw(
        scene,
        join(directory, 'project-plan.excalidraw'),
      );
      await save('terminal-maps.json', terminalMaps(scene));
      const editUrl = await exportOnlineEdit(scene, directory);
      console.error(`Go online to edit: ${editUrl}`);
      await save('step3.json', exported);
      await save('completion.json', { status: 'completed', callsUsed });
      console.log(`Plan saved: ${exported.filePath}`);
    } catch (error) {
      await save('step3.json', {
        error:
          error instanceof Error
            ? error.message
            : 'Presentation generation failed.',
      });
      await save('completion.json', { status: 'failed', callsUsed });
      throw error;
    } finally {
      await save('timings.json', {
        elapsedMs: Math.round(performance.now() - started),
        requests,
      });
    }
    return;
  }
  if (values.prepare && values.run)
    throw new Error('Choose --prepare or --run.');
  const inputPath =
    values.input || values['session-file']
      ? resolve(values.input ?? values['session-file']!)
      : fileURLToPath(
          new URL('tests/pipeline/fixtures/conversation.seed.json', root),
        );
  const specificationPath = values.spec
    ? resolve(values.spec)
    : fileURLToPath(new URL('docs/excalidraw.md', root));
  const [inputText, specification] = await Promise.all([
    readFile(inputPath, 'utf8'),
    readFile(specificationPath, 'utf8'),
  ]);
  const loaded: unknown = JSON.parse(inputText);
  let original = loaded;
  if (values['session-file']) {
    if (
      !loaded ||
      typeof loaded !== 'object' ||
      !('discussion' in loaded) ||
      !loaded.discussion ||
      typeof loaded.discussion !== 'object' ||
      !('log' in loaded.discussion) ||
      !Array.isArray(loaded.discussion.log)
    )
      throw new Error(
        'Session file must contain discussion.log as an EventBus array.',
      );
    original = loaded.discussion.log;
  }
  const conversation = ingestConversation(original);
  const parent = values.out
    ? resolve(values.out)
    : fileURLToPath(new URL('runs/', root));
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(
    join(parent, `${new Date().toISOString().replaceAll(':', '-')}-`),
  );
  const text = (filename: string, content: string) =>
    writeFile(join(directory, filename), content, { flag: 'wx' });
  const save = (filename: string, value: unknown) =>
    text(filename, `${JSON.stringify(value, null, 2)}\n`);
  await save('input.log.json', original);
  await save('conversation.json', conversation);
  await save('schemas.json', {
    extraction: extractionSchema,
    decision: decisionGraphSchema,
    implementation: implementationGraphSchema,
    step2: step2ResultSchema,
  });
  await save('run.json', {
    mode: values.prepare ? 'prepare' : 'live',
    model: values.model,
    reasoningEffort: 'low',
    decisionBuilder: 'canonical',
    createdAt: new Date().toISOString(),
    inputPath,
    specificationPath,
    specificationSha256: createHash('sha256')
      .update(specification)
      .digest('hex'),
    conversationId: conversation.conversationId,
    snapshotSequence: conversation.snapshotSequence,
    callLimit: DEFAULT_CALL_LIMIT + (values.deterministic ? 0 : 1),
    planningCallLimit: DEFAULT_CALL_LIMIT,
    presentationCallLimit: values.deterministic ? 0 : 1,
    maxOutputTokensPerCall: 32768,
  });
  console.error(`Run folder: ${directory}`);
  progress({ type: 'run', directory });
  if (values.prepare) {
    await text(
      'step1.prompt.txt',
      extractionPrompt(conversation, specification),
    );
    await save('completion.json', { status: 'prepared', callsUsed: 0 });
    console.error(
      'Prepared input, schema and Step 1 prompt. No model calls made.',
    );
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const result: FinalOrchestratorResult = {
      step1Report: report([
        issue(
          'credentials',
          'OPENAI_API_KEY is required for real extraction. Configure it locally, then rerun.',
        ),
      ]),
    };
    await save('result.json', result);
    await save('completion.json', { status: 'failed', callsUsed: 0 });
    console.error(result.step1Report.issues[0]!.message);
    process.exitCode = 1;
    return;
  }
  const provider = new OpenAICompatibleProvider({
    apiKey,
    model: values.model,
    onRequest,
    onComplete,
  });
  const orchestrator = new FinalOrchestrator({
    provider,
    specification,
    save: text,
    decisionBuilder: 'canonical',
  });
  const reused = values['reuse-extraction']
    ? await reusableExtraction(
        parent,
        conversation,
        specification,
        values.model,
      )
    : undefined;
  let result: FinalOrchestratorResult;
  if (reused?.result.knowledgeGraph) {
    progress({ type: 'reuse', stage: 'extract', sourceRun: reused.sourceRun });
    console.error(
      'Reusing revalidated Step 1 extraction from an identical conversation snapshot.',
    );
    await save('step1.reuse.json', {
      sourceRun: reused.sourceRun,
      validated: true,
    });
    await save('knowledge.json', reused.result.knowledgeGraph);
    await save('step1.validation.json', reused.result.validationReport);
    const step2 = await orchestrator.buildPlanningGraphs(
      reused.result.knowledgeGraph,
    );
    result = {
      knowledgeGraph: reused.result.knowledgeGraph,
      step1Report: reused.result.validationReport,
      step2Report: step2.validationReport,
      ...(step2.planningGraphs ? { planningGraphs: step2.planningGraphs } : {}),
    };
  } else result = await orchestrator.processConversation(conversation);
  await save('result.json', result);
  const succeeded =
    result.step1Report.passed && result.step2Report?.passed === true;
  if (result.step2Report) {
    const step2: Step2Result = {
      ...(result.planningGraphs
        ? { planningGraphs: result.planningGraphs }
        : {}),
      validationReport: result.step2Report,
    };
    const errors = validateSchema(step2, step2ResultSchema);
    if (errors.length)
      throw new Error(
        `Internal Step 2 output contract failure: ${errors.join('; ')}`,
      );
    await save('step2.json', step2);
  }
  let exported = false;
  let presentationCalls = 0;
  if (succeeded && result.planningGraphs && result.knowledgeGraph) {
    try {
      const presentation = values.deterministic
        ? undefined
        : await inferPresentation(
            provider,
            result.planningGraphs,
            result.knowledgeGraph,
            (name, content) => {
              if (name === 'step3.presentation.prompt.txt')
                presentationCalls = 1;
              return text(name, content);
            },
          );
      const scene = await buildExcalidrawScene(
        result.planningGraphs,
        result.knowledgeGraph,
        presentation,
      );
      const output = await exportExcalidraw(
        scene,
        join(directory, 'project-plan.excalidraw'),
      );
      await save('terminal-maps.json', terminalMaps(scene));
      const editUrl = await exportOnlineEdit(scene, directory);
      console.error(`Go online to edit: ${editUrl}`);
      await save('step3.json', output);
      console.log(`Plan saved: ${output.filePath}`);
      for (const warning of output.warnings)
        console.error(`Render warning: ${warning}`);
      exported = true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Excalidraw export failed.';
      await save('step3.json', { error: message });
      console.error(`Excalidraw export failed: ${message}`);
    }
  }
  await save('completion.json', {
    status: succeeded && exported ? 'completed' : 'failed',
    callsUsed: orchestrator.callsUsed + presentationCalls,
    presentationCalls,
  });
  await save('timings.json', {
    elapsedMs: Math.round(performance.now() - started),
    extractionReused: Boolean(reused),
    requests,
  });
  if (!succeeded || !exported) {
    const errors = [
      ...result.step1Report.issues,
      ...(result.step2Report?.issues ?? []),
    ].filter((i) => i.severity === 'error');
    for (const error of errors.slice(0, 3))
      console.error(`${error.code}: ${error.message}`);
    if (errors.length > 3)
      console.error(
        `${errors.length - 3} additional validation errors are in the stage reports.`,
      );
    console.error(
      'Processing failed. Inspect result.json and per-stage validation reports.',
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Pipeline failed.');
  process.exitCode = 1;
});
