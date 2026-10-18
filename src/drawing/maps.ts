export interface TerminalCard {
  readonly id: string;
  readonly label: string;
  readonly body: readonly string[];
  readonly status: string;
  readonly note: boolean;
}
export interface TerminalMap {
  readonly name: 'decision' | 'implementation';
  readonly heading: string;
  readonly cards: readonly TerminalCard[];
  readonly edges: readonly {
    source: string;
    target: string;
    label: string;
    kind: string;
  }[];
}
export interface DrawingResult {
  readonly directory: string;
  readonly filePath: string;
  readonly editUrl?: string;
}
export interface DrawRequest {
  readonly signal: AbortSignal;
  readonly onProgress: (message: string) => void;
  readonly onCall: () => void;
}
export type DrawPipeline = {
  (request: DrawRequest): Promise<DrawingResult>;
  close?: () => Promise<void>;
};
export const DRAW_CALL_LIMIT = 6;

/** Validate the subprocess boundary before rendering any data in the terminal. */
export function parseTerminalMaps(value: unknown): readonly TerminalMap[] {
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.maps) ||
    value.maps.length !== 2
  )
    throw new Error('Invalid terminal map output.');
  for (const [index, map] of value.maps.entries()) {
    if (
      !record(map) ||
      map.name !== ['decision', 'implementation'][index] ||
      typeof map.heading !== 'string' ||
      !Array.isArray(map.cards) ||
      !Array.isArray(map.edges)
    )
      throw new Error('Invalid terminal map output.');
    const ids = new Set<string>();
    for (const card of map.cards) {
      if (
        !record(card) ||
        typeof card.id !== 'string' ||
        ids.has(card.id) ||
        typeof card.label !== 'string' ||
        !card.label.trim() ||
        typeof card.status !== 'string' ||
        typeof card.note !== 'boolean' ||
        !Array.isArray(card.body) ||
        !card.body.every((line) => typeof line === 'string')
      )
        throw new Error('Invalid terminal map card.');
      ids.add(card.id);
    }
    for (const edge of map.edges)
      if (
        !record(edge) ||
        typeof edge.source !== 'string' ||
        !ids.has(edge.source) ||
        typeof edge.target !== 'string' ||
        !ids.has(edge.target) ||
        typeof edge.label !== 'string' ||
        typeof edge.kind !== 'string'
      )
        throw new Error('Invalid terminal map arrow.');
  }
  return value.maps as readonly TerminalMap[];
}
