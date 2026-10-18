import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SavedDiscussion } from '../core/orchestrator.js';
import type { AgentId, LogEvent } from '../core/types.js';

export const SESSIONS_DIR = join(homedir(), '.the-idiots', 'sessions');

export interface Session {
  readonly version: 1;
  readonly id: string;
  /** From the first user message; no model call is spent naming it. */
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly discussion: SavedDiscussion;
}

export function newSessionId(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

export function titleFor(discussion: SavedDiscussion): string {
  const first = discussion.log.find((event) => event.kind === 'user-message');
  const text = first?.text.replace(/\s+/g, ' ').trim() ?? 'Untitled';
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Writes to a temporary file first, so a crash never leaves half a session. */
export async function saveSession(
  session: Session,
  dir = SESSIONS_DIR,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${session.id}.json`);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`);
  await rename(temporary, file);
}

/** Newest first. Files that are unreadable or not sessions are skipped. */
export async function listSessions(dir = SESSIONS_DIR): Promise<Session[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const sessions: Session[] = [];
  for (const name of names.filter((file) => file.endsWith('.json'))) {
    try {
      const session: unknown = JSON.parse(
        await readFile(join(dir, name), 'utf8'),
      );
      if (isSession(session)) sessions.push(session);
    } catch {
      // Skip damaged files rather than refusing to start.
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const AGENT_IDS: readonly string[] = [
  'red',
  'yellow',
  'green',
  'blue',
] satisfies AgentId[];

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Partial<Record<keyof Session, unknown>>;
  const discussion = session.discussion as
    Partial<Record<keyof SavedDiscussion, unknown>> | undefined;
  return (
    session.version === 1 &&
    typeof session.id === 'string' &&
    typeof session.title === 'string' &&
    typeof session.createdAt === 'string' &&
    typeof session.updatedAt === 'string' &&
    typeof discussion === 'object' &&
    discussion !== null &&
    typeof discussion.summary === 'string' &&
    typeof discussion.foldedUpTo === 'number' &&
    Array.isArray(discussion.log) &&
    discussion.log.every(isLogEvent)
  );
}

function isLogEvent(value: unknown, index: number): value is LogEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (event.id !== index || typeof event.text !== 'string') return false;
  if (event.kind === 'user-message') {
    return event.replyTo === undefined || typeof event.replyTo === 'number';
  }
  return (
    event.kind === 'agent-message' &&
    typeof event.agent === 'string' &&
    AGENT_IDS.includes(event.agent)
  );
}
