import Anthropic from '@anthropic-ai/sdk';
import {
  RateLimitError,
  type ModelProvider,
  type ModelRequest,
  type UsageListener,
} from './model.js';

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly models: Readonly<Record<ModelRequest['kind'], string>>;
  /** Reports each call's token counts. */
  readonly onUsage?: UsageListener;
}

/** Claude through the official SDK; the orchestrator owns retry scheduling. */
export class AnthropicProvider implements ModelProvider {
  readonly #client: Anthropic;
  readonly #models: AnthropicOptions['models'];
  readonly #onUsage: UsageListener | undefined;

  constructor(options: AnthropicOptions) {
    this.#client = new Anthropic({ apiKey: options.apiKey, maxRetries: 0 });
    this.#models = options.models;
    this.#onUsage = options.onUsage;
  }

  async *generate(request: ModelRequest): AsyncIterable<string> {
    const model = this.#models[request.kind];
    try {
      const stream = this.#client.beta.messages.stream(
        {
          model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          // Short conversational turns; low effort keeps replies quick unless
          // the agent asked to think it through.
          output_config: { effort: request.effort ?? 'low' },
          // If a safety classifier declines, retry on Anthropic's recommended
          // fallback model. Haiku has no server-side fallback.
          ...(!model.startsWith('claude-haiku') && {
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default' as const,
          }),
        },
        { ...(request.signal && { signal: request.signal }) },
      );
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
      }
      const message = await stream.finalMessage();
      const { usage } = message;
      // Anthropic counts cached input separately from input_tokens.
      const cached =
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      this.#onUsage?.(request, {
        inputTokens: usage.input_tokens + cached,
        outputTokens: usage.output_tokens,
        cachedInputTokens: usage.cache_read_input_tokens ?? 0,
      });
      if (message.stop_reason === 'refusal') {
        throw new Error(`${model} declined to respond to this message.`);
      }
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        const seconds = Number(error.headers.get('retry-after'));
        throw new RateLimitError(
          error.message,
          seconds > 0 ? seconds : undefined,
        );
      }
      if (error instanceof Anthropic.AuthenticationError) {
        throw new Error(
          'The provider rejected the API key. Restart and choose "Add or change an API key".',
        );
      }
      throw error;
    }
  }
}
