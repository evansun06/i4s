export interface PacerOptions {
  /** Display speed; 0 shows text as soon as it arrives. */
  readonly wordsPerMinute: number;
  /** Pause before an agent speaks right after another, like a beat to think. */
  readonly pauseBetweenSpeakersMs: number;
}

/** A reply being shown; update it as more text streams in. */
export interface Utterance {
  update(text: string): void;
  finish(): void;
}

type Item =
  | { readonly kind: 'line'; readonly text: string }
  | {
      readonly kind: 'speech';
      readonly label: string;
      readonly speaker: string | undefined;
      text: string;
      finished: boolean;
      wake?: (() => void) | undefined;
    };

// Average English word plus its space, for converting reading speed.
const CHARS_PER_WORD = 6;
// About one screen refresh.
const FRAME_MS = 16;

/**
 * Shows replies at reading speed, in order, however fast the model writes.
 * Display only: the engine keeps working ahead, which hides its latency.
 */
export class Pacer {
  readonly #write: (text: string) => void;
  readonly #options: PacerOptions;
  readonly #items: Item[] = [];
  readonly #idleWaiters: (() => void)[] = [];
  #running = false;
  #spokeLast = false;
  #showing: string | undefined;

  constructor(write: (text: string) => void, options: PacerOptions) {
    this.#write = write;
    this.#options = options;
  }

  /** A status line, shown in order after anything already queued. */
  line(text: string): void {
    this.#items.push({ kind: 'line', text });
    this.#run();
  }

  /** Who is on screen right now, which may trail the engine's speaker. */
  get showing(): string | undefined {
    return this.#showing;
  }

  speech(label: string, speaker?: string): Utterance {
    const item: Item & { kind: 'speech' } = {
      kind: 'speech',
      label,
      speaker,
      text: '',
      finished: false,
    };
    this.#items.push(item);
    this.#run();
    const wake = () => {
      item.wake?.();
      item.wake = undefined;
    };
    return {
      update: (text) => {
        item.text = text;
        wake();
      },
      finish: () => {
        item.finished = true;
        wake();
      },
    };
  }

  /** The next speaker is the first since the user spoke, so no pause. */
  newRound(): void {
    this.#spokeLast = false;
  }

  /** Resolves once everything queued has been shown. */
  idle(): Promise<void> {
    if (!this.#running) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  #run(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#drain().finally(() => {
      this.#running = false;
      // Something may have been queued after the loop's last check.
      if (this.#items.length) this.#run();
      else for (const resolve of this.#idleWaiters.splice(0)) resolve();
    });
  }

  async #drain(): Promise<void> {
    for (let item = this.#items[0]; item; item = this.#items[0]) {
      if (item.kind === 'line') {
        this.#write(item.text);
      } else {
        if (this.#spokeLast) await sleep(this.#options.pauseBetweenSpeakersMs);
        await this.#speak(item);
        this.#spokeLast = true;
      }
      this.#items.shift();
    }
  }

  async #speak(item: Item & { kind: 'speech' }): Promise<void> {
    const charsPerSecond = (this.#options.wordsPerMinute * CHARS_PER_WORD) / 60;
    this.#showing = item.speaker;
    this.#write(item.label);
    let shown = 0;
    // Letter by letter. Timers cannot fire once per letter reliably, so each
    // frame shows however many letters are due by the clock.
    let due = 1;
    let last = Date.now();
    const maxPerFrame = Math.max(1, (charsPerSecond * FRAME_MS * 2) / 1000);
    while (true) {
      if (shown < item.text.length) {
        if (charsPerSecond <= 0) {
          this.#write(item.text.slice(shown));
          shown = item.text.length;
          continue;
        }
        const now = Date.now();
        due = Math.min(
          due + ((now - last) / 1000) * charsPerSecond,
          maxPerFrame,
        );
        last = now;
        const count = Math.min(Math.floor(due), item.text.length - shown);
        if (count > 0) {
          this.#write(item.text.slice(shown, shown + count));
          shown += count;
          due -= count;
        }
        await sleep(FRAME_MS);
      } else if (item.finished) {
        break;
      } else {
        await new Promise<void>((resolve) => (item.wake = resolve));
        // Waiting for the model is not reading time; don't burst after it.
        last = Date.now();
      }
    }
    this.#write('\n\n');
    this.#showing = undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}
