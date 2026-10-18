import { agentIds, identities } from '../agents/identity.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { AgentId, RoomSnapshot } from '../core/types.js';
import { helpText, parseCommand } from './commands.js';
import { Pacer, type Utterance } from './pacer.js';

export interface ChatMessage {
  readonly key: number;
  readonly speaker: AgentId | 'user' | 'system';
  text: string;
  eventId?: number;
  complete: boolean;
  failed?: boolean;
}

export interface PendingInput {
  readonly text: string;
  readonly answer: boolean;
  readonly questionId?: number;
  readonly deep?: readonly AgentId[];
}

export interface PresentationSnapshot {
  readonly room: RoomSnapshot;
  readonly messages: readonly ChatMessage[];
  readonly queued: readonly PendingInput[];
  readonly displaying: AgentId | undefined;
  readonly activeKey: number | undefined;
  readonly waiting: readonly AgentId[];
  readonly question: RoomSnapshot['pendingQuestion'];
  readonly closing: boolean;
}

export class ChatController {
  readonly #listeners = new Set<() => void>();
  readonly #messages: ChatMessage[] = [];
  readonly #queue: PendingInput[] = [];
  readonly #pacer: Pacer;
  readonly #unsubscribe: (() => void)[];
  readonly #save: () => Promise<void>;
  #saveChain = Promise.resolve();
  #batch = false;
  #closing = false;
  #key = 0;
  #active: ChatMessage | undefined;
  #stream:
    { agent: AgentId; message: ChatMessage; utterance: Utterance } | undefined;
  #snapshot: PresentationSnapshot | undefined;
  #notice: string | undefined;
  #lastTurn: RoomSnapshot['lastTurn'];
  #drainScheduled = false;
  readonly #playback = new Set<ChatMessage>();

  constructor(
    readonly engine: Orchestrator,
    options: {
      wordsPerMinute: number;
      save?: () => Promise<void>;
    },
  ) {
    this.#save = options.save ?? (() => Promise.resolve());
    this.#pacer = new Pacer(() => {}, {
      wordsPerMinute: options.wordsPerMinute,
      pauseBetweenSpeakersMs: options.wordsPerMinute ? 1000 : 0,
    });
    for (const event of engine.bus.log) {
      this.#messages.push({
        key: this.#key++,
        speaker: event.kind === 'user-message' ? 'user' : event.agent,
        text: event.text,
        eventId: event.id,
        complete: true,
      });
    }
    this.#unsubscribe = [
      engine.subscribe(() => this.#sync()),
      engine.bus.subscribe((event) => {
        if (event.kind === 'user-message') {
          this.#messages.push({
            key: this.#key++,
            speaker: 'user',
            text: event.text,
            eventId: event.id,
            complete: true,
          });
        } else {
          this.#speech(event.agent, event.text);
          if (this.#stream) this.#stream.message.eventId = event.id;
        }
        this.#changed();
      }),
    ];
    this.#sync();
  }

  snapshot = (): PresentationSnapshot => {
    const room = this.engine.snapshot();
    const question = room.pendingQuestion;
    this.#snapshot ??= {
      room,
      messages: this.#messages.map((message) => ({ ...message })),
      queued: [...this.#queue],
      displaying: this.#active?.speaker as AgentId | undefined,
      activeKey: this.#active?.key,
      waiting: [...this.#playback]
        .filter((message) => message !== this.#active)
        .map((message) => message.speaker as AgentId),
      question:
        question &&
        this.#messages.some(
          (message) => message.eventId === question.eventId && message.complete,
        )
          ? question
          : undefined,
      closing: this.#closing,
    };
    return this.#snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #changed(): void {
    this.#snapshot = undefined;
    for (const listener of this.#listeners) listener();
  }

  #sync(): void {
    if (this.#closing) return;
    const room = this.engine.snapshot();
    this.#pacer.setPaused(room.mode === 'paused');
    if (room.speaking) this.#speech(room.speaking.agent, room.speaking.text);
    else this.#finishStream();
    if (room.notice && room.notice !== this.#notice) this.#system(room.notice);
    this.#notice = room.notice;
    if (
      room.lastTurn !== this.#lastTurn &&
      room.lastTurn?.result === 'withdrew'
    ) {
      this.#system(
        `${identities[room.lastTurn.agent].name} withdrew a reply already covered.`,
      );
    }
    this.#lastTurn = room.lastTurn;
    this.#changed();
    this.#scheduleDrain();
  }

  #speech(agent: AgentId, text: string): void {
    if (this.#stream?.agent !== agent) {
      this.#finishStream();
      const message: ChatMessage = {
        key: this.#key++,
        speaker: agent,
        text: '',
        complete: false,
      };
      this.#playback.add(message);
      // Add only when playback begins, keeping unseen replies out of the feed.
      const utterance = this.#pacer.speech('', {
        start: () => {
          this.#active = message;
          this.#messages.push(message);
          this.#changed();
        },
        text: (shown) => {
          message.text = shown;
          this.#changed();
        },
        finish: () => {
          message.complete = true;
          this.#playback.delete(message);
          if (this.#active === message) this.#active = undefined;
          this.#changed();
          this.#scheduleDrain();
        },
      });
      this.#stream = { agent, message, utterance };
    }
    this.#stream.utterance.update(text);
  }

  #finishStream(): void {
    if (!this.#stream) return;
    if (this.#stream.message.eventId === undefined)
      this.#stream.message.failed = true;
    this.#stream.utterance.finish();
    this.#stream = undefined;
  }

  #system(text: string): void {
    this.#messages.push({
      key: this.#key++,
      speaker: 'system',
      text,
      complete: true,
    });
    this.#changed();
  }

  /** Returns true only for /quit; the caller owns terminal teardown. */
  accept(input: string): boolean {
    if (this.#closing || !input.trim()) return false;
    const command = parseCommand(input);
    switch (command.kind) {
      case 'quit':
        return true;
      case 'error':
        this.#system(command.text);
        break;
      case 'help':
        this.#system(helpText);
        break;
      case 'pause':
        this.engine.pause();
        break;
      case 'resume':
        if (!this.engine.resume())
          this.#system('Add calls with /budget <calls>, then /resume.');
        break;
      case 'budget':
        try {
          this.engine.raiseCallLimit(command.by);
          this.#system(`Added ${command.by} calls. Use /resume if paused.`);
        } catch (error) {
          this.#system(
            error instanceof Error ? error.message : 'Could not change budget.',
          );
        }
        break;
      case 'temp':
        for (const setting of command.settings)
          this.engine.setTemperature(setting.target, setting.value);
        this.#system(
          agentIds
            .map(
              (id) =>
                `${identities[id].name} ${this.engine.snapshot().temperatures[id].toFixed(1)}`,
            )
            .join(' · '),
        );
        if (command.settings.length) void this.#persist();
        break;
      case 'queue':
        this.#system(
          this.#queue.length
            ? this.#queue.map((item, i) => `${i + 1}. ${item.text}`).join('\n')
            : 'No queued messages.',
        );
        break;
      case 'unqueue': {
        const removed = this.#queue.pop();
        this.#system(
          removed
            ? `Removed from queue: ${removed.text}`
            : 'No queued messages.',
        );
        break;
      }
      case 'message': {
        // Only an already-visible question can be answered by this submission.
        const question = this.snapshot().question;
        this.#queue.push({
          text: command.text,
          answer: command.answer,
          ...(question && { questionId: question.eventId }),
          ...(command.deep && { deep: command.deep }),
        });
        break;
      }
    }
    this.#changed();
    this.#scheduleDrain();
    return false;
  }

  #scheduleDrain(): void {
    if (this.#drainScheduled || this.#closing) return;
    this.#drainScheduled = true;
    void this.#pacer.idle().then(() => {
      this.#drainScheduled = false;
      return this.#drain();
    });
  }

  async #drain(): Promise<void> {
    if (this.#closing || this.#batch) return;
    const room = this.engine.snapshot();
    if (room.mode !== 'initial-prompt' && room.mode !== 'awaiting-user') return;
    const pending = room.pendingQuestion;
    const index = pending
      ? this.#queue.findIndex((item) => item.questionId === pending.eventId)
      : 0;
    if (index < 0 || !this.#queue[index]) return;
    const item = this.#queue.splice(index, 1)[0]!;
    this.#batch = true;
    this.#pacer.newRound();
    this.#changed();
    try {
      await this.engine.submit(item.text, {
        answer: item.answer && item.questionId === pending?.eventId,
        ...(item.deep && { deep: item.deep }),
      });
      if (!this.#closing) await this.#persist();
    } catch (error) {
      if (!this.#closing)
        this.#system(
          error instanceof Error
            ? error.message
            : 'The discussion could not continue.',
        );
    } finally {
      this.#batch = false;
      this.#changed();
      this.#scheduleDrain();
    }
  }

  #persist(): Promise<void> {
    this.#saveChain = this.#saveChain
      .then(this.#save)
      .catch((error: unknown) => {
        this.#system(
          `Could not save: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      });
    return this.#saveChain;
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.engine.dispose();
    this.#pacer.dispose();
    this.#changed();
    await this.#saveChain;
    await this.#save();
    this.#listeners.clear();
  }
}
