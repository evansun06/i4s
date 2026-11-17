import {
  RateLimitError,
  type ModelProvider,
  type ModelRequest,
  type ModelUsage,
} from '../providers/model.js';

/** One model call as the evaluation saw it. Token fields are provider-reported. */
export interface CallRecord {
  /** The request kind, or the harness role (`synthesis`, `judge`). */
  readonly kind: string;
  /** Who made the call: an agent id, `summarizer`, or the harness role. */
  readonly caller: string;
  /** Milliseconds after the measured provider was created. */
  readonly startedAtMs: number;
  /** Until the caller stopped reading (a PASS is read only to its header). */
  readonly elapsedMs: number;
  /**
   * `rate-limited`: a transient limit the room waits out and retries; the
   * retry is recorded as its own attempt. Out-of-credit errors are `error`.
   */
  readonly outcome: 'ok' | 'aborted' | 'rate-limited' | 'error';
  readonly error?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
}

export type ProviderFactory = (
  onUsage: (request: ModelRequest, usage: ModelUsage) => void,
) => ModelProvider;

/**
 * Wraps a provider so every call is timed and paired with the token usage
 * the provider reports for it. Nothing is estimated: a call whose usage never
 * arrives (an aborted or failed stream) is recorded without token counts.
 *
 * The room stops reading a reply once its header says PASS or KEEP. Usage
 * arrives at the end of the stream, so the rest is read in the background;
 * `settled()` waits for those records.
 */
export class MeasuredProvider implements ModelProvider {
  readonly calls: CallRecord[] = [];
  readonly #inner: ModelProvider;
  readonly #usage = new WeakMap<ModelRequest, ModelUsage>();
  readonly #pending = new Set<Promise<void>>();
  readonly #callerOf: (request: ModelRequest) => string;
  readonly #origin = performance.now();
  readonly #onError: ((message: string) => void) | undefined;

  /** `onError` hears about every call that failed for a non-transient reason. */
  constructor(
    factory: ProviderFactory,
    callerOf: (request: ModelRequest) => string,
    onError?: (message: string) => void,
  ) {
    this.#inner = factory((request, usage) => this.#usage.set(request, usage));
    this.#callerOf = callerOf;
    this.#onError = onError;
  }

  /** A whole call made by the harness itself, recorded under `label`. */
  async complete(label: string, request: ModelRequest): Promise<string> {
    let text = '';
    for await (const chunk of this.#run(request, label)) text += chunk;
    await this.settled();
    return text;
  }

  generate(request: ModelRequest): AsyncIterable<string> {
    return this.#run(request);
  }

  /** Resolves once every call, including background reads, is recorded. */
  async settled(): Promise<void> {
    while (this.#pending.size) await Promise.all(this.#pending);
  }

  async *#run(request: ModelRequest, label?: string): AsyncIterable<string> {
    const started = performance.now();
    const iterator = this.#inner.generate(request)[Symbol.asyncIterator]();
    let elapsedMs = 0;
    let finished = false;
    const record = (outcome: CallRecord['outcome'], error?: unknown) => {
      if (outcome === 'error') this.#onError?.(describe(error));
      this.calls.push({
        kind: label ?? request.kind,
        caller: label ?? this.#callerOf(request),
        startedAtMs: Math.round(started - this.#origin),
        elapsedMs,
        outcome,
        ...(error !== undefined && { error: describe(error) }),
        ...this.#usage.get(request),
      });
    };
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        yield next.value;
      }
      finished = true;
      elapsedMs = Math.round(performance.now() - started);
      record('ok');
    } catch (error) {
      finished = true;
      elapsedMs = Math.round(performance.now() - started);
      record(failure(request, error), error);
      throw error;
    } finally {
      if (!finished) {
        // The caller stopped early; read on for the usage report.
        elapsedMs = Math.round(performance.now() - started);
        const drain = (async () => {
          try {
            while (!(await iterator.next()).done) {
              // Discard the unread text.
            }
            record('ok');
          } catch (error) {
            record(failure(request, error), error);
          }
        })();
        this.#pending.add(drain);
        void drain.finally(() => this.#pending.delete(drain));
      }
    }
  }
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : JSON.stringify(error);

/** True for provider errors no retry can fix, such as an empty balance. */
export function isFatal(message: string): boolean {
  return /credit|quota|billing|api key/i.test(message);
}

function failure(request: ModelRequest, error: unknown): CallRecord['outcome'] {
  if (request.signal?.aborted) return 'aborted';
  if (error instanceof RateLimitError && !isFatal(error.message))
    return 'rate-limited';
  return 'error';
}
