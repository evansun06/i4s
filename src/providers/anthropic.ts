import Anthropic from '@anthropic-ai/sdk';
import {
  RateLimitError,
  type ModelProvider,
  type ModelRequest,
} from './model.js';

export interface AnthropicOptions {
  readonly apiKey: string;
  readonly models: Readonly<Record<ModelRequest['kind'], string>>;
}

/** Claude through the official SDK; the orchestrator owns retry scheduling. */
export class AnthropicProvider implements ModelProvider {
  readonly #client: Anthropic;
  readonly #models: AnthropicOptions['models'];

  constructor(options: AnthropicOptions) {
    this.#client = new Anthropic({ apiKey: options.apiKey, maxRetries: 0 });
    this.#models = options.models;
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
