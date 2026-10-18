export interface ModelRequest {
  /** Reviews and summaries can go to a cheaper model than drafts. */
  readonly kind: 'draft' | 'review' | 'summary';
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
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
