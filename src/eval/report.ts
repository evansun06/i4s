import type { DebateResult, HistoryConfig } from './debate.js';
import { CRITERIA, type Judgment, type Scores } from './judge.js';
import type { PipelineResult } from './pipeline.js';

export type RunRecord = DebateResult & { readonly pipeline?: PipelineResult };

export interface EvalResults {
  readonly meta: Readonly<Record<string, unknown>>;
  readonly runs: readonly RunRecord[];
  readonly judgments: readonly Judgment[];
}

const CONFIGS: readonly HistoryConfig[] = ['full', 'summary'];

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: readonly number[]) =>
  values.length ? sum(values) / values.length : NaN;
function median(values: readonly number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
const fixed = (value: number, digits = 0) =>
  Number.isNaN(value)
    ? 'n/a'
    : value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

/** Debate calls only; the synthesis and judge are reported separately. */
export function debateTokens(run: RunRecord) {
  const measured = run.calls.filter((call) => call.inputTokens !== undefined);
  return {
    calls: run.calls.length,
    unmeasured: run.calls.length - measured.length,
    inputPerCall: measured.map((call) => call.inputTokens!),
    input: sum(measured.map((call) => call.inputTokens!)),
    output: sum(measured.map((call) => call.outputTokens ?? 0)),
    summaryCalls: run.calls.filter((call) => call.kind === 'summary').length,
  };
}

export function scoreOf(
  judgments: readonly Judgment[],
  run: RunRecord,
): Scores | undefined {
  return judgments.find((item) => item.problemId === run.problemId)?.scores?.[
    run.config
  ];
}

export const total = (scores: Scores) =>
  sum(CRITERIA.map((criterion) => scores[criterion]));

/** Completed, judged runs from lowest to highest summed score. */
export function lowestScoring(results: EvalResults, count: number) {
  return results.runs
    .flatMap((run) => {
      const scores = scoreOf(results.judgments, run);
      return scores ? [{ run, scores, total: total(scores) }] : [];
    })
    .sort((a, b) => a.total - b.total)
    .slice(0, count);
}

export function summaryMarkdown(results: EvalResults): string {
  const lines: string[] = [];
  const row = (cells: readonly (string | number)[]) =>
    lines.push(`| ${cells.join(' | ')} |`);
  const { meta, runs, judgments } = results;

  lines.push('# Evaluation summary', '');
  lines.push(
    `Run ${String(meta.startedAt)} at commit \`${String(meta.commit)}\`.`,
    `Debates: \`${String(meta.debateModel)}\`. Judge: \`${String(meta.judgeModel)}\`. Pipeline: \`${String(meta.pipelineModel)}\`.`,
    `Problems: ${String((meta.problems as unknown[] | undefined)?.length ?? 0)}. All numbers below come from \`results.json\` in this folder.`,
    '',
  );

  lines.push('## Configurations', '');
  row([
    'Metric',
    ...CONFIGS.map((config) =>
      config === 'full' ? 'Full history' : 'Rolling summary',
    ),
  ]);
  row(['---', ...CONFIGS.map(() => '---:')]);
  const byConfig = (config: HistoryConfig) =>
    runs.filter((run) => run.config === config);
  const metric = (
    label: string,
    value: (selected: readonly RunRecord[]) => string,
  ) => row([label, ...CONFIGS.map((config) => value(byConfig(config)))]);

  metric(
    'Debates completed',
    (selected) =>
      `${selected.filter((run) => run.completed).length} / ${selected.length}`,
  );
  const completed = (selected: readonly RunRecord[]) =>
    selected.filter((run) => run.completed);
  metric('Model calls per debate (mean)', (selected) =>
    fixed(mean(completed(selected).map((run) => debateTokens(run).calls)), 1),
  );
  metric('Input tokens per call (mean)', (selected) =>
    fixed(
      mean(
        completed(selected).flatMap((run) => debateTokens(run).inputPerCall),
      ),
    ),
  );
  metric('Input tokens per call (median)', (selected) =>
    fixed(
      median(
        completed(selected).flatMap((run) => debateTokens(run).inputPerCall),
      ),
    ),
  );
  metric('Input tokens per call (max)', (selected) => {
    const all = completed(selected).flatMap(
      (run) => debateTokens(run).inputPerCall,
    );
    return all.length ? fixed(Math.max(...all)) : 'n/a';
  });
  metric('Total tokens per debate (mean)', (selected) =>
    fixed(
      mean(
        completed(selected).map((run) => {
          const tokens = debateTokens(run);
          return tokens.input + tokens.output;
        }),
      ),
    ),
  );
  metric('Summary calls per debate (mean)', (selected) =>
    fixed(
      mean(completed(selected).map((run) => debateTokens(run).summaryCalls)),
      1,
    ),
  );
  metric('Agent turns per debate (mean)', (selected) =>
    fixed(mean(completed(selected).map((run) => run.agentTurns)), 1),
  );
  metric('Wall-clock per debate, s (mean)', (selected) =>
    fixed(mean(completed(selected).map((run) => run.wallClockMs / 1000)), 1),
  );
  metric('Calls without reported usage', (selected) =>
    String(sum(selected.map((run) => debateTokens(run).unmeasured))),
  );
  for (const criterion of CRITERIA)
    metric(`Judge: ${criterion} (mean, 1-5)`, (selected) =>
      fixed(
        mean(
          selected.flatMap((run) => {
            const scores = scoreOf(judgments, run);
            return scores ? [scores[criterion]] : [];
          }),
        ),
        2,
      ),
    );
  metric('Judge: sum of three (mean, 3-15)', (selected) =>
    fixed(
      mean(
        selected.flatMap((run) => {
          const scores = scoreOf(judgments, run);
          return scores ? [total(scores)] : [];
        }),
      ),
      2,
    ),
  );
  for (const outcome of [
    'passed-first-try',
    'passed-after-repair',
    'rejected',
  ] as const)
    metric(`Pipeline: ${outcome}`, (selected) =>
      String(
        selected.filter((run) => run.pipeline?.outcome === outcome).length,
      ),
    );
  lines.push('');

  const scored = judgments.filter((item) => item.scores);
  const wins = { full: 0, summary: 0, tie: 0 };
  let firstShownWins = 0;
  for (const item of scored) {
    const full = total(item.scores!.full);
    const summary = total(item.scores!.summary);
    if (full === summary) wins.tie += 1;
    else {
      const winner = full > summary ? 'full' : 'summary';
      wins[winner] += 1;
      if (winner === item.order[0]) firstShownWins += 1;
    }
  }
  lines.push('## Head to head', '');
  lines.push(
    `Of ${scored.length} judged problems (${judgments.length - scored.length} unjudged): full history scored higher on ${wins.full}, rolling summary on ${wins.summary}, tied on ${wins.tie}.`,
    `When one response won, it was the one shown first ${firstShownWins} of ${wins.full + wins.summary} times (position-bias check).`,
    '',
  );

  lines.push('## Pipeline rejection and repair reasons', '');
  row(['Problem', 'Config', 'Outcome', 'Reasons', 'Error codes']);
  row(['---', '---', '---', '---', '---']);
  for (const run of runs) {
    const pipeline = run.pipeline;
    if (!pipeline || pipeline.outcome === 'passed-first-try') continue;
    const codes = [
      ...new Set([
        ...pipeline.step1.initialErrors,
        ...pipeline.step1.finalErrors,
        ...(pipeline.step2?.initialErrors ?? []),
        ...(pipeline.step2?.finalErrors ?? []),
      ]),
    ];
    row([
      run.problemId,
      run.config,
      pipeline.outcome,
      pipeline.reasons.join(', ') || '-',
      (codes.join(', ') || pipeline.error) ?? '-',
    ]);
  }
  lines.push('');

  lines.push('## Per run', '');
  row([
    'Problem',
    'Config',
    'Calls',
    'Input/call',
    'Total tokens',
    'Turns',
    'Time (s)',
    'Rel',
    'Spec',
    'Reb',
    'Pipeline',
  ]);
  row([
    '---',
    '---',
    '---:',
    '---:',
    '---:',
    '---:',
    '---:',
    '---:',
    '---:',
    '---:',
    '---',
  ]);
  for (const run of runs) {
    const tokens = debateTokens(run);
    const scores = scoreOf(judgments, run);
    row([
      run.problemId,
      run.completed ? run.config : `${run.config} (failed)`,
      tokens.calls,
      fixed(mean(tokens.inputPerCall)),
      fixed(tokens.input + tokens.output),
      run.agentTurns,
      fixed(run.wallClockMs / 1000, 1),
      scores?.relevance ?? '-',
      scores?.specificity ?? '-',
      scores?.rebuttals ?? '-',
      run.pipeline?.outcome ?? '-',
    ]);
  }
  lines.push('');

  lines.push('## Lowest-scoring runs', '');
  for (const { run, total: score } of lowestScoring(results, 3))
    lines.push(`- \`${run.problemId}\` (${run.config}): ${score}/15`);
  lines.push('');
  return lines.join('\n');
}
