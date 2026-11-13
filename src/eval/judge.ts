import type { CallRecord, MeasuredProvider } from './measure.js';
import { debateTranscript, type DebateResult, type Problem } from './debate.js';

export const CRITERIA = ['relevance', 'specificity', 'rebuttals'] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Scores = Readonly<Record<Criterion, number>>;

export interface Judgment {
  readonly problemId: string;
  /** Which configuration was shown as Response 1 and Response 2. */
  readonly order: readonly [DebateResult['config'], DebateResult['config']];
  readonly scores?: Readonly<Record<DebateResult['config'], Scores>>;
  /** The judge's overall pick, independent of the summed scores. */
  readonly preferred?: DebateResult['config'] | 'tie';
  readonly weaknesses?: Readonly<Record<DebateResult['config'], string>>;
  readonly rationale?: string;
  readonly attempts: number;
  readonly error?: string;
  readonly calls: readonly CallRecord[];
}

export const JUDGE_SYSTEM = `You are a strict, impartial evaluator of advice. You compare two final recommendations, each written after a separate panel discussion of the same user problem. You do not know how either response was produced; the order is random. Score each response on its own merits.`;

export function judgePrompt(
  problem: Problem,
  responses: readonly [DebateResult, DebateResult],
): string {
  const shown = responses
    .map(
      (result, index) => `=== RESPONSE ${index + 1} ===
--- Discussion transcript ---
${debateTranscript(result.log)}
--- Final recommendation ---
${result.finalRecommendation}`,
    )
    .join('\n\n');
  return `THE USER'S MESSAGES, IN ORDER:
${[problem.prompt, ...problem.followUps].map((text, i) => `${i + 1}. ${text}`).join('\n')}

${shown}

Score each FINAL RECOMMENDATION from 1 to 5 on three criteria, using these anchors:
- relevance: 5 = answers every question the user asked and respects every fact and constraint the user stated, including in later messages; 4 = one minor omission; 3 = ignores one stated constraint or part of a question; 2 = ignores several; 1 = largely off target.
- specificity: 5 = every recommendation is tied to this user's own numbers and situation, with concrete steps (amounts, timelines, wording); 4 = mostly specific with a generic patch; 3 = an even mix of specific and generic advice; 2 = mostly generic; 1 = boilerplate that could apply to anyone.
- rebuttals: 5 = identifies the strongest objections actually raised in its own discussion transcript and resolves each with a reason; 4 = engages the main objections but skims one; 3 = mentions objections superficially or misses a major one that was raised; 2 = barely acknowledges disagreement; 1 = ignores it.
First write down each response's most important weakness. Reserve 5 for a criterion where the response has no meaningful weakness. Then say which response is better overall, or "tie" only if you genuinely cannot separate them.

Reply with JSON only, no code fence:
{"weaknesses":{"response1":"...","response2":"..."},"response1":{"relevance":n,"specificity":n,"rebuttals":n},"response2":{"relevance":n,"specificity":n,"rebuttals":n},"preferred":"1" or "2" or "tie","rationale":"two or three sentences comparing them"}}`;
}

/** Returns undefined unless every score is a whole number from 1 to 5. */
export function parseJudgment(raw: string):
  | {
      scores: [Scores, Scores];
      preferred: 1 | 2 | 'tie';
      weaknesses: [string, string];
      rationale: string;
    }
  | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const read = (key: string): Scores | undefined => {
    const entry = record[key] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== 'object') return undefined;
    const scores: Partial<Record<Criterion, number>> = {};
    for (const criterion of CRITERIA) {
      const score = entry[criterion];
      if (
        typeof score !== 'number' ||
        !Number.isInteger(score) ||
        score < 1 ||
        score > 5
      )
        return undefined;
      scores[criterion] = score;
    }
    return scores as Scores;
  };
  const first = read('response1');
  const second = read('response2');
  const preferred = String(record.preferred).trim().toLowerCase();
  if (!first || !second || !['1', '2', 'tie'].includes(preferred))
    return undefined;
  const weaknesses = (record.weaknesses ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    scores: [first, second],
    preferred: preferred === 'tie' ? 'tie' : preferred === '1' ? 1 : 2,
    weaknesses: [text(weaknesses.response1), text(weaknesses.response2)],
    rationale: text(record.rationale),
  };
}

/** Deterministic per seed, so a rerun shows the judge the same order. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_ATTEMPTS = 3;

/** One unlabeled comparison; an unparseable reply is asked again, up to three times. */
export async function judge(
  problem: Problem,
  results: Readonly<Record<DebateResult['config'], DebateResult>>,
  provider: MeasuredProvider,
  random: () => number,
): Promise<Judgment> {
  const order: Judgment['order'] =
    random() < 0.5 ? ['full', 'summary'] : ['summary', 'full'];
  const prompt = judgePrompt(problem, [results[order[0]], results[order[1]]]);
  let attempts = 0;
  let error: string | undefined;
  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    try {
      const raw = await provider.complete('judge', {
        kind: 'review',
        system: JUDGE_SYSTEM,
        prompt,
        maxOutputTokens: 8192,
      });
      const parsed = parseJudgment(raw);
      if (!parsed) {
        error = `Unparseable judge reply: ${raw.slice(0, 200)}`;
        continue;
      }
      return {
        problemId: problem.id,
        order,
        scores: {
          [order[0]]: parsed.scores[0],
          [order[1]]: parsed.scores[1],
        } as Record<DebateResult['config'], Scores>,
        preferred:
          parsed.preferred === 'tie' ? 'tie' : order[parsed.preferred - 1]!,
        weaknesses: {
          [order[0]]: parsed.weaknesses[0],
          [order[1]]: parsed.weaknesses[1],
        } as Record<DebateResult['config'], string>,
        rationale: parsed.rationale,
        attempts,
        calls: [...provider.calls],
      };
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  return {
    problemId: problem.id,
    order,
    attempts,
    calls: [...provider.calls],
    ...(error !== undefined && { error }),
  };
}
