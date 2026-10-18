import {
  DEFAULT_TEMPERATURE,
  draftPrompt,
  findAddressed,
  findMentions,
  findQuestion,
  parseReply,
  rebuttalPrompt,
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
/** Back-and-forth replies between agents per round, after the main replies. */
const MAX_REBUTTALS = 3;
const MANUAL_ANNOUNCEMENT =
  'You asked me to think this one through, so give me a moment.';
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
  readonly #shutdown = new AbortController();
  #disposed = false;
  /** Agents with a contribution in progress; they can span rounds. */
  readonly #active = new Set<AgentId>();
  readonly #floorQueue: {
    agent: AgentId;
    wake: (turn: FloorTurn) => void;
  }[] = [];
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
  /** Whom each agent message mainly answered, by log id; not saved. */
  readonly #answeredWhom = new Map<number, AgentId>();
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
      queue: this.#floorQueue.map((waiter) => waiter.agent),
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
    this.#spokeThisRound = false;
    this.#deepThisRound = 0;
    this.#handRaised = false;
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
    for (const waiter of this.#floorQueue.splice(0)) {
      if (!this.#takesPart(waiter.agent)) waiter.wake('drop');
      else if (pending && !answering) waiter.wake('redraft');
      // Asked to think deeply: start over rather than use the held draft.
      else if (this.#deepRequested.has(waiter.agent)) waiter.wake('redraft');
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
        !this.#active.has(this.#pendingQuestion.agent)) ||
      (this.#handRaised && !this.#floorBusy);
    await this.#until(settled);
    if (this.#disposed) return;
    // Everyone passed: the user still gets one reply.
    if (!this.#spokeThisRound && !this.#pendingQuestion && !this.#handRaised) {
      this.#start(this.#quietest(), true);
      await this.#until(settled);
      if (this.#disposed) return;
    }
    if (this.#active.size === 0) await this.#rebuttals();
    // Held drafts point into recent messages, so only condense between them.
    if (this.#active.size === 0) await this.#compact();
    if (this.#disposed) return;

    if (this.#mode === 'paused') this.#resumeTo = 'awaiting-user';
    else this.#setMode('awaiting-user');
  }

  /**
   * Lets an agent challenged by name ("Blue, you're assuming...") answer
   * back, and so on, up to MAX_REBUTTALS times. The chain stops when the
   * challenged agent passes, nobody is addressed, or someone asks the user
   * to break the tie.
   */
  async #rebuttals(): Promise<void> {
    for (let exchange = 1; exchange <= MAX_REBUTTALS; exchange += 1) {
      if (this.#pendingQuestion || this.#handRaised) return;
      const last = this.bus.log.at(-1);
      if (last?.kind !== 'agent-message' || last.id <= this.#roundStartedAt) {
        return;
      }
      // Who the reply was aimed at: from its hidden first line, else from
      // a name it opens a sentence with.
      const target = [
        this.#answeredWhom.get(last.id),
        ...findAddressed(last.text, this.#agents),
      ].find(
        (id) => id !== undefined && id !== last.agent && this.#takesPart(id),
      );
      const agent = this.#agents.find((candidate) => candidate.id === target);
      if (!agent) return;
      if (!(await this.#rebut(agent, last.agent, exchange))) return;
    }
  }

  /** One rebuttal; resolves true if the agent spoke. */
  async #rebut(
    agent: AgentDefinition,
    challenger: AgentId,
    exchange: number,
  ): Promise<boolean> {
    this.#setAgent(agent.id, 'thinking');
    await this.#waitRunning();
    const challengerName =
      this.#agents.find((other) => other.id === challenger)?.name ?? challenger;
    let raw = '';
    try {
      for await (const chunk of this.#generate(agent.name, {
        kind: 'draft',
        system: agent.systemPrompt,
        prompt: rebuttalPrompt(
          this.#context(),
          challengerName,
          exchange,
          MAX_REBUTTALS,
          this.#temperatures.get(agent.id) ?? DEFAULT_TEMPERATURE,
          this.#angry,
        ),
        maxOutputTokens: REPLY_TOKENS,
      })) {
        raw += chunk;
        const reply = parseReply(raw, false);
        if (reply && reply.action !== 'speak') break;
      }
    } catch (error) {
      this.#notice = `${agent.name} could not respond: ${errorMessage(error)}`;
      this.#endTurn(agent.id, 'failed');
      return false;
    }

    const reply = parseReply(raw, true);
    if (reply?.action !== 'speak' || !reply.body) {
      this.#endTurn(agent.id, 'passed');
      return false;
    }
    await this.#waitForDisplay();
    // The user raised a hand (or paused) meanwhile: they go first, and a
    // rebuttal to an argument they cut off is not worth holding.
    if (this.#handRaised || this.#mode !== 'running') {
      this.#setAgent(agent.id, 'listening');
      return false;
    }
    this.#floorBusy = true;
    try {
      this.#commit(agent.id, reply.body, challenger);
    } finally {
      this.#releaseFloor();
    }
    return true;
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
    if (this.#mode !== 'running' || this.#handRaised) return false;
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
    let raw = '';
    let live = false;
    try {
      for await (const chunk of this.#generate(agent.name, {
        kind: 'draft',
        system: agent.systemPrompt,
        prompt: draftPrompt(this.#context(), {
          forced,
          angry: this.#angry,
          temperature: this.#temperatures.get(agent.id) ?? DEFAULT_TEMPERATURE,
          addressed: this.#mentioned.map(
            (id) => this.#agents.find((other) => other.id === id)?.name ?? id,
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
    if (this.#disposed) return 'done';
    // Still drafting from before a round that left this agent out.
    if (!this.#takesPart(agent.id)) {
      this.#setAgent(agent.id, 'listening');
      return 'done';
    }
    if (!live && heardUpTo <= this.#discardBefore) return 'stale';
    if (draft?.action === 'deep' && !deep) {
      return this.#deliberate(agent, forced, draft.body);
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

    return this.#deliver(agent, draft.body, draft.to, heardUpTo);
  }

  /**
   * Waits for the floor, reviews the draft against anything said since it
   * was written, and delivers it once everything before it has finished
   * showing. If the user raised a hand first, the reply is held for the next
   * round, where it is reviewed against what the user said.
   */
  async #deliver(
    agent: AgentDefinition,
    text: string,
    to: string | undefined,
    heardUpTo: number,
  ): Promise<'done' | 'stale'> {
    while (true) {
      this.#setAgent(agent.id, findQuestion(text) ? 'has-question' : 'waiting');
      const turn = await this.#takeFloor(agent.id);
      if (turn === 'redraft') return 'stale';
      if (turn === 'drop') {
        this.#setAgent(agent.id, 'listening');
        return 'done';
      }
      let held = false;
      try {
        if (this.bus.log.length !== heardUpTo) {
          const reviewed = await this.#review(agent, text, heardUpTo, to);
          if (!reviewed) return 'done';
          ({ text, to } = reviewed);
          heardUpTo = this.bus.log.length;
        }
        await this.#waitForDisplay();
        if (this.#handRaised) held = true;
        else this.#commit(agent.id, text, to);
      } finally {
        this.#releaseFloor();
      }
      if (!held) return 'done';
      this.#setAgent(agent.id, findQuestion(text) ? 'has-question' : 'waiting');
      await this.#until(() => !this.#handRaised && this.#mode === 'running');
      if (!this.#takesPart(agent.id)) {
        this.#setAgent(agent.id, 'listening');
        return 'done';
      }
    }
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
      const turn = await this.#takeFloor(agent.id);
      if (turn === 'redraft') return 'stale';
      if (turn === 'drop') {
        this.#setAgent(agent.id, 'listening');
        return 'done';
      }
      let held = false;
      try {
        await this.#waitForDisplay();
        if (this.#handRaised) held = true;
        else {
          this.#announce(
            agent.id,
            announcement || 'Let me think this one through properly.',
          );
        }
      } finally {
        this.#releaseFloor();
      }
      // The user took the floor first; reconsider after hearing them.
      if (held) {
        this.#setAgent(agent.id, 'waiting');
        await this.#until(() => !this.#handRaised && this.#mode === 'running');
        return 'stale';
      }
      return await this.#attempt(agent, forced, { announcement });
    } finally {
      this.#deepActive.delete(agent.id);
      this.#changed();
    }
  }

  /** A short message saying the agent is thinking something through. */
  #announce(agent: AgentId, text: string): void {
    if (this.#disposed) return;
    this.#showSpeech(agent, text);
    const event = this.bus.append({ kind: 'agent-message', agent, text });
    this.#lastSpoke.set(agent, event.id);
    this.#spokeThisRound = true;
    this.#speaking = undefined;
    this.#setAgent(agent, 'deliberating');
  }

  /**
   * Called while holding the floor: keep, revise, or drop a stale draft.
   * Returns what to say, or undefined if the agent withdrew or failed.
   */
  async #review(
    agent: AgentDefinition,
    draft: string,
    heardUpTo: number,
    draftTo: string | undefined,
  ): Promise<{ text: string; to: string | undefined } | undefined> {
    await this.#waitRunning();
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
          this.#temperatures.get(agent.id) ?? DEFAULT_TEMPERATURE,
          this.#angry,
        ),
        maxOutputTokens: REPLY_TOKENS,
      })) {
        raw += chunk;
        // KEEP and WITHDRAW are one word; stop as soon as one arrives.
        const reply = parseReply(raw, false);
        if (reply && reply.action !== 'revise' && reply.action !== 'speak') {
          break;
        }
      }
    } catch (error) {
      this.#notice = `${agent.name} could not respond: ${errorMessage(error)}`;
      this.#endTurn(agent.id, 'failed');
      return undefined;
    }

    const reply = parseReply(raw, true);
    if (reply?.action === 'keep') return { text: draft, to: draftTo };
    if (
      (reply?.action === 'revise' || reply?.action === 'speak') &&
      reply.body
    ) {
      return { text: reply.body, to: reply.to };
    }
    this.#endTurn(agent.id, 'withdrew');
    return undefined;
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

    await this.#waitRunning();
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
    const event = this.bus.append({ kind: 'agent-message', agent, text });
    const target = this.#agents.find(
      (other) => other.id === to || other.name.toLowerCase() === to,
    )?.id;
    if (target && target !== agent) this.#answeredWhom.set(event.id, target);
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

  #claimFloorNow(heardUpTo: number): boolean {
    if (
      this.#floorBusy ||
      this.#floorQueue.length ||
      this.#mode !== 'running' ||
      this.#pendingQuestion ||
      this.#handRaised ||
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
    if (this.#disposed) return Promise.resolve('drop');
    return new Promise((wake) => {
      this.#floorQueue.push({ agent, wake });
      this.#changed();
      this.#grantFloor();
    });
  }

  #grantFloor(): void {
    if (
      this.#disposed ||
      this.#floorBusy ||
      this.#mode !== 'running' ||
      this.#pendingQuestion ||
      this.#handRaised
    ) {
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
        // Gate and start atomically: another draft exhausting the budget must
        // not strand a reservation before its provider request even starts.
        while (true) {
          if (this.#mode !== 'running' || this.#pendingQuestion) {
            await this.#waitRunning();
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
          ...request,
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
    for (const waiter of this.#floorQueue.splice(0)) waiter.wake('drop');
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

function isTemperature(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
