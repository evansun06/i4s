import type { RoomMode } from './types.js';

const allowed: Record<RoomMode, readonly RoomMode[]> = {
  'initial-prompt': ['running'],
  running: ['awaiting-user', 'paused'],
  'awaiting-user': ['running', 'paused'],
  paused: ['running', 'awaiting-user'],
};

export function assertTransition(from: RoomMode, to: RoomMode): void {
  if (!allowed[from].includes(to)) {
    throw new Error(`Room cannot move from ${from} to ${to}.`);
  }
}
