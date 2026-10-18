import { createHash } from 'node:crypto';
export function stableId(namespace: string, ...parts: unknown[]): string {
  return `${namespace}_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20)}`;
}
