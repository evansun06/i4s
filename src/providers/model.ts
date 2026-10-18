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
