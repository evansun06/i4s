import {
  draftPrompt,
  findMentions,
  findQuestion,
  parseReply,
  reviewPrompt,
  SUMMARIZER_SYSTEM,
  summaryPrompt,
  transcript,
  type DiscussionContext,
} from '../agents/prompts.js';
import {
  RateLimitError,
  type ModelProvider,
  type ModelRequest,
} from '../providers/model.js';
import { EventBus } from './events.js';
import { assertTransition } from './room.js';
import type {
  AgentActivity,
  AgentDefinition,
  AgentId,
  AgentState,
  LogEvent,
  RoomMode,
  RoomSnapshot,
  TurnResult,
} from './types.js';

export type AgentListener = (
  id: AgentId,
  state: AgentState,
  previous: AgentState,
) => void;

export interface OrchestratorOptions {
  readonly agents: readonly AgentDefinition[];
  readonly provider: ModelProvider;
  /** Hard ceiling on model calls, including reviews and summaries. */
  readonly callLimit: number;
  /** Condense older rounds once recent messages pass this size. */
  readonly compactAtTokens?: number;
  /** Rounds kept word for word after condensing, by size. */
  readonly keepTokens?: number;
  /** A discussion saved with `save()`, to continue where it left off. */
  readonly restore?: SavedDiscussion;
}

/** Everything needed to continue a discussion later; plain JSON data. */
export interface SavedDiscussion {
  readonly log: readonly LogEvent[];
  readonly summary: string;
  readonly foldedUpTo: number;
  readonly pendingQuestion?: RoomSnapshot['pendingQuestion'];
}

// A ceiling, not a target: thinking models spend part of it before answering.
const REPLY_TOKENS = 4096;
const SUMMARY_TOKENS = 4096;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_SECONDS = 60;

/** Granted the floor, sent back to redraft, or dropped for this round. */
type FloorTurn = 'granted' | 'redraft' | 'drop';

/**
 * Runs one round per user message. Every agent drafts a reply at once; the
 * first with something to say speaks live. The rest wait for the floor and
 * review what they missed before speaking, so they keep listening.
 *
 * A question for the user ends the round at once. Agents still holding a
 * draft keep it and go first next round, after reviewing the user's answer.
 * Agents never carry on a discussion without the user.
 */
export class Orchestrator {
  readonly bus: EventBus;
  readonly #agents: readonly AgentDefinition[];
  readonly #provider: ModelProvider;
  readonly #listeners = new Set<() => void>();
  readonly #conditions = new Set<() => void>();
  readonly #agentStates = new Map<AgentId, AgentState>();
  readonly #agentListeners = new Set<AgentListener>();
  readonly #lastSpoke = new Map<AgentId, number>();
  readonly #resumeWaiters: (() => void)[] = [];
  /** Agents with a contribution in progress; they can span rounds. */
  readonly #active = new Set<AgentId>();
  readonly #floorQueue: {
    agent: AgentId;
    wake: (turn: FloorTurn) => void;
  }[] = [];
  /** Agents @mentioned this round; empty means everyone takes part. */
  #mentioned: readonly AgentId[] = [];
  #floorBusy = false;
  /** Drafts that never saw this log entry are dropped and redrafted. */
  #discardBefore = -1;
  /** Id of the user message that started the current round. */
  #roundStartedAt = -1;
  #mode: RoomMode = 'initial-prompt';
  #resumeTo: RoomMode = 'running';
  #speaking: RoomSnapshot['speaking'];
  #pendingQuestion: RoomSnapshot['pendingQuestion'];
  #spokeThisRound = false;
  #notice: string | undefined;
  #lastTurn: RoomSnapshot['lastTurn'];
  #callsUsed = 0;
  #callLimit: number;
  readonly #compactAtTokens: number;
  readonly #keepTokens: number;
  /** Older rounds live here instead of in prompts; the log keeps everything. */
  #summary = '';
  #foldedUpTo = 0;
  #snapshot: RoomSnapshot | undefined;

  constructor(options: OrchestratorOptions) {
    this.#agents = options.agents;
    this.#provider = options.provider;
    this.#callLimit = options.callLimit;
    this.#compactAtTokens = options.compactAtTokens ?? 8000;
    this.#keepTokens = options.keepTokens ?? 3000;
    for (const agent of this.#agents) {
      this.#agentStates.set(agent.id, { activity: 'listening' });
    }

    const saved = options.restore;
    this.bus = new EventBus(saved?.log);
    if (!saved?.log.length) return;
    this.#summary = saved.summary;
    this.#foldedUpTo = saved.foldedUpTo;
    this.#mode = 'awaiting-user';
    for (const event of this.bus.log) {
      if (event.kind === 'agent-message')
        this.#lastSpoke.set(event.agent, event.id);
      else this.#roundStartedAt = event.id;
    }
    // Drafts held for an answer are not saved; agents redraft after it.
    if (saved.pendingQuestion) {
      this.#pendingQuestion = saved.pendingQuestion;
      this.#agentStates.set(saved.pendingQuestion.agent, {
        activity: 'has-question',
      });
    }
  }

  /** The discussion so far, for storage. Call between rounds. */
  save(): SavedDiscussion {
    return {
      log: [...this.bus.log],
      summary: this.#summary,
      foldedUpTo: this.#foldedUpTo,
      ...(this.#pendingQuestion && { pendingQuestion: this.#pendingQuestion }),
    };
  }

  /** Cached until the next change, so React can use it as an external store. */
  snapshot(): RoomSnapshot {
    this.#snapshot ??= {
      mode: this.#mode,
      agents: Object.fromEntries(this.#agentStates) as Record<
        AgentId,
        AgentState
      >,
      queue: this.#floorQueue.map((waiter) => waiter.agent),
      mentioned: this.#mentioned,
      callsUsed: this.#callsUsed,
      callLimit: this.#callLimit,
      ...(this.#speaking && { speaking: this.#speaking }),
      ...(this.#pendingQuestion && { pendingQuestion: this.#pendingQuestion }),
      ...(this.#lastTurn && { lastTurn: this.#lastTurn }),
      ...(this.#notice !== undefined && { notice: this.#notice }),
    };
    return this.#snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  agentState(id: AgentId): AgentState {
    const state = this.#agentStates.get(id);
    if (!state) throw new Error(`Unknown agent ${id}.`);
    return state;
  }

  /** Called on every change to one agent's state, e.g. to start an animation. */
  subscribeAgents(listener: AgentListener): () => void {
    this.#agentListeners.add(listener);
    return () => this.#agentListeners.delete(listener);
  }

  /**
   * Sends a message and runs a round. Resolves when every agent is done or an
   * agent asks the user a question. Input is rejected while a round runs.
   *
   * While a question is pending, the message answers it. With
   * `{ answer: false }` the user sets the question aside instead: it stays
   * unanswered in the log, held drafts are dropped, and every agent replies
   * to this message afresh.
   *
   * "@blue" or "@red @green" in the message limits this round's replies to
   * those agents. The rest make no calls and simply read the log next round.
   */
  async submit(
    text: string,
    options: { readonly answer?: boolean } = {},
  ): Promise<void> {
    if (this.#mode !== 'initial-prompt' && this.#mode !== 'awaiting-user') {
      throw new Error('Wait for the agents to finish before replying.');
    }
    const pending = this.#pendingQuestion;
    const answering = pending !== undefined && options.answer !== false;
    this.#pendingQuestion = undefined;
    if (pending) this.#setAgent(pending.agent, 'listening');
    this.#spokeThisRound = false;
    const event = this.bus.append({
      kind: 'user-message',
      text,
      ...(answering && { replyTo: pending.eventId }),
    });
    this.#roundStartedAt = event.id;
    this.#mentioned = findMentions(
      text,
      this.#agents.map((agent) => agent.id),
    );
    if (pending && !answering) this.#discardBefore = event.id;
    // Held drafts: excluded agents drop theirs; after a set-aside question,
    // everyone else redrafts.
    for (const waiter of this.#floorQueue.splice(0)) {
      if (!this.#takesPart(waiter.agent)) waiter.wake('drop');
      else if (pending && !answering) waiter.wake('redraft');
      else this.#floorQueue.push(waiter);
    }
    this.#setMode('running');
    // Drafts held over from before the question go first.
    this.#grantFloor();
    await this.#runRound();
  }

  async #runRound(): Promise<void> {
    for (const agent of this.#agents) {
      if (this.#takesPart(agent.id) && !this.#active.has(agent.id)) {
        // An agent the user addressed by name does not get to pass.
        this.#start(agent, this.#mentioned.includes(agent.id));
      }
    }
    // After a question, also wait for the asker to finish, so it is free to
    // reply in the very next round.
    const settled = () =>
      this.#active.size === 0 ||
      (this.#pendingQuestion !== undefined &&
        !this.#active.has(this.#pendingQuestion.agent));
    await this.#until(settled);
    // Everyone passed: the user still gets one reply.
    if (!this.#spokeThisRound && !this.#pendingQuestion) {
      this.#start(this.#quietest(), true);
      await this.#until(settled);
    }
    // Held drafts point into recent messages, so only condense between them.
    if (this.#active.size === 0) await this.#compact();

    if (this.#mode === 'paused') this.#resumeTo = 'awaiting-user';
    else this.#setMode('awaiting-user');
  }

  #takesPart(agent: AgentId): boolean {
    return !this.#mentioned.length || this.#mentioned.includes(agent);
  }

  pause(): void {
    if (this.#mode !== 'running' && this.#mode !== 'awaiting-user') return;
    this.#resumeTo = this.#mode;
    this.#setMode('paused');
  }

  /** Returns false when the usage limit still blocks progress. */
  resume(): boolean {
    if (this.#mode !== 'paused') return true;
    if (this.#callsUsed >= this.#callLimit) return false;
    this.#notice = undefined;
    this.#setMode(this.#resumeTo);
    for (const wake of this.#resumeWaiters.splice(0)) wake();
    this.#grantFloor();
    return true;
  }

  raiseCallLimit(by: number): void {
    this.#callLimit += by;
    this.#changed();
  }

  #start(agent: AgentDefinition, forced: boolean): void {
    this.#active.add(agent.id);
    void this.#contribute(agent, forced).finally(() => {
      this.#active.delete(agent.id);
      this.#changed();
    });
  }

  async #contribute(agent: AgentDefinition, forced: boolean): Promise<void> {
    while ((await this.#attempt(agent, forced)) === 'stale') {
      // The user moved on before this draft was used; start over.
    }
  }

  async #attempt(
    agent: AgentDefinition,
    forced: boolean,
  ): Promise<'done' | 'stale'> {
    this.#setAgent(agent.id, 'thinking');
    await this.#acquireCall();
    const heardUpTo = this.bus.log.length;
    let raw = '';
    let live = false;
    try {
      for await (const chunk of this.#generate(agent.name, {
        kind: 'draft',
        system: agent.systemPrompt,
        prompt: draftPrompt(this.#context(), {
          forced,
          addressed: this.#mentioned.map(
            (id) => this.#agents.find((other) => other.id === id)?.name ?? id,
          ),
        }),
        maxOutputTokens: REPLY_TOKENS,
      })) {
        raw += chunk;
        const reply = parseReply(raw, false);
        if (!reply) continue;
        if (reply.action !== 'speak') break;
        // Nobody has spoken since this draft began, so it can stream live.
        live ||= this.#claimFloorNow(heardUpTo);
        if (live) this.#showSpeech(agent.id, reply.body);
      }
    } catch (error) {
      this.#notice = `${agent.name} could not respond: ${errorMessage(error)}`;
      if (live) this.#releaseFloor();
      this.#endTurn(agent.id, 'failed');
      return 'done';
    }

    const draft = parseReply(raw, true);
    // Still drafting from before a round that left this agent out.
    if (!this.#takesPart(agent.id)) {
      this.#setAgent(agent.id, 'listening');
      return 'done';
    }
    if (!live && heardUpTo <= this.#discardBefore) return 'stale';
    const passed = draft?.action !== 'speak' || !draft.body;
    // A pass decided before the user's latest message is not a pass on it.
    if (passed && heardUpTo <= this.#roundStartedAt) return 'stale';
    if (passed) {
      if (live) this.#releaseFloor();
      this.#endTurn(agent.id, 'passed');
      return 'done';
    }
    if (live) {
      this.#commit(agent.id, draft.body);
      this.#releaseFloor();
      return 'done';
    }

    this.#setAgent(
      agent.id,
      findQuestion(draft.body) ? 'has-question' : 'waiting',
    );
    const turn = await this.#takeFloor(agent.id);
    if (turn === 'redraft') return 'stale';
    if (turn === 'drop') {
      this.#setAgent(agent.id, 'listening');
      return 'done';
    }
    try {
      if (this.bus.log.length === heardUpTo) this.#commit(agent.id, draft.body);
      else await this.#review(agent, draft.body, heardUpTo);
    } finally {
      this.#releaseFloor();
    }
    return 'done';
  }

  /** Called while holding the floor: keep, revise, or drop a stale draft. */
  async #review(
    agent: AgentDefinition,
    draft: string,
    heardUpTo: number,
  ): Promise<void> {
    await this.#acquireCall();
    this.#setAgent(agent.id, 'reviewing');
    let raw = '';
    try {
      for await (const chunk of this.#generate(agent.name, {
        kind: 'review',
        system: agent.systemPrompt,
        prompt: reviewPrompt(
          draft,
          this.#context(),
          heardUpTo - this.#foldedUpTo,
        ),
        maxOutputTokens: REPLY_TOKENS,
      })) {
        raw += chunk;
        const reply = parseReply(raw, false);
        if (!reply) continue;
        if (reply.action !== 'revise' && reply.action !== 'speak') break;
        this.#showSpeech(agent.id, reply.body);
      }
    } catch (error) {
      this.#notice = `${agent.name} could not respond: ${errorMessage(error)}`;
      this.#endTurn(agent.id, 'failed');
      return;
    }

    const reply = parseReply(raw, true);
    if (reply?.action === 'keep') this.#commit(agent.id, draft);
    else if (
      (reply?.action === 'revise' || reply?.action === 'speak') &&
      reply.body
    ) {
      this.#commit(agent.id, reply.body);
    } else this.#endTurn(agent.id, 'withdrew');
  }

  #context(): DiscussionContext {
    return {
      summary: this.#summary,
      recent: this.bus.log.slice(this.#foldedUpTo),
      answered: this.#answered(),
    };
  }

  #answered(): ReadonlySet<number> {
    const ids = new Set<number>();
    for (const event of this.bus.log) {
      if (event.kind === 'user-message' && event.replyTo !== undefined) {
        ids.add(event.replyTo);
      }
    }
    return ids;
  }

  /**
   * Once recent messages grow large, folds the oldest whole rounds into the
   * summary so every later call stays roughly the same size. The latest round
   * is always kept word for word.
   */
  async #compact(): Promise<void> {
    const log = this.bus.log;
    if (estimateTokens(log.slice(this.#foldedUpTo)) < this.#compactAtTokens) {
      return;
    }
    let cut = this.#foldedUpTo;
    for (const event of log.slice(this.#foldedUpTo + 1)) {
      if (event.kind !== 'user-message') continue;
      cut = event.id;
      if (estimateTokens(log.slice(cut)) <= this.#keepTokens) break;
    }
    if (cut === this.#foldedUpTo) return;

    await this.#acquireCall();
    this.#notice = 'Condensing earlier rounds';
    this.#changed();
    let summary = '';
    try {
      for await (const chunk of this.#generate('the summary', {
        kind: 'summary',
        system: SUMMARIZER_SYSTEM,
        prompt: summaryPrompt(
          this.#summary,
          log.slice(this.#foldedUpTo, cut),
          this.#answered(),
        ),
        maxOutputTokens: SUMMARY_TOKENS,
      })) {
        summary += chunk;
      }
    } catch (error) {
      summary = '';
      this.#notice = `Could not condense earlier rounds: ${errorMessage(error)}`;
    }
    if (summary.trim()) {
      this.#summary = summary.trim();
      this.#foldedUpTo = cut;
      this.#notice = undefined;
    }
    this.#changed();
  }

  #commit(agent: AgentId, text: string): void {
    // A kept draft was never streamed, so it is shown whole before committing.
    this.#showSpeech(agent, text);
    const question = findQuestion(text);
    const event = this.bus.append({ kind: 'agent-message', agent, text });
    this.#lastSpoke.set(agent, event.id);
    this.#spokeThisRound = true;
    if (question) {
      // Ends the round: no one else takes the floor until the user answers.
      this.#pendingQuestion = { agent, eventId: event.id, question };
      this.#endTurn(agent, 'asked');
    } else {
      this.#endTurn(agent, 'spoke');
    }
  }

  #showSpeech(agent: AgentId, text: string): void {
    this.#speaking = { agent, text };
    this.#setAgent(agent, 'speaking');
  }

  #endTurn(agent: AgentId, result: TurnResult): void {
    this.#speaking = undefined;
    this.#lastTurn = { agent, result };
    const activity: Record<TurnResult, AgentActivity> = {
      spoke: 'listening',
      asked: 'has-question',
      passed: 'passing',
      withdrew: 'passing',
      failed: 'listening',
    };
    this.#setAgent(agent, activity[result]);
  }

  #claimFloorNow(heardUpTo: number): boolean {
    if (
      this.#floorBusy ||
      this.#floorQueue.length ||
      this.#mode !== 'running' ||
      this.#pendingQuestion ||
      this.bus.log.length !== heardUpTo
    ) {
      return false;
    }
    this.#floorBusy = true;
    return true;
  }

  /**
   * First come, first served; held while paused or awaiting an answer.
   * The user's next message may instead send the draft back or drop it.
   */
  #takeFloor(agent: AgentId): Promise<FloorTurn> {
    return new Promise((wake) => {
      this.#floorQueue.push({ agent, wake });
      this.#changed();
      this.#grantFloor();
    });
  }

  #grantFloor(): void {
    if (this.#floorBusy || this.#mode !== 'running' || this.#pendingQuestion) {
      return;
    }
    const next = this.#floorQueue.shift();
    if (!next) return;
    this.#floorBusy = true;
    this.#changed();
    next.wake('granted');
  }

  #releaseFloor(): void {
    this.#floorBusy = false;
    this.#grantFloor();
  }

  /** Waits out rate limits instead of failing; retries never count as calls. */
  async *#generate(who: string, request: ModelRequest): AsyncIterable<string> {
    for (let attempt = 1; ; attempt += 1) {
      let started = false;
      try {
        for await (const chunk of this.#provider.generate(request)) {
          started = true;
          yield chunk;
        }
        return;
      } catch (error) {
        if (
          !(error instanceof RateLimitError) ||
          started ||
          attempt === MAX_ATTEMPTS
        ) {
          throw error;
        }
        const seconds = Math.min(
          error.retryAfterSeconds ?? 5 * 2 ** (attempt - 1),
          MAX_RETRY_SECONDS,
        );
        this.#notice = `Rate limited; ${who} retries in ${Math.ceil(seconds)}s.`;
        this.#changed();
        await new Promise((wake) => setTimeout(wake, seconds * 1000));
      }
    }
  }

  /** Blocks while paused; pauses the room instead of exceeding the limit. */
  async #acquireCall(): Promise<void> {
    while (true) {
      while (this.#mode === 'paused') {
        await new Promise<void>((wake) => this.#resumeWaiters.push(wake));
      }
      if (this.#callsUsed < this.#callLimit) {
        this.#callsUsed += 1;
        this.#changed();
        return;
      }
      this.#notice = 'Usage limit reached. Raise the limit to continue.';
      this.pause();
    }
  }

  /** Resolves once `predicate` holds, checked after every change. */
  #until(predicate: () => boolean): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (!predicate()) return;
        this.#conditions.delete(check);
        resolve();
      };
      this.#conditions.add(check);
    });
  }

  #quietest(): AgentDefinition {
    const candidates = this.#agents.filter((agent) =>
      this.#takesPart(agent.id),
    );
    const [quietest] = candidates.sort(
      (a, b) =>
        (this.#lastSpoke.get(a.id) ?? -1) - (this.#lastSpoke.get(b.id) ?? -1),
    );
    if (!quietest) throw new Error('The room has no agents.');
    return quietest;
  }

  #setMode(mode: RoomMode): void {
    assertTransition(this.#mode, mode);
    this.#mode = mode;
    this.#changed();
  }

  #setAgent(id: AgentId, activity: AgentActivity): void {
    const previous = this.agentState(id);
    if (activity !== previous.activity) {
      const next = { activity };
      this.#agentStates.set(id, next);
      for (const listener of this.#agentListeners) listener(id, next, previous);
    }
    this.#changed();
  }

  #changed(): void {
    this.#snapshot = undefined;
    for (const listener of this.#listeners) listener();
    for (const check of [...this.#conditions]) check();
  }
}

/** Rough and provider-neutral; only used to decide when to condense. */
function estimateTokens(events: Parameters<typeof transcript>[0]): number {
  return Math.ceil(transcript(events).length / 4);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
