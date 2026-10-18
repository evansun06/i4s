import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { identities, agentIds } from '../agents/identity.js';
import type { AgentId } from '../core/types.js';

export interface PixelCell {
  readonly glyph: string;
  readonly foreground?: string;
  readonly background?: string;
}
export interface SpriteFrame {
  readonly rows: readonly (readonly PixelCell[])[];
  readonly duration: number;
}

/** The hand-drawn exports are noninterlaced, 8-bit RGBA PNGs. */
export function decodePng(png: Buffer): {
  width: number;
  height: number;
  pixels: Buffer;
} {
  if (
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error('Invalid PNG signature.');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) {
    throw new Error('Sprites must be noninterlaced 8-bit RGBA PNGs.');
  }
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const size = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') {
      chunks.push(png.subarray(at + 8, at + 8 + size));
    }
    at += size + 12;
  }
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(chunks));
  if (raw.length !== height * (stride + 1))
    throw new Error('Invalid PNG data size.');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) throw new Error('Unknown PNG filter.');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? pixels[i - 4]! : 0;
      const b = y ? pixels[i - stride]! : 0;
      const c = y && x >= 4 ? pixels[i - stride - 4]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const prediction = [
        0,
        a,
        b,
        Math.floor((a + b) / 2),
        pa <= pb && pa <= pc ? a : pb <= pc ? b : c,
      ][filter]!;
      pixels[i] = (raw[y * (stride + 1) + x + 1]! + prediction) & 255;
    }
  }
  return { width, height, pixels };
}

export function loadSprites(): Record<AgentId, readonly SpriteFrame[]> {
  return Object.fromEntries(
    agentIds.map((id) => {
      const base = new URL(
        `../assets/source/agents/${identities[id].asset}`,
        import.meta.url,
      );
      const sheet = decodePng(readFileSync(new URL(`${base.href}.png`)));
      const meta = JSON.parse(
        readFileSync(new URL(`${base.href}.json`), 'utf8'),
      ) as {
        frames: {
          frame: { x: number; y: number; w: number; h: number };
          duration: number;
        }[];
        meta: { frameTags: { name: string; from: number; to: number }[] };
      };
      const idle = meta.meta.frameTags.find(
        (tag) => tag.name.toLowerCase() === 'idle',
      );
      if (!idle || idle.from < 0 || idle.to >= meta.frames.length) {
        throw new Error(`Invalid idle frames for ${id}.`);
      }
      const frames = meta.frames
        .slice(idle.from, idle.to + 1)
        .map(({ frame, duration }) => {
          if (
            frame.x < 0 ||
            frame.y < 0 ||
            frame.w !== 16 ||
            frame.h !== 16 ||
            frame.x + frame.w > sheet.width ||
            frame.y + frame.h > sheet.height ||
            duration <= 0
          ) {
            throw new Error(`Invalid sprite bounds for ${id}.`);
          }
          const pixel = (x: number, y: number) => {
            const at = ((frame.y + y) * sheet.width + frame.x + x) * 4;
            return sheet.pixels[at + 3]
              ? `#${sheet.pixels.subarray(at, at + 3).toString('hex')}`
              : undefined;
          };
          const rows: PixelCell[][] = [];
          for (let y = 0; y < frame.h; y += 2) {
            const row: PixelCell[] = [];
            for (let x = 0; x < frame.w; x++) {
              const top = pixel(x, y),
                bottom = pixel(x, y + 1);
              row.push(
                top
                  ? {
                      glyph: '▀',
                      foreground: top,
                      ...(bottom && { background: bottom }),
                    }
                  : bottom
                    ? { glyph: '▄', foreground: bottom }
                    : { glyph: ' ' },
              );
            }
            rows.push(row);
          }
          return { rows, duration };
        });
      return [id, frames];
    }),
  ) as unknown as Record<AgentId, readonly SpriteFrame[]>;
}

/** Independent local clocks: one idle cycle, then a randomly timed rest. */
export class IdleAnimation {
  #next: number;
  #started: number | undefined;
  constructor(
    private readonly durations: readonly number[],
    now: number,
    private readonly random = Math.random,
  ) {
    this.#next = now + random() * 3000;
  }
  frame(now: number): number {
    if (this.#started === undefined) {
      if (now < this.#next) return 0;
      this.#started = now;
    }
    let elapsed = now - this.#started;
    for (let i = 0; i < this.durations.length; i++) {
      if (elapsed < this.durations[i]!) return i;
      elapsed -= this.durations[i]!;
    }
    this.#started = undefined;
    this.#next = now + 3000 + this.random() * 5000;
    return 0;
  }
}
