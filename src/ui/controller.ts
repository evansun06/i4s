import { aboutText, agentIds, identities } from '../agents/identity.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { AgentId, RoomSnapshot } from '../core/types.js';
import { helpText, parseCommand } from './commands.js';
import { messageText } from './message-text.js';
import { Pacer, type Utterance } from './pacer.js';
import {
  DRAW_CALL_LIMIT,
  type DrawPipeline,
  type DrawingResult,
} from '../drawing/maps.js';

export type DrawingState =
  | { readonly status: 'running'; readonly message: string }
  | { readonly status: 'ready'; readonly result: DrawingResult }
  | { readonly status: 'failed'; readonly message: string };

export interface ChatMessage {
  readonly key: number;
  /** korg: drawing results, from the drawing character. */
  readonly speaker: AgentId | 'user' | 'system' | 'korg';
  text: string;
  eventId?: number;
  complete: boolean;
  failed?: boolean;
  readonly link?: { readonly label: string; readonly url: string };
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
  readonly drawing?: DrawingState;
  /** Playback speed; 0 shows replies instantly. */
  readonly wordsPerMinute: number;
}

export const READING_SPEED = { step: 40, min: 100, max: 1000 } as const;

/**
 * The next reading speed one step slower (-1) or faster (+1), within
 * READING_SPEED's range. Instant playback (0) counts as faster than the max.
 */
export function nextReadingSpeed(current: number, direction: 1 | -1): number {
  const { step, min, max } = READING_SPEED;
  if (current === 0) return direction > 0 ? 0 : max;
  return Math.max(min, Math.min(max, current + direction * step));
}

export class ChatController {
  readonly #listeners = new Set<() => void>();
  readonly #messages: ChatMessage[] = [];
  readonly #queue: PendingInput[] = [];
  readonly #pacer: Pacer;
  readonly #unsubscribe: (() => void)[];
  readonly #save: () => Promise<void>;
  readonly #draw: DrawPipeline | undefined;
  #drawing: DrawingState | undefined;
  #drawAbort: AbortController | undefined;
  #drawTask: Promise<void> | undefined;
  #saveChain = Promise.resolve();
  #batch = false;
  #closing = false;
  #key = 0;
  #active: ChatMessage | undefined;
  #stream:
    | {
        agent: AgentId;
        message: ChatMessage;
        utterance: Utterance;
        raw: string;
        /** Interrupted before it was said: keep only what was shown. */
        cut?: boolean;
      }
    | undefined;
  #snapshot: PresentationSnapshot | undefined;
  #notice: string | undefined;
  #drainScheduled = false;
  readonly #playback = new Set<ChatMessage>();

  constructor(
    readonly engine: Orchestrator,
    options: {
      wordsPerMinute: number;
      save?: () => Promise<void>;
      draw?: DrawPipeline;
    },
  ) {
    this.#save = options.save ?? (() => Promise.resolve());
    this.#draw = options.draw;
    this.#pacer = new Pacer(() => {}, {
      wordsPerMinute: options.wordsPerMinute,
      pauseBetweenSpeakersMs: options.wordsPerMinute ? 1000 : 0,
    });
    engine.setDisplayGate(() => this.#pacer.idle());
    for (const event of engine.bus.log) {
      this.#messages.push({
        key: this.#key++,
        speaker: event.kind === 'user-message' ? 'user' : event.agent,
        text:
          event.kind === 'agent-message'
            ? messageText(event.text, true)
            : event.text,
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
      ...(this.#drawing && { drawing: this.#drawing }),
      wordsPerMinute: this.#pacer.wordsPerMinute,
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
      this.#stream = { agent, message, utterance, raw: text };
    }
    if (this.#stream.cut) return;
    this.#stream.raw = text;
    this.#stream.utterance.update(messageText(text));
  }

  #finishStream(): void {
    if (!this.#stream) return;
    if (this.#stream.message.eventId === undefined)
      this.#stream.message.failed = true;
    this.#stream.utterance.update(
      this.#stream.cut
        ? this.#stream.message.text
        : messageText(this.#stream.raw, true),
    );
    this.#stream.utterance.finish();
    this.#stream = undefined;
  }

  #system(
    text: string,
    speaker: 'system' | 'korg' = 'system',
    link?: ChatMessage['link'],
  ): void {
    this.#messages.push({
      key: this.#key++,
      speaker,
      text,
      complete: true,
      ...(link ? { link } : {}),
    });
    this.#changed();
  }

  /**
   * One step slower (-1) or faster (+1). Works any time, including while
   * someone is speaking; returns the new words per minute.
   */
  adjustReadingSpeed(direction: 1 | -1): number {
    const next = nextReadingSpeed(this.#pacer.wordsPerMinute, direction);
    this.#pacer.setWordsPerMinute(next);
    this.#changed();
    return next;
  }

  /**
   * Esc: stop the discussion now and hand the floor to the user. A reply
   * not yet said is cut where it stands; replies already said appear in full
   * at once. Returns false if nothing was going on.
   */
  interrupt(): boolean {
    if (this.#closing) return false;
    // While Korg draws, Esc cancels the drawing and discards its maps.
    if (this.#drawing?.status === 'running') {
      this.#drawAbort?.abort();
      return true;
    }
    if (this.#stream && this.#stream.message.eventId === undefined) {
      this.#stream.cut = true;
      this.#stream.utterance.update(this.#stream.message.text);
    }
    const stopped = this.engine.interrupt();
    const playing = this.#playback.size > 0;
    this.#pacer.skip();
    this.#changed();
    return stopped || playing;
  }

  /** Reserve the next turn without submitting or changing the editor. */
  raiseHand(): boolean {
    return !this.#closing && this.engine.raiseHand();
  }

  /**
   * Returns where the user is going when the input leaves the chat (/quit or
   * /lobby), else false. The caller closes the controller and the screen.
   */
  accept(input: string): 'quit' | 'lobby' | false {
    if (this.#closing || !input.trim()) return false;
    const command = parseCommand(input);
    switch (command.kind) {
      case 'quit':
      case 'lobby':
        return command.kind;
      case 'error':
        this.#system(command.text);
        break;
      case 'help':
        this.#system(helpText);
        break;
      case 'about':
        this.#system(
          aboutText(command.agents.length ? command.agents : undefined),
        );
        break;
      case 'pause':
        this.engine.pause();
        break;
      case 'resume':
        if (this.#drawTask) {
          this.#system(
            'Maps are still generating. The room stays paused until drawing finishes.',
          );
          break;
        }
        if (!this.engine.resume())
          this.#system('Add calls with /budget <calls>, then /resume.');
        break;
      case 'draw':
        this.#startDrawing();
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
        this.engine.raiseHand();
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

  dismissDrawing(): void {
    if (this.#drawing?.status !== 'ready') return;
    this.#drawing = undefined;
    this.#changed();
  }

  #startDrawing(): void {
    if (this.#drawTask) {
      this.#system('Maps are already generating; no second run was started.');
      return;
    }
    const draw = this.#draw;
    if (!draw) {
      this.#system('Drawing is not configured for this session.');
      return;
    }
    if (!this.engine.bus.log.some((event) => event.kind === 'user-message')) {
      this.#system('Start a conversation before using /draw.');
      return;
    }
    this.#drawing = {
      status: 'running',
      message: 'Saving the current conversation…',
    };
    this.engine.pause({ freezeCurrent: true });
    const abort = new AbortController();
    this.#drawAbort = abort;
    this.#drawTask = Promise.resolve().then(async () => {
      let reservation:
        ReturnType<Orchestrator['reserveExternalCalls']> | undefined;
      try {
        reservation = this.engine.reserveExternalCalls(DRAW_CALL_LIMIT);
        await this.#persist(true);
        abort.signal.throwIfAborted();
        const result = await draw({
          signal: abort.signal,
          onCall: reservation.recordCall,
          onProgress: (message) => {
            if (this.#closing) return;
            this.#drawing = { status: 'running', message };
            this.#changed();
          },
        });
        if (!this.#closing) {
          this.#drawing = { status: 'ready', result };
          this.#system(
            `Maps saved: ${result.filePath}\nThe room remains paused. /resume continues the discussion.`,
            'korg',
            {
              label: 'Go online to edit',
              url: result.editUrl ?? 'https://excalidraw.com',
            },
          );
        }
      } catch (error) {
        if (this.#closing) {
          // Quitting: nothing to report.
        } else if (abort.signal.aborted) {
          // Esc: the maps are discarded.
          this.#drawing = undefined;
          this.#system(
            'Drawing cancelled. The room remains paused; /resume continues.',
            'korg',
          );
        } else {
          const message =
            error instanceof Error ? error.message : 'Drawing failed.';
          this.#drawing = { status: 'failed', message };
          this.#system(
            `${message}\nThe room remains paused. Use /draw to retry or /resume to continue.`,
            'korg',
          );
        }
      } finally {
        reservation?.release();
        this.#drawTask = undefined;
        this.#drawAbort = undefined;
        this.#changed();
      }
    });
    this.#changed();
  }

  async #drain(): Promise<void> {
    if (this.#closing || this.#batch) return;
    const room = this.engine.snapshot();
    if (room.mode !== 'initial-prompt' && room.mode !== 'awaiting-user') return;
    const pending = room.pendingQuestion;
    const answerIndex = pending
      ? this.#queue.findIndex((item) => item.questionId === pending.eventId)
      : -1;
    const index = answerIndex >= 0 ? answerIndex : 0;
    if (index < 0 || !this.#queue[index]) return;
    const item = this.#queue.splice(index, 1)[0]!;
    this.#batch = true;
    this.#pacer.newRound();
    this.#changed();
    try {
      const exchange = this.engine.submit(item.text, {
        answer: item.answer && item.questionId === pending?.eventId,
        ...(item.deep && { deep: item.deep }),
      });
      if (this.#queue.length) this.engine.raiseHand();
      await exchange;
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

  #persist(strict = false): Promise<void> {
    const operation = this.#saveChain.then(this.#save);
    this.#saveChain = operation.catch((error: unknown) => {
      this.#system(
        `Could not save: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
    return strict ? operation : this.#saveChain;
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    this.#drawAbort?.abort();
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.engine.dispose();
    this.#pacer.dispose();
    this.#changed();
    await this.#drawTask;
    await this.#draw?.close?.();
    await this.#saveChain;
    await this.#save();
    this.#listeners.clear();
  }
}
