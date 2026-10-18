import {
  RateLimitError,
  type ModelProvider,
  type ModelRequest,
} from './model.js';

export interface OpenAICompatibleOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly models: Readonly<Record<ModelRequest['kind'], string>>;
  /** Newer OpenAI models reject `max_tokens`. */
  readonly maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /** Provider-specific request fields, such as a reasoning effort. */
  readonly extraBody?: Readonly<Record<string, unknown>>;
}

/** Streams `/chat/completions`, which most providers and local servers accept. */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly #options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.#options = options;
  }

  async *generate(request: ModelRequest): AsyncIterable<string> {
    const { baseUrl, apiKey, models, maxTokensField, extraBody } =
      this.#options;
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: models[request.kind],
          stream: true,
          [maxTokensField]: request.maxOutputTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          ...extraBody,
        }),
      },
    );
    if (!response.ok || !response.body) {
      const message = await describeFailure(response);
      if (response.status === 429) {
        throw new RateLimitError(message, retryAfter(response, message));
      }
      throw new Error(message);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of response.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.trim();
        if (!data.startsWith('data:')) continue;
        const payload = data.slice(5).trim();
        if (payload === '[DONE]') return;
        const chunk = JSON.parse(payload) as {
          choices?: { delta?: { content?: string | null } }[];
        };
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    }
  }
}

/** From the Retry-After header, or Gemini's "Please retry in 15.8s". */
function retryAfter(response: Response, message: string): number | undefined {
  const header = Number(response.headers.get('retry-after'));
  if (header > 0) return header;
  const hint = /retry in ([\d.]+)s/i.exec(message)?.[1];
  return hint ? Number(hint) : undefined;
}

async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return 'The provider rejected the API key. Restart and choose "Add or change an API key".';
  }
  let detail = '';
  try {
    const body = (await response.json()) as
      { error?: { message?: string } } | { error?: { message?: string } }[];
    detail = (Array.isArray(body) ? body[0] : body)?.error?.message ?? '';
  } catch {
    // Not JSON; the status code is enough.
  }
  return `Provider returned ${response.status}${detail ? `: ${detail}` : ''}`;
}
