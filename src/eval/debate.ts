import { panel } from '../agents/panel.js';
import { render, transcript } from '../agents/prompts.js';
import { Orchestrator } from '../core/orchestrator.js';
import type { LogEvent } from '../core/types.js';
import type { ModelRequest } from '../providers/model.js';
import {
  MeasuredProvider,
  type CallRecord,
  type ProviderFactory,
} from './measure.js';

export interface Problem {
  readonly id: string;
  readonly category: string;
  readonly prompt: string;
  readonly followUps: readonly string[];
}

/** How agents see older rounds: the whole log, or the rolling summary. */
export type HistoryConfig = 'full' | 'summary';

export interface DebateSettings {
  readonly callLimit: number;
  /** Summary config only: condense once recent messages pass this size. */
  readonly compactAtTokens: number;
  readonly keepTokens: number;
  /** A round that takes longer is abandoned and the run marked failed. */
  readonly roundTimeoutMs: number;
}

export interface DebateResult {
  readonly problemId: string;
  readonly config: HistoryConfig;
  readonly completed: boolean;
  readonly error?: string;
  /** Debate only: the first user message to the end of the last round. */
  readonly wallClockMs: number;
  /** Public agent messages, including "thinking it through" announcements. */
  readonly agentTurns: number;
  readonly turnsByAgent: Readonly<Record<string, number>>;
  readonly questionsAsked: number;
  readonly calls: readonly CallRecord[];
  readonly log: readonly LogEvent[];
  readonly summary: string;
  readonly foldedUpTo: number;
  readonly notices: readonly string[];
  readonly finalRecommendation?: string;
  readonly synthesisCall?: CallRecord;
}

const callerOf = (request: ModelRequest) =>
  request.kind === 'summary'
    ? 'summarizer'
    : (panel.find((agent) => agent.systemPrompt === request.system)?.id ??
      'unknown');

/**
 * Runs one problem as a four-round debate: the prompt, then each scripted
 * follow-up. A question an agent asks is set aside by the next scripted
 * message, as a user who moves on would. No display gate, so replies are
 * not paced for reading.
 */
export async function runDebate(
  problem: Problem,
  config: HistoryConfig,
  factory: ProviderFactory,
  settings: DebateSettings,
): Promise<DebateResult> {
  const provider = new MeasuredProvider(factory, callerOf);
  const orchestrator = new Orchestrator({
    agents: panel,
    provider,
    callLimit: settings.callLimit,
    history: config,
    compactAtTokens: settings.compactAtTokens,
    keepTokens: settings.keepTokens,
  });
  const notices: string[] = [];
  orchestrator.subscribe(() => {
    const { notice } = orchestrator.snapshot();
    if (notice && notices.at(-1) !== notice) notices.push(notice);
  });

  let error: string | undefined;
  const started = performance.now();
  try {
    for (const text of [problem.prompt, ...problem.followUps]) {
      const snapshot = orchestrator.snapshot();
      if (snapshot.mode === 'paused')
        throw new Error(`Room paused: ${snapshot.notice ?? 'unknown reason'}`);
      const round = orchestrator.submit(
        text,
        snapshot.pendingQuestion ? { answer: false } : {},
      );
      await withTimeout(round, settings.roundTimeoutMs);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const wallClockMs = Math.round(performance.now() - started);
  // Finish background usage reads before disposing aborts their streams.
  if (error === undefined) await provider.settled();
  const saved = orchestrator.save();
  orchestrator.dispose();
  await provider.settled();

  const turnsByAgent: Record<string, number> = {};
  let questionsAsked = 0;
  for (const event of saved.log) {
    if (event.kind !== 'agent-message') continue;
    turnsByAgent[event.agent] = (turnsByAgent[event.agent] ?? 0) + 1;
    if (/^\s*\**QUESTION\b/im.test(event.text)) questionsAsked += 1;
  }

  const base = {
    problemId: problem.id,
    config,
    wallClockMs,
    agentTurns: saved.log.filter((event) => event.kind === 'agent-message')
      .length,
    turnsByAgent,
    questionsAsked,
    log: saved.log,
    summary: saved.summary,
    foldedUpTo: saved.foldedUpTo,
    notices,
  };
  if (error !== undefined)
    return { ...base, completed: false, error, calls: provider.calls };

  // The synthesis sees what the agents saw: the same summary/recent split.
  const context = {
    summary: saved.summary,
    recent: saved.log.slice(saved.foldedUpTo),
    answered: answeredQuestions(saved.log),
  };
  const before = provider.calls.length;
  try {
    const finalRecommendation = (
      await provider.complete('synthesis', {
        kind: 'draft',
        system: SYNTHESIS_SYSTEM,
        prompt: synthesisPrompt(render(context)),
        maxOutputTokens: 4096,
      })
    ).trim();
    return {
      ...base,
      completed: true,
      calls: provider.calls.slice(0, before),
      finalRecommendation,
      synthesisCall: provider.calls[before]!,
    };
  } catch (caught) {
    return {
      ...base,
      completed: false,
      error: `Synthesis failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      calls: provider.calls,
    };
  }
}

export const SYNTHESIS_SYSTEM = `You write the final recommendation of a discussion panel. Four advisors debated the user's problem; you speak for the panel as a whole, not as any one advisor. Use only what the discussion record contains. Do not invent facts or user requirements.`;

export function synthesisPrompt(record: string): string {
  return `${record}

Write the panel's final recommendation to the user, in under 250 words:
- The recommendation itself, stated plainly.
- The reasons, tied to the user's own facts and constraints.
- The strongest objections raised in the discussion, and why they do or do not change the advice.
- Concrete next steps.`;
}

function answeredQuestions(log: readonly LogEvent[]): Set<number> {
  const ids = new Set<number>();
  for (const event of log)
    if (event.kind === 'user-message' && event.replyTo !== undefined)
      ids.add(event.replyTo);
  return ids;
}

/** A plain transcript, for the judge and for reading. */
export function debateTranscript(log: readonly LogEvent[]): string {
  return transcript(log, answeredQuestions(log));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Round timed out after ${ms / 1000}s.`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
