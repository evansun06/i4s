import { createHash } from 'node:crypto';
import type {
  ExcalidrawRectangleElement,
  ExcalidrawTextElement,
  ExcalidrawArrowElement,
} from '@excalidraw/excalidraw/element/types';

/** Native scene v2 records pinned to @excalidraw/excalidraw 0.18.1. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
// The published declarations refer to an unpublished internal math package.
// Its branded radians/points serialize as ordinary JSON numbers and tuples.
type Native<T> = Mutable<Omit<T, 'angle' | 'customData'>> & {
  angle: number;
  customData?: Record<string, unknown>;
};
export type Shape = Native<ExcalidrawRectangleElement>;
export type Text = Native<Omit<ExcalidrawTextElement, 'lineHeight'>> & {
  lineHeight: number;
};
export type Arrow = Native<
  Omit<ExcalidrawArrowElement, 'points' | 'lastCommittedPoint'>
> & {
  points: readonly [number, number][];
  lastCommittedPoint: [number, number] | null;
};
export type SceneElement = Shape | Text | Arrow;
export interface ExcalidrawScene {
  elements: SceneElement[];
  appState: {
    viewBackgroundColor: string;
    theme: 'light';
    zoom?: { value: number };
    scrollX?: number;
    scrollY?: number;
  };
  files: Record<string, never>;
  warnings: string[];
}
export interface ExportResult {
  filePath: string;
  elementCount: number;
  warnings: string[];
}
export interface Point {
  x: number;
  y: number;
}
type Metadata = Record<string, unknown>;

export function elementId(...parts: string[]): string {
  return `plan_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 22)}`;
}

function base(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  customData: Metadata,
) {
  const seed = parseInt(
    createHash('sha256').update(id).digest('hex').slice(0, 7),
    16,
  );
  return {
    id,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid' as const,
    strokeWidth: 1.8,
    strokeStyle: 'solid' as const,
    roughness: 1.8,
    opacity: 100,
    roundness: null,
    seed,
    version: 1,
    versionNonce: seed,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
    customData,
  };
}

export function rectangle(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  strokeColor: string,
  backgroundColor: string,
  customData: Metadata,
  dashed = false,
): Shape {
  return {
    ...base(id, x, y, width, height, customData),
    type: 'rectangle',
    strokeColor,
    backgroundColor,
    strokeStyle: dashed ? 'dashed' : 'solid',
    roundness: { type: 3 },
  };
}

export function textElement(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  color: string,
  customData: Metadata,
  containerId: string | null = null,
): Text {
  return {
    ...base(id, x, y, width, height, customData),
    type: 'text',
    text,
    originalText: text,
    fontSize,
    // Excalifont is the native handwritten face in the pinned Excalidraw release.
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId,
    strokeColor: color,
    autoResize: false,
    lineHeight: 1.3,
  };
}

export function arrowElement(
  id: string,
  points: Point[],
  source: Shape,
  target: Shape,
  color: string,
  dashed: boolean,
  customData: Metadata,
): Arrow {
  const start = points[0]!;
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const arrow: Arrow = {
    ...base(
      id,
      start.x,
      start.y,
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      customData,
    ),
    type: 'arrow',
    strokeColor: color,
    strokeStyle: dashed ? 'dashed' : 'solid',
    points: points.map((p): [number, number] => [p.x - start.x, p.y - start.y]),
    startBinding: { elementId: source.id, focus: 0, gap: 4 },
    endBinding: { elementId: target.id, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: 'arrow',
    lastCommittedPoint: null,
    elbowed: false,
  };
  for (const shape of [source, target]) {
    shape.boundElements = [
      ...(shape.boundElements ?? []),
      { id, type: 'arrow' },
    ];
  }
  return arrow;
}

export function bindText(container: Shape | Arrow, label: Text): void {
  label.containerId = container.id;
  container.boundElements = [
    ...(container.boundElements ?? []),
    { id: label.id, type: 'text' },
  ];
}
