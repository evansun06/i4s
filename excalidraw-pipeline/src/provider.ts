import type { Schema } from './contracts.js';
import { modelWireSchema } from './wireSchema.js';

export interface ModelRequest {
  readonly kind: 'extract' | 'decision' | 'implementation' | 'presentation';
  readonly system: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  readonly schema: Schema;
}

export interface ModelProvider {
  generate(request: ModelRequest): AsyncIterable<string>;
}

/** Isolated adapter: no dependency on the application's provider or credentials. */
export class OpenAICompatibleProvider implements ModelProvider {
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      onRequest?: (kind: ModelRequest['kind']) => void;
      onComplete?: (measurement: ModelMeasurement) => void;
    },
  ) {}

  async *generate(request: ModelRequest): AsyncIterable<string> {
    const started = performance.now();
    const measurement: ModelMeasurement = { kind: request.kind, elapsedMs: 0 };
    try {
      this.options.onRequest?.(request.kind);
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          signal: AbortSignal.timeout(300_000),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.options.apiKey}`,
          },
          body: JSON.stringify({
            model: this.options.model,
            stream: false,
            max_completion_tokens: request.maxOutputTokens,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: request.kind,
                strict: true,
                schema: modelWireSchema(request.schema),
              },
            },
            reasoning_effort: 'low',
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.prompt },
            ],
          }),
        },
      );
      measurement.httpStatus = response.status;
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? `Model request failed (HTTP ${response.status}). Check model access and OPENAI_API_KEY.`
            : `Model request failed (HTTP ${response.status}). Check request/schema limits and model availability.`,
        );
      const body: unknown = await response.json();
      const completion = body as {
        choices?: { finish_reason?: string; message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      for (const [key, value] of Object.entries(completion.usage ?? {})) {
        if (
          typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value >= 0
        ) {
          if (key === 'prompt_tokens') measurement.inputTokens = value;
          if (key === 'completion_tokens') measurement.outputTokens = value;
        }
      }
      const choice = completion.choices?.[0];
      if (
        choice?.finish_reason !== 'stop' ||
        typeof choice.message?.content !== 'string'
      )
        throw new Error(
          'Model response was incomplete or did not contain text.',
        );
      yield choice.message.content;
    } finally {
      measurement.elapsedMs = Math.round(performance.now() - started);
      this.options.onComplete?.(measurement);
    }
  }
}

export interface ModelMeasurement {
  kind: ModelRequest['kind'];
  elapsedMs: number;
  httpStatus?: number;
  inputTokens?: number;
  outputTokens?: number;
}
