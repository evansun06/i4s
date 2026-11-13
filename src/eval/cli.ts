import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { presets } from '../providers/presets.js';
import {
  debateTranscript,
  runDebate,
  type HistoryConfig,
  type Problem,
} from './debate.js';
import { judge, seededRandom, type Judgment } from './judge.js';
import { MeasuredProvider, type ProviderFactory } from './measure.js';
import { runPipeline } from './pipeline.js';
import {
  lowestScoring,
  summaryMarkdown,
  type EvalResults,
  type RunRecord,
} from './report.js';

const root = new URL('../../', import.meta.url);
const CONFIGS: readonly HistoryConfig[] = ['full', 'summary'];

const HELP = `npm run eval -- [options]

Runs every problem as a four-round debate twice, with full history and with
rolling summaries, then has a separate model call judge the two final
recommendations unlabeled and in random order. Each debate's log also goes
through the /draw extraction pipeline. Uses OPENAI_API_KEY, or the OpenAI key
saved by the app.

  --only <ids>          Comma-separated problem ids to run
  --limit <n>           Only the first n problems
  --model <id>          Debate and synthesis model (default: ${presets.openai.models.draft})
  --judge-model <id>    Judge model (default: same as --model)
  --pipeline-model <id> Extraction pipeline model (default: gpt-6-luna)
  --no-pipeline         Skip the extraction pipeline
  --concurrency <n>     Problems run at once (default: 1); both configs of a
                        problem always run side by side
  --compact-at <tokens> Summary config: condense past this size (default: 1500)
  --keep <tokens>       Summary config: recent size kept word for word (default: 600)
  --seed <n>            Seed for the judge's presentation order (default: 7)
  --out <dir>           Results parent (default: evals/results)
  --report <dir>        Only rebuild summary.md from <dir>/results.json`;

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      limit: { type: 'string' },
      model: { type: 'string', default: presets.openai.models.draft },
      'judge-model': { type: 'string' },
      'pipeline-model': { type: 'string', default: 'gpt-6-luna' },
      'no-pipeline': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: '1' },
      'compact-at': { type: 'string', default: '1500' },
      keep: { type: 'string', default: '600' },
      seed: { type: 'string', default: '7' },
      out: { type: 'string' },
      report: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return console.log(HELP);
  if (values.report) {
    const directory = resolve(values.report);
    const results = JSON.parse(
      await readFile(join(directory, 'results.json'), 'utf8'),
    ) as EvalResults;
    await writeFile(join(directory, 'summary.md'), summaryMarkdown(results));
    return console.log(`Rebuilt ${join(directory, 'summary.md')}`);
  }

  const number = (name: string, value: string | undefined) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
      throw new Error(`--${name} must be a positive whole number.`);
    return parsed;
  };
  const concurrency = number('concurrency', values.concurrency);
  const seed = number('seed', values.seed);
  const settings = {
    callLimit: 400,
    compactAtTokens: number('compact-at', values['compact-at']),
    keepTokens: number('keep', values.keep),
    roundTimeoutMs: 15 * 60_000,
  };
  const debateModel = values.model;
  const judgeModel = values['judge-model'] ?? debateModel;

  const { problems: all } = JSON.parse(
    await readFile(new URL('evals/problems.json', root), 'utf8'),
  ) as { problems: Problem[] };
  const only = values.only?.split(',').map((id) => id.trim());
  for (const id of only ?? [])
    if (!all.some((problem) => problem.id === id))
      throw new Error(`Unknown problem "${id}".`);
  let problems = only ? all.filter((p) => only.includes(p.id)) : all;
  if (values.limit) problems = problems.slice(0, number('limit', values.limit));

  const apiKey = process.env.OPENAI_API_KEY ?? (await savedOpenAIKey());
  if (!apiKey)
    throw new Error(
      'No OpenAI key. Set OPENAI_API_KEY or add one in the app first.',
    );
  const factory =
    (model: string): ProviderFactory =>
    (onUsage) =>
      new OpenAICompatibleProvider({
        baseUrl: presets.openai.baseUrl,
        apiKey,
        models: { draft: model, review: model, summary: model },
        maxTokensField: presets.openai.maxTokensField,
        highEffort: presets.openai.highEffort,
        onUsage,
      });
  const specification = await readFile(
    new URL('docs/excalidraw.md', root),
    'utf8',
  );

  const startedAt = new Date().toISOString();
  const directory = join(
    values.out
      ? resolve(values.out)
      : fileURLToPath(new URL('evals/results/', root)),
    startedAt.replaceAll(':', '-').replace(/\.\d+Z$/, 'Z'),
  );
  await mkdir(join(directory, 'transcripts'), { recursive: true });
  const meta = {
    startedAt,
    commit: git(['rev-parse', '--short', 'HEAD']),
    uncommittedChanges: git(['status', '--porcelain']) !== '',
    debateModel,
    judgeModel,
    pipelineModel: values['no-pipeline'] ? null : values['pipeline-model'],
    seed,
    concurrency,
    settings,
    problems: problems.map((problem) => problem.id),
  };
  console.error(`Results: ${directory}`);

  const runs = new Map<string, RunRecord>();
  const judgments = new Map<string, Judgment>();
  const ordered = (): EvalResults => ({
    meta,
    runs: problems.flatMap((problem) =>
      CONFIGS.flatMap((config) => {
        const run = runs.get(`${problem.id}.${config}`);
        return run ? [run] : [];
      }),
    ),
    judgments: problems.flatMap((problem) => {
      const item = judgments.get(problem.id);
      return item ? [item] : [];
    }),
  });
  let writing = Promise.resolve();
  const persist = () =>
    (writing = writing.then(async () => {
      const results = ordered();
      await writeFile(
        join(directory, 'results.json'),
        `${JSON.stringify(results, null, 2)}\n`,
      );
      await writeFile(join(directory, 'summary.md'), summaryMarkdown(results));
    }));

  // The judge's order for each problem depends only on the seed and problem.
  const orderFor = (problem: Problem) =>
    seededRandom(seed * 1000 + all.indexOf(problem));

  const evaluate = async (problem: Problem) => {
    const log = (text: string) => console.error(`[${problem.id}] ${text}`);
    log('debating (full and summary)');
    const debates = await Promise.all(
      CONFIGS.map((config) =>
        runDebate(problem, config, factory(debateModel), settings),
      ),
    );
    for (const debate of debates)
      log(
        `${debate.config}: ${debate.completed ? 'done' : `FAILED (${debate.error})`} · ${debate.calls.length} calls · ${debate.agentTurns} turns · ${(debate.wallClockMs / 1000).toFixed(1)}s`,
      );

    const records: RunRecord[] = await Promise.all(
      debates.map(async (debate): Promise<RunRecord> => {
        if (values['no-pipeline'] || debate.log.length === 0) return debate;
        const pipeline = await runPipeline(debate.log, {
          apiKey,
          model: values['pipeline-model'],
          specification,
          artifactDir: join(
            directory,
            'artifacts',
            `${problem.id}.${debate.config}`,
          ),
        });
        log(
          `${debate.config} pipeline: ${pipeline.outcome}${pipeline.reasons.length ? ` (${pipeline.reasons.join(', ')})` : ''}`,
        );
        return { ...debate, pipeline };
      }),
    );
    for (const record of records)
      runs.set(`${problem.id}.${record.config}`, record);

    const [full, summary] = records as [RunRecord, RunRecord];
    if (full.completed && summary.completed) {
      log('judging');
      const judgment = await judge(
        problem,
        { full, summary },
        new MeasuredProvider(factory(judgeModel), () => 'judge'),
        orderFor(problem),
      );
      judgments.set(problem.id, judgment);
      log(
        judgment.scores
          ? `scores: full ${JSON.stringify(judgment.scores.full)}, summary ${JSON.stringify(judgment.scores.summary)}`
          : `judge FAILED (${judgment.error})`,
      );
    }
    for (const record of records)
      await writeFile(
        join(directory, 'transcripts', `${problem.id}.${record.config}.md`),
        transcriptMarkdown(problem, record, judgments.get(problem.id)),
      );
    await persist();
  };

  const queue = [...problems];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let problem = queue.shift(); problem; problem = queue.shift())
        await evaluate(problem);
    }),
  );
  await persist();

  const results = ordered();
  const lowest = lowestScoring(results, 3);
  console.error(
    `\nDone. Summary: ${join(directory, 'summary.md')}\nLowest-scoring runs: ${lowest.map(({ run, total }) => `${run.problemId}.${run.config} (${total}/15)`).join(', ') || 'none judged'}`,
  );
}

function transcriptMarkdown(
  problem: Problem,
  run: RunRecord,
  judgment: Judgment | undefined,
): string {
  const scores = judgment?.scores?.[run.config];
  return [
    `# ${problem.id} · ${run.config}`,
    '',
    `Category: ${problem.category}. Completed: ${run.completed}${run.error ? ` (${run.error})` : ''}.`,
    `Agent turns: ${run.agentTurns}. Calls: ${run.calls.length}. Wall-clock: ${(run.wallClockMs / 1000).toFixed(1)}s.`,
    scores
      ? `Judge: relevance ${scores.relevance}, specificity ${scores.specificity}, rebuttals ${scores.rebuttals}. Shown as response ${judgment.order.indexOf(run.config) + 1}.`
      : 'Judge: not scored.',
    judgment?.rationale ? `Judge rationale: ${judgment.rationale}` : '',
    run.pipeline
      ? `Pipeline: ${run.pipeline.outcome}${run.pipeline.reasons.length ? ` (${run.pipeline.reasons.join(', ')})` : ''}.`
      : '',
    run.notices.length ? `Room notices: ${run.notices.join(' / ')}` : '',
    '',
    '## Transcript',
    '',
    '```text',
    debateTranscript(run.log),
    '```',
    '',
    ...(run.summary
      ? [
          `## Rolling summary (folded through message ${run.foldedUpTo})`,
          '',
          run.summary,
          '',
        ]
      : []),
    '## Final recommendation',
    '',
    run.finalRecommendation ?? '(none)',
    '',
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');
}

async function savedOpenAIKey(): Promise<string | undefined> {
  const { keychain } = await import('../storage/credentials.js');
  return (await keychain.get('openai')) ?? undefined;
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
