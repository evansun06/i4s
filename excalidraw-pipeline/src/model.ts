import type { ModelProvider, ModelRequest } from './provider.js';

/** One generation, with no retry or repair loop. Suitable for fake providers. */
export async function generateStructured(
  provider: ModelProvider,
  request: ModelRequest,
): Promise<string> {
  let raw = '';
  for await (const chunk of provider.generate(request)) raw += chunk;
  return raw;
}
