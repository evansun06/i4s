export interface ModelRequest {
  readonly signal?: AbortSignal;
  /** Reviews and summaries can go to a cheaper model than drafts. */
  readonly kind: 'draft' | 'review' | 'summary';
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  /** Ask for the model's deepest reasoning; otherwise the provider default. */
  readonly effort?: 'high';
}

/** Token counts the provider reported for one completed call. */
export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Input tokens billed at a cached rate, when the provider says. */
  readonly cachedInputTokens?: number;
  /** Output tokens spent on hidden reasoning, when the provider says. */
  readonly reasoningTokens?: number;
}

/** Opt-in measurement; adapters ask for usage data only when it is set. */
export type UsageListener = (request: ModelRequest, usage: ModelUsage) => void;

/** Thrown before any output when the provider asks us to slow down. */
export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** Provider-agnostic model access. Adapters stream plain text chunks. */
export interface ModelProvider {
  generate(request: ModelRequest): AsyncIterable<string>;
}
