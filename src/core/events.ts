import type { LogEntry, LogEvent } from './types.js';

/** Append-only shared log. Agents "listen" by reading it when they next call a model. */
export class EventBus {
  readonly #log: LogEvent[];
  readonly #listeners = new Set<(event: LogEvent) => void>();

  /** Starts from `saved` events, such as a continued discussion. */
  constructor(saved: readonly LogEntry[] = []) {
    this.#log = saved.map((entry, id) => ({ ...entry, id }));
  }

  get log(): readonly LogEvent[] {
    return this.#log;
  }

  append(entry: LogEntry): LogEvent {
    const event = { ...entry, id: this.#log.length };
    this.#log.push(event);
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  subscribe(listener: (event: LogEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
