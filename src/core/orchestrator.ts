import {
  DEFAULT_TEMPERATURE,
  draftPrompt,
  findAddressed,
  findMentions,
  findQuestion,
  parseReply,
  followupPrompt,
  reviewPrompt,
  SUMMARIZER_SYSTEM,
  summaryPrompt,
  transcript,
  type DiscussionContext,
} from '../agents/prompts.js';
import { setTimeout as delay } from 'node:timers/promises';
import {
  RateLimitError,
  type ModelProvider,
  type ModelRequest,
} from '../providers/model.js';
import { resolveAgent } from '../agents/identity.js';
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
  readonly temperatures?: Partial<Record<AgentId, number>>;
  readonly angry?: boolean;
}

// A ceiling, not a target: thinking models spend part of it before answering.
const REPLY_TOKENS = 4096;
const SUMMARY_TOKENS = 4096;
// High effort spends far more on reasoning before the reply itself.
const DEEP_TOKENS = 16000;
/** Deep replies agents may ask for per round, so a round cannot snowball. */
const MAX_DEEP_PER_ROUND = 2;
/** A brief exchange, not an endless autonomous discussion. */
const MAX_MESSAGES = 6;
const MANUAL_ANNOUNCEMENT = 'Give me a moment to think.';
const MAX_ATTEMPTS = 4;
const MAX_RETRY_SECONDS = 60;

/** Granted the floor, sent back to redraft, or dropped for this round. */
type FloorTurn = 'granted' | 'redraft' | 'drop';

type ReviewResult =
  | { kind: 'keep'; text: string; to: string | undefined; heardUpTo: number }
  | { kind: 'withdraw' | 'failed'; heardUpTo: number; notice?: string };

interface QueuedContribution {
  agent: AgentDefinition;
  text: string;
  to: string | undefined;
  heardUpTo: number;
  announcement: boolean;
  reviewing: boolean;
  result?: ReviewResult;
  cancelled?: FloorTurn;
  wake: (turn: FloorTurn) => void;
}

/** Short exchanges with directed follow-ups and user priority between messages. */
export class Orchestrator {
  readonly bus: EventBus;
  readonly #agents: readonly AgentDefinition[];
  readonly #provider: ModelProvider;
  readonly #listeners = new Set<() => void>();
  readonly #conditions = new Set<() => void>();
  readonly #agentStates = new Map<AgentId, AgentState>();
  readonly #agentListeners = new Set<AgentListener>();
  readonly #shutdown = new AbortController();
  #disposed = false;
  /** Agents with a contribution in progress; they can span rounds. */
  readonly #active = new Set<AgentId>();
  readonly #floorQueue: QueuedContribution[] = [];
  #scheduling = false;
  #displayWaiting = false;
  #displayRevision = -1;
  /** Agents @mentioned this round; empty means everyone takes part. */
  #mentioned: readonly AgentId[] = [];
  /** Agents reasoning at high effort right now; others wanting to wait. */
  readonly #deepActive = new Set<AgentId>();
  #deepThisRound = 0;
  /** Resolves once everything said so far has been shown; see setDisplayGate. */
  #waitForDisplay: () => Promise<void> = () => Promise.resolve();
  /** Angry mode, switchable any time; read before every reply. */
  #angry = false;
  /** The user wants the floor once the current speaker finishes. */
  #handRaised = false;
  #messagesThisExchange = 0;
  readonly #followups = new Map<
    AgentId,
    { eventId: number; speaker: string }
  >();
  readonly #readThrough = new Map<AgentId, number>();
  /** Agents the user asked to think deeply this round, not yet started. */
  readonly #deepRequested = new Set<AgentId>();
  readonly #temperatures = new Map<AgentId, number>();
  #floorBusy = false;
  /** Drafts that never saw this log entry are dropped and redrafted. */
  #discardBefore = -1;
  /** Id of the user message that started the current round. */
  #roundStartedAt = -1;
  #mode: RoomMode = 'initial-prompt';
  #resumeTo: RoomMode = 'running';
  #speaking: RoomSnapshot['speaking'];
  #pendingQuestion: RoomSnapshot['pendingQuestion'];
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
      this.#temperatures.set(
        agent.id,
        agent.temperature ?? DEFAULT_TEMPERATURE,
      );
    }

    const saved = options.restore;
    this.bus = new EventBus(saved?.log);
    if (!saved?.log.length) return;
    this.#summary = saved.summary;
    this.#foldedUpTo = saved.foldedUpTo;
    this.#angry = saved.angry === true;
    for (const [id, value] of Object.entries(saved.temperatures ?? {})) {
      if (this.#temperatures.has(id as AgentId) && isTemperature(value)) {
        this.#temperatures.set(id as AgentId, value);
      }
    }
    this.#mode = 'awaiting-user';
    for (const event of this.bus.log) {
      if (event.kind === 'user-message') this.#roundStartedAt = event.id;
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
      temperatures: Object.fromEntries(this.#temperatures),
      angry: this.#angry,
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
      queue: this.#orderedQueue().map((entry) => entry.agent.id),
      mentioned: this.#mentioned,
      handRaised: this.#handRaised,
      angry: this.#angry,
      temperatures: Object.fromEntries(this.#temperatures) as Record<
        AgentId,
        number
      >,
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
   *
   * `deep` lists agents to reason at high effort on this message, as if they
   * had asked to. They skip the per-round cap and do not wait on each other.
   */
  async submit(
    text: string,
    options: {
      readonly answer?: boolean;
      readonly deep?: readonly AgentId[];
    } = {},
  ): Promise<void> {
    this.#shutdown.signal.throwIfAborted();
    if (this.#mode !== 'initial-prompt' && this.#mode !== 'awaiting-user') {
      throw new Error('Wait for the agents to finish before replying.');
    }
    const pending = this.#pendingQuestion;
    const answering = pending !== undefined && options.answer !== false;
    this.#pendingQuestion = undefined;
    if (pending) this.#setAgent(pending.agent, 'listening');
    this.#deepThisRound = 0;
    this.#handRaised = false;
    this.#messagesThisExchange = 0;
    this.#followups.clear();
    this.#deepRequested.clear();
    for (const id of options.deep ?? []) this.#deepRequested.add(id);
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
    for (const entry of [...this.#floorQueue]) {
      if (!this.#takesPart(entry.agent.id)) this.#removeQueued(entry, 'drop');
      else if (
        (pending && !answering) ||
        this.#deepRequested.has(entry.agent.id)
      )
        this.#removeQueued(entry, 'redraft');
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
      (this.#active.size === 0 && this.#followups.size === 0) ||
      (this.#pendingQuestion !== undefined &&
        !this.#active.has(this.#pendingQuestion.agent)) ||
      (this.#yielding && !this.#floorBusy);
    await this.#until(settled);
    if (this.#disposed) return;
    // Held drafts point into recent messages, so only condense between them.
    if (this.#active.size === 0) await this.#compact();
    if (this.#disposed) return;

    if (this.#mode === 'paused') this.#resumeTo = 'awaiting-user';
    else this.#setMode('awaiting-user');
  }

  get #yielding(): boolean {
    return this.#handRaised || this.#messagesThisExchange >= MAX_MESSAGES;
  }

  #startFollowups(): void {
    if (
      this.#disposed ||
      this.#mode !== 'running' ||
      this.#pendingQuestion ||
      this.#yielding
    )
      return;
    for (const [id, request] of this.#followups) {
      if (this.#active.has(id)) continue;
      if ((this.#readThrough.get(id) ?? 0) > request.eventId) {
        this.#followups.delete(id);
        continue;
      }
      const agent = this.#agents.find((candidate) => candidate.id === id);
      if (agent && this.#takesPart(id)) this.#start(agent, false);
      else this.#followups.delete(id);
    }
  }

  #takesPart(agent: AgentId): boolean {
    return !this.#mentioned.length || this.#mentioned.includes(agent);
  }

  /** Angry mode on or off; takes effect from each agent's next reply. */
  setAngry(on: boolean): void {
    this.#angry = on;
    this.#changed();
  }

  /**
   * Lets the UI hold each reply back until the one before it has finished
   * showing. Replies are still prepared in the background, but a raised hand
   * then lands right after what the user is reading, not after replies they
   * have not seen yet.
   */
  setDisplayGate(wait: () => Promise<void>): void {
    this.#waitForDisplay = wait;
  }

  /**
   * The user wants to speak. The current speaker finishes, no one else takes
   * the floor, and the round ends. Agents holding drafts keep them and go
   * first next round, after reviewing what the user says. Returns false if
   * no round is running.
   */
  raiseHand(): boolean {
    if (
      this.#disposed ||
      this.#handRaised ||
      (this.#mode !== 'running' &&
        !(this.#mode === 'paused' && this.#resumeTo === 'running'))
    )
      return false;
    this.#handRaised = true;
    this.#changed();
    return true;
  }

  pause(): void {
    if (this.#mode !== 'running' && this.#mode !== 'awaiting-user') return;
    this.#resumeTo = this.#mode;
    this.#setMode('paused');
  }

  /** Returns false when the usage limit still blocks progress. */
  resume(): boolean {
    if (this.#disposed) return false;
    if (this.#mode !== 'paused') return true;
    if (this.#callsUsed >= this.#callLimit) return false;
    this.#notice = undefined;
    this.#setMode(this.#resumeTo);
    this.#startFollowups();
    this.#grantFloor();
    return true;
  }

  /**
   * Sets how boldly an agent's personality comes through, for one agent or
   * all: 0 is generic, 0.5 is its normal self, 1 is its voice at full volume.
   * Takes effect on their next reply; the model's own temperature is untouched.
   */
  setTemperature(target: AgentId | 'all', value: number): void {
    if (!isTemperature(value)) {
      throw new Error('Temperature must be a number from 0 to 1.');
    }
    const ids = target === 'all' ? [...this.#temperatures.keys()] : [target];
    for (const id of ids) {
      if (!this.#temperatures.has(id)) throw new Error(`Unknown agent ${id}.`);
      this.#temperatures.set(id, value);
    }
    this.#changed();
  }

  raiseCallLimit(by: number): void {
    if (
      !Number.isSafeInteger(by) ||
      by <= 0 ||
      !Number.isSafeInteger(this.#callLimit + by)
    ) {
      throw new Error('Add a positive whole number of calls.');
    }
    this.#callLimit += by;
    this.#changed();
  }

  #start(agent: AgentDefinition, forced: boolean): void {
    if (this.#disposed) return;
    this.#active.add(agent.id);
    void this.#contribute(agent, forced)
      .catch((error: unknown) => {
        if (!this.#disposed) {
          this.#notice = errorMessage(error);
          this.#endTurn(agent.id, 'failed');
        }
      })
      .finally(() => {
        this.#active.delete(agent.id);
        this.#startFollowups();
        this.#grantFloor();
        this.#changed();
      });
  }

  async #contribute(agent: AgentDefinition, forced: boolean): Promise<void> {
    while ((await this.#attempt(agent, forced)) === 'stale') {
      // The user moved on before this draft was used; start over.
    }
  }

  /** One draft; with `deep`, the high-effort run after announcing it. */
  async #attempt(
    agent: AgentDefinition,
    forced: boolean,
    deep?: { readonly announcement: string },
  ): Promise<'done' | 'stale'> {
    if (!this.#takesPart(agent.id)) {
      this.#setAgent(agent.id, 'listening');
      return 'done';
    }
    if (!deep && this.#deepRequested.delete(agent.id)) {
      return this.#deliberate(agent, forced, MANUAL_ANNOUNCEMENT, true);
    }
    this.#setAgent(agent.id, deep ? 'deliberating' : 'thinking');
    await this.#waitRunning();
    const heardUpTo = this.bus.log.length;
    this.#readThrough.set(agent.id, heardUpTo);
    const followup = this.#followups.get(agent.id);
    let raw = '';
    let live = false;
    let reserved = false;
    try {
      for await (const chunk of this.#generate(agent.name, {
        kind: 'draft',
        system: agent.systemPrompt,
        prompt:
          followup && !deep
            ? followupPrompt(
                this.#context(),
                followup.speaker,
                this.#temperatures.get(agent.id) ?? DEFAULT_TEMPERATURE,
                this.#angry,
              )
            : draftPrompt(this.#context(), {
                forced,
                angry: this.#angry,
                temperature:
                  this.#temperatures.get(agent.id) ?? DEFAULT_TEMPERATURE,
                addressed: this.#mentioned.map(
                  (id) =>
                    this.#agents.find((other) => other.id === id)?.name ?? id,
                ),
                allowDeep: !deep && this.#deepThisRound < MAX_DEEP_PER_ROUND,
                ...(deep && { deepAnnouncement: deep.announcement }),
              }),
        maxOutputTokens: deep ? DEEP_TOKENS : REPLY_TOKENS,
        ...(deep && { effort: 'high' as const }),
      })) {
        raw += chunk;
        const reply = parseReply(raw, false);
        if (!reply) continue;
        if (reply.action !== 'speak') break;
        // Nobody has spoken since this draft began, so it can stream live.
        if (!live && this.#claimFloorNow(agent.id, heardUpTo)) {
          reserved = true;
          await this.#waitForDisplay();
          this.#shutdown.signal.throwIfAborted();
          if (
            this.#mode === 'running' &&
            !this.#pendingQuestion &&
            !this.#yielding &&
            this.bus.log.length === heardUpTo &&
            !this.#floorQueue.some(
              (entry) => entry.reviewing || entry.heardUpTo !== heardUpTo,
            )
          )
            live = true;
          else {
            reserved = false;
            this.#releaseFloor();
          }
        }
        if (live) this.#showSpeech(agent.id, reply.body);
      }
    } catch (error) {
      this.#notice = `${agent.name} could not respond: ${errorMessage(error)}`;
      if (reserved) this.#releaseFloor();
      this.#endTurn(agent.id, 'failed');
      return 'done';
    }

    const draft = parseReply(raw, true);
    if (this.#disposed) return 'done';
    // Still drafting from before a round that left this agent out.
    if (!this.#takesPart(agent.id)) {
      this.#setAgent(agent.id, 'listening');
      return 'done';
    }
    if (!live && heardUpTo <= this.#discardBefore) return 'stale';
    if (draft?.action === 'deep' && !deep) {
      return this.#deliberate(agent, forced, draft.body, false, heardUpTo);
    }
    const passed = draft?.action !== 'speak' || !draft.body;
    // A pass decided before the user's latest message is not a pass on it.
    if (passed && heardUpTo <= this.#roundStartedAt) return 'stale';
    if (passed) {
      if (live) this.#releaseFloor();
      this.#endTurn(agent.id, 'passed');
      return 'done';
    }
    if (live) {
      this.#commit(agent.id, draft.body, draft.to);
      this.#releaseFloor();
      return 'done';
    }

    const delivered = await this.#deliver(
      agent,
      draft.body,
      draft.to,
      heardUpTo,
    );
    return delivered === 'stale' ? 'stale' : 'done';
  }

  /** Queue-owned drafts are reviewed together before anyone takes the floor. */
  async #deliver(
    agent: AgentDefinition,
    text: string,
    to: string | undefined,
    heardUpTo: number,
    announcement = false,
  ): Promise<'done' | 'stale' | { text: string }> {
    const entry: QueuedContribution = {
      agent,
      text,
      to,
      heardUpTo,
      announcement,
      reviewing: false,
      wake: () => {},
    };
    let front = false;
    while (!this.#disposed) {
      this.#setAgent(
        agent.id,
        findQuestion(entry.text) ? 'has-question' : 'waiting',
      );
      const turn = await this.#takeFloor(entry, front);
      front = true;
      if (turn === 'redraft') return 'stale';
      if (turn === 'drop') return 'done';
      let retry = false;
      try {
        if (
          !this.#canProgress ||
          this.#floorQueue.some(
            (queued) =>
              queued.reviewing || queued.heardUpTo !== this.bus.log.length,
          )
        ) {
          retry = true;
          continue;
        }
        if (announcement) this.#announce(agent.id, entry.text);
        else this.#commit(agent.id, entry.text, entry.to);
        return { text: entry.text };
      } finally {
        this.#releaseFloor(!retry);
      }
    }
    return 'done';
  }

  /**
   * The agent asked to reason at high effort. It first tells the others what
   * it will think through, then drafts again at high effort while the round
   * goes on. If another agent is already reasoning, this one waits for that
   * answer and reconsiders, since it may cover the same ground.
   *
   * `manual`: the user asked for it, so there is no waiting and no cap.
   */
  async #deliberate(
    agent: AgentDefinition,
    forced: boolean,
    announcement: string,
    manual = false,
    heardUpTo = this.bus.log.length,
  ): Promise<'done' | 'stale'> {
    const busy = [...this.#deepActive].find((id) => id !== agent.id);
    if (!manual && busy !== undefined) {
      this.#setAgent(agent.id, 'waiting');
      this.#notice = `${agent.name} is waiting for ${this.#agents.find((other) => other.id === busy)?.name ?? busy} to finish thinking`;
      this.#changed();
      await this.#until(
        () =>
          this.#deepActive.size === 0 &&
          this.#mode === 'running' &&
          !this.#pendingQuestion &&
          !this.#handRaised,
      );
      return 'stale';
    }
    if (!manual && this.#deepThisRound >= MAX_DEEP_PER_ROUND) {
      this.#endTurn(agent.id, 'passed');
      return 'done';
    }

    this.#deepActive.add(agent.id);
    this.#deepThisRound += 1;
    try {
      const delivered = await this.#deliver(
        agent,
        announcement || 'Let me think this one through properly.',
        undefined,
        heardUpTo,
        true,
      );
      if (typeof delivered === 'string') return delivered;
      return await this.#attempt(agent, forced, {
        announcement: delivered.text,
      });
    } finally {
      this.#deepActive.delete(agent.id);
      this.#changed();
    }
  }

  /** A short message saying the agent is thinking something through. */
  #announce(agent: AgentId, text: string): void {
    if (this.#disposed) return;
    this.#showSpeech(agent, text);
    this.#messagesThisExchange += 1;
    this.bus.append({ kind: 'agent-message', agent, text });
    this.#speaking = undefined;
    this.#setAgent(agent, 'deliberating');
  }

  /** Captures context at the actual call start, including after budget waits. */
  async #review(entry: QueuedContribution): Promise<ReviewResult> {
    const { agent } = entry;
    let heardUpTo = entry.heardUpTo;
    let raw = '';
    try {
      for await (const chunk of this.#generate(
        agent.name,
        () => {
          heardUpTo = this.bus.log.length;
          this.#readThrough.set(agent.id, heardUpTo);
          return {
            kind: 'review',
            system: agent.systemPrompt,
            prompt:
              reviewPrompt(
                entry.text,
                this.#context(),
                entry.heardUpTo - this.#foldedUpTo,
                this.#temperatures.get(agent.id) ?? DEFAULT_TEMPERATURE,
                this.#angry,
              ) +
              (entry.announcement
                ? '\nThis draft announces planned deep reasoning. KEEP or REVISE the announcement if that work is still useful; WITHDRAW if it is already covered. Do not replace the announcement with the answer.'
                : ''),
            maxOutputTokens: REPLY_TOKENS,
          };
        },
        () => !entry.cancelled,
      )) {
        raw += chunk;
        const reply = parseReply(raw, false);
        if (reply && reply.action !== 'revise' && reply.action !== 'speak')
          break;
      }
    } catch (error) {
      return {
        kind: 'failed',
        heardUpTo,
        notice: `${agent.name} could not review: ${errorMessage(error)}`,
      };
    }
    const reply = parseReply(raw, true);
    if (reply?.action === 'keep')
      return { kind: 'keep', text: entry.text, to: entry.to, heardUpTo };
    if (
      (reply?.action === 'revise' || reply?.action === 'speak') &&
      reply.body &&
      /^(?:REVISE|SPEAK)\b/i.test(raw.trim())
    )
      return { kind: 'keep', text: reply.body, to: reply.to, heardUpTo };
    if (reply?.action === 'withdraw' || reply?.action === 'pass')
      return { kind: 'withdraw', heardUpTo };
    return {
      kind: 'failed',
      heardUpTo,
      notice: `${agent.name} returned an invalid review; reply dropped.`,
    };
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
    // Maintenance must not hold a round open while the user needs the floor.
    // Leave older messages intact and try again at a later round boundary.
    if (
      this.#disposed ||
      this.#mode !== 'running' ||
      this.#pendingQuestion ||
      this.#yielding
    ) {
      return;
    }
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

  /** `to`: the agent this reply mainly answers, by id or name, if any. */
  #commit(agent: AgentId, text: string, to?: string): void {
    if (this.#disposed) return;
    // A kept draft was never streamed, so it is shown whole before committing.
    this.#showSpeech(agent, text);
    const question = findQuestion(text);
    this.#messagesThisExchange += 1;
    const event = this.bus.append({ kind: 'agent-message', agent, text });
    const target = [
      to ? resolveAgent(to) : undefined,
      ...findAddressed(text, this.#agents),
    ].find((id) => id !== undefined && id !== agent && this.#takesPart(id));
    if (target) {
      this.#followups.set(target, {
        eventId: event.id,
        speaker: this.#agents.find((other) => other.id === agent)!.name,
      });
    }
    if (question) {
      // Ends the round: no one else takes the floor until the user answers.
      this.#pendingQuestion = { agent, eventId: event.id, question };
      this.#endTurn(agent, 'asked');
    } else {
      this.#endTurn(agent, 'spoke');
    }
    this.#startFollowups();
  }

  #showSpeech(agent: AgentId, text: string): void {
    if (this.#disposed) return;
    this.#speaking = { agent, text };
    this.#setAgent(agent, 'speaking');
  }

  #endTurn(agent: AgentId, result: TurnResult): void {
    if (this.#speaking?.agent === agent) this.#speaking = undefined;
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

  #claimFloorNow(agent: AgentId, heardUpTo: number): boolean {
    if (
      this.#floorBusy ||
      this.#floorQueue.length ||
      this.#mode !== 'running' ||
      this.#pendingQuestion ||
      this.#yielding ||
      (this.#followups.size > 0 &&
        this.#followups.keys().next().value !== agent) ||
      this.bus.log.length !== heardUpTo
    ) {
      return false;
    }
    this.#floorBusy = true;
    return true;
  }

  get #canProgress(): boolean {
    return (
      !this.#disposed &&
      this.#mode === 'running' &&
      !this.#pendingQuestion &&
      !this.#yielding
    );
  }

  #orderedQueue(): QueuedContribution[] {
    const priority = this.#followups.keys().next().value;
    return [...this.#floorQueue].sort(
      (a, b) =>
        Number(b.agent.id === priority) - Number(a.agent.id === priority),
    );
  }

  #takeFloor(entry: QueuedContribution, front = false): Promise<FloorTurn> {
    if (this.#disposed) return Promise.resolve('drop');
    return new Promise((wake) => {
      entry.wake = wake;
      if (front) this.#floorQueue.unshift(entry);
      else this.#floorQueue.push(entry);
      this.#changed();
      this.#grantFloor();
    });
  }

  #removeQueued(entry: QueuedContribution, turn: FloorTurn): void {
    const index = this.#floorQueue.indexOf(entry);
    if (index < 0) return;
    this.#floorQueue.splice(index, 1);
    entry.cancelled = turn;
    if (
      ['reviewing', 'waiting', 'has-question'].includes(
        this.agentState(entry.agent.id).activity,
      )
    )
      this.#setAgent(entry.agent.id, 'listening');
    // Keep the contribution active until its call finishes: never overlap
    // an old review with a new draft from the same agent.
    if (!entry.reviewing) entry.wake(turn);
    this.#changed();
  }

  #grantFloor(): void {
    if (!this.#canProgress || this.#scheduling) return;
    this.#scheduling = true;
    try {
      for (const entry of [...this.#floorQueue]) {
        const result = entry.result;
        if (result) {
          delete entry.result;
          if (result.kind === 'keep') {
            entry.text = result.text;
            entry.to = result.to;
            entry.heardUpTo = result.heardUpTo;
          } else if (result.heardUpTo === this.bus.log.length) {
            if (result.notice) this.#notice = result.notice;
            this.#endTurn(
              entry.agent.id,
              result.kind === 'failed' ? 'failed' : 'withdrew',
            );
            this.#removeQueued(entry, 'drop');
            continue;
          }
          this.#setAgent(
            entry.agent.id,
            findQuestion(entry.text) ? 'has-question' : 'waiting',
          );
        }
        if (!this.#canProgress) return;
        if (!entry.reviewing && entry.heardUpTo !== this.bus.log.length) {
          entry.reviewing = true;
          this.#setAgent(entry.agent.id, 'reviewing');
          void this.#review(entry)
            .then((result) => {
              if (!entry.cancelled && !this.#disposed) entry.result = result;
            })
            .finally(() => {
              entry.reviewing = false;
              if (entry.cancelled) entry.wake(entry.cancelled);
              else if (!this.#canProgress && !this.#disposed)
                this.#setAgent(
                  entry.agent.id,
                  findQuestion(entry.text) ? 'has-question' : 'waiting',
                );
              this.#grantFloor();
              this.#changed();
            });
        }
      }
      if (
        !this.#canProgress ||
        this.#floorBusy ||
        this.#floorQueue.some(
          (entry) => entry.reviewing || entry.heardUpTo !== this.bus.log.length,
        )
      )
        return;
      const priority = this.#followups.keys().next().value;
      const next = this.#orderedQueue()[0];
      if (!next || (priority && next.agent.id !== priority)) return;
      if (this.#displayRevision !== this.bus.log.length) {
        if (!this.#displayWaiting) {
          this.#displayWaiting = true;
          const revision = this.bus.log.length;
          void this.#waitForDisplay()
            .then(() => {
              this.#displayRevision = revision;
            })
            .catch((error: unknown) => {
              this.#notice = `Could not finish playback: ${errorMessage(error)}`;
              this.pause();
            })
            .finally(() => {
              this.#displayWaiting = false;
              this.#grantFloor();
              this.#changed();
            });
        }
        return;
      }
      this.#floorQueue.splice(this.#floorQueue.indexOf(next), 1);
      this.#floorBusy = true;
      next.wake('granted');
      this.#changed();
    } finally {
      this.#scheduling = false;
    }
  }

  #releaseFloor(schedule = true): void {
    this.#floorBusy = false;
    if (schedule) this.#grantFloor();
  }

  /** Waits out rate limits instead of failing; retries never count as calls. */
  async *#generate(
    who: string,
    request: ModelRequest | (() => ModelRequest),
    current: () => boolean = () => true,
  ): AsyncIterable<string> {
    for (let attempt = 1; ; attempt += 1) {
      let started = false;
      try {
        // Gate and start atomically: another draft exhausting the budget must
        // not strand a reservation before its provider request even starts.
        while (true) {
          if (!current()) return;
          if (
            this.#mode !== 'running' ||
            this.#pendingQuestion ||
            this.#yielding
          ) {
            await this.#until(
              () =>
                !current() ||
                (this.#mode === 'running' &&
                  !this.#pendingQuestion &&
                  !this.#yielding),
            );
            this.#shutdown.signal.throwIfAborted();
            continue;
          }
          this.#shutdown.signal.throwIfAborted();
          if (attempt > 1 || this.#callsUsed < this.#callLimit) break;
          this.#notice = 'Usage limit reached. Raise the limit to continue.';
          this.pause();
        }
        if (attempt === 1) {
          this.#callsUsed += 1;
          queueMicrotask(() => this.#changed());
        }
        for await (const chunk of this.#provider.generate({
          ...(typeof request === 'function' ? request() : request),
          signal: this.#shutdown.signal,
        })) {
          this.#shutdown.signal.throwIfAborted();
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
        await delay(seconds * 1000, undefined, {
          signal: this.#shutdown.signal,
        });
      }
    }
  }

  async #waitRunning(): Promise<void> {
    await this.#until(() => this.#mode === 'running' && !this.#pendingQuestion);
    this.#shutdown.signal.throwIfAborted();
  }

  /** Stop calls and release held work; committed messages remain saveable. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#shutdown.abort();
    for (const entry of [...this.#floorQueue])
      this.#removeQueued(entry, 'drop');
    this.#speaking = undefined;
    this.#changed();
  }

  /** Resolves once `predicate` holds, checked after every change. */
  #until(predicate: () => boolean): Promise<void> {
    if (this.#disposed || predicate()) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (!this.#disposed && !predicate()) return;
        this.#conditions.delete(check);
        resolve();
      };
      this.#conditions.add(check);
    });
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

function isTemperature(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
