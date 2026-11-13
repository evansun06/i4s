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

Score each FINAL RECOMMENDATION from 1 (poor) to 5 (excellent) on:
- relevance: answers what the user actually asked and respects every fact and constraint the user stated, including in later messages.
- specificity: concrete and actionable, using this user's own numbers and situation rather than generic advice.
- rebuttals: engages with the objections and counterarguments raised in its own discussion transcript, acknowledging the strongest ones and explaining why they do or do not change the advice.
Use the whole scale. Equal scores are fine when the responses are equally good.

Reply with JSON only, no code fence:
{"response1":{"relevance":n,"specificity":n,"rebuttals":n},"response2":{"relevance":n,"specificity":n,"rebuttals":n},"rationale":"two or three sentences comparing them"}`;
}

/** Returns undefined unless every score is a whole number from 1 to 5. */
export function parseJudgment(
  raw: string,
): { scores: [Scores, Scores]; rationale: string } | undefined {
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
  if (!first || !second) return undefined;
  return {
    scores: [first, second],
    rationale: typeof record.rationale === 'string' ? record.rationale : '',
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
