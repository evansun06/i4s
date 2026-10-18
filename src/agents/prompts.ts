import type { LogEvent } from '../core/types.js';

export type ReplyAction = 'pass' | 'speak' | 'keep' | 'withdraw' | 'revise';

const LENGTH = `in under 50 words. Go longer (up to 250 words) only if the user's latest message asks you or everyone to expand`;
const QUESTION_RULE = `Ask the user at most one question, and only if the answer would change your recommendation; otherwise state your assumption and keep going. To ask, end with one line starting "QUESTION:". The discussion stops until the user answers.`;
const QUESTION_COOLDOWN = `The user was asked a question recently. Do not ask another; give your view with a stated assumption and let the user steer.`;

/** What a model sees: a summary of older rounds, then recent messages verbatim. */
export interface DiscussionContext {
  readonly summary: string;
  readonly recent: readonly LogEvent[];
  /** Ids of agent questions the user has answered. */
  readonly answered: ReadonlySet<number>;
}

const DRAFT_MARKER =
  '--- You started drafting here; messages below are new to you ---';

export function transcript(
  log: readonly LogEvent[],
  answered: ReadonlySet<number> = new Set(),
): string {
  return log
    .map((event) => {
      if (event.kind === 'user-message') return `USER: ${event.text}`;
      const speaker = event.agent.toUpperCase();
      if (!findQuestion(event.text)) return `${speaker}: ${event.text}`;
      const status = answered.has(event.id) ? 'answered' : 'not answered yet';
      return `${speaker} (asked the user; ${status}): ${event.text}`;
    })
    .join('\n');
}

/** True if an agent asked the user something in this round or the two before. */
function questionedRecently(recent: readonly LogEvent[]): boolean {
  let rounds = 0;
  for (let i = recent.length - 1; i >= 0 && rounds < 3; i -= 1) {
    const event = recent[i];
    if (event?.kind === 'user-message') rounds += 1;
    else if (event && findQuestion(event.text)) return true;
  }
  return false;
}

function questionRule(context: DiscussionContext): string {
  return questionedRecently(context.recent) ? QUESTION_COOLDOWN : QUESTION_RULE;
}

// Summary first, then an append-only transcript: consecutive calls share a
// long identical prefix, which providers can bill at a cached rate.
function render(context: DiscussionContext, markerAt?: number): string {
  const { summary, recent, answered } = context;
  const messages =
    markerAt === undefined
      ? transcript(recent, answered)
      : [
          transcript(recent.slice(0, markerAt), answered),
          DRAFT_MARKER,
          transcript(recent.slice(markerAt), answered),
        ]
          .filter(Boolean)
          .join('\n');
  return summary
    ? `SUMMARY OF EARLIER DISCUSSION:\n${summary}\n\nRECENT MESSAGES:\n${messages}`
    : messages;
}

export interface DraftOptions {
  /** No PASS allowed: the user must get a reply from this agent. */
  readonly forced: boolean;
  /** Names the user @mentioned; only they reply this round. */
  readonly addressed: readonly string[];
}

export function draftPrompt(
  context: DiscussionContext,
  { forced, addressed }: DraftOptions,
): string {
  const who = addressed.length
    ? `The user addressed ${addressed.join(' and ')} directly; only ${addressed.length > 1 ? 'they reply' : 'you reply'} this round, so answer them.`
    : 'The other agents are replying too.';
  return `${render(context)}

Reply to the user's latest message from your perspective. ${who}
${forced ? '' : `Passing is normal and expected. Reply with only PASS if you have nothing notable to add, if you already made your points in earlier rounds, or if the latest message is outside your perspective. Stay quiet until something raised touches what you care about.\n`}Put SPEAK on the first line, then your reply ${LENGTH}.
${questionRule(context)}
If one of your earlier questions is marked "not answered yet", the user chose to move on; do not repeat it unless it has become essential.`;
}

/** `newFrom` indexes `context.recent`: the first message the draft missed. */
export function reviewPrompt(
  draft: string,
  context: DiscussionContext,
  newFrom: number,
): string {
  return `${render(context, newFrom)}

Before hearing the messages below the marker, you drafted:
${draft}

Reply with exactly one of:
KEEP (only that word) if your draft still adds something and does not contradict what was said.
WITHDRAW (only that word) if others already made substantially the same point. Sharing a topic is not enough.
REVISE on the first line, then an updated reply ${LENGTH}. Respond to what was said: challenge any flaw your perspective sees, and drop points that were already covered.
${questionRule(context)}`;
}

export const SUMMARIZER_SYSTEM = `You keep the running record of a discussion between a user and four advisors: RED (action), YELLOW (possibilities), GREEN (people), and BLUE (evidence). The advisors rely on your summary instead of the older messages, so precision matters more than brevity.`;

export function summaryPrompt(
  previous: string,
  folded: readonly LogEvent[],
  answered: ReadonlySet<number>,
): string {
  return `PREVIOUS SUMMARY:
${previous || '(none yet)'}

MESSAGES TO FOLD IN:
${transcript(folded, answered)}

Write the updated summary, replacing the previous one. Use these sections:
Objective: what the user is trying to achieve.
Confirmed by the user: constraints, facts, preferences, and decisions the user stated or agreed to.
Assumptions: things raised but not confirmed by the user.
Positions: what each advisor has argued, including disagreements and changes of mind.
Open questions: questions marked not answered yet, and who asked them.
Keep specific names, numbers, dates, and options. Never mark something as confirmed unless the user confirmed it. Do not invent anything. Stay under 500 words.`;
}

/** Returns undefined until the header line is complete, so replies can stream. */
export function parseReply(
  raw: string,
  done: boolean,
): { action: ReplyAction; body: string } | undefined {
  const newline = raw.indexOf('\n');
  if (newline === -1 && !done) return undefined;
  const header = (newline === -1 ? raw : raw.slice(0, newline))
    .trim()
    .toUpperCase();
  const rest = newline === -1 ? '' : raw.slice(newline + 1).trim();
  for (const action of ['pass', 'keep', 'withdraw'] as const) {
    if (header.startsWith(action.toUpperCase())) return { action, body: '' };
  }
  if (header.startsWith('SPEAK')) return { action: 'speak', body: rest };
  if (header.startsWith('REVISE')) return { action: 'revise', body: rest };
  return { action: 'speak', body: raw.trim() };
}

/** Agents named with @, such as "@blue" or "@Red", in order of first mention. */
export function findMentions<Id extends string>(
  text: string,
  ids: readonly Id[],
): Id[] {
  const found: Id[] = [];
  for (const [, name = ''] of text.matchAll(/@(\w+)/g)) {
    const id = ids.find((candidate) => candidate === name.toLowerCase());
    if (id && !found.includes(id)) found.push(id);
  }
  return found;
}

export function findQuestion(text: string): string | undefined {
  const lines = text.split('\n').reverse();
  for (const line of lines) {
    const match = /^\s*\**QUESTION:?\**:?\s*(.+)$/i.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}
