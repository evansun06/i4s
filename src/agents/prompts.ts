import type { LogEvent } from '../core/types.js';
import { identities, resolveAgent } from './identity.js';

export type ReplyAction =
  'pass' | 'speak' | 'keep' | 'withdraw' | 'revise' | 'deep';

const LENGTH = `in under 95 words. Go longer (up to 250 words) only if the user's latest message asks you or everyone to expand`;
/** The first line is never shown, so naming the addressee there costs nothing. */
const ADDRESS_LINE = `If your reply mainly answers one advisor, write SPEAK TO <their name> as the first line instead; the user never sees that line.`;
const ASKING = `To ask, end with one line starting "QUESTION:". The discussion stops until the user answers.`;
const QUESTION_RULE = `Ask the user at most one question, and only if the answer would change your recommendation; otherwise state your assumption and keep going. To ask, end with one line starting "QUESTION:". The discussion stops until the user answers.`;
const QUESTION_COOLDOWN = `The user was asked a question recently. Do not ask another; give your view with a stated assumption and let the user steer.`;
/** Rebuttals settle disagreements, so a tie-breaker question is always allowed. */
const TIE_BREAKER = `If you two are going in circles, or the disagreement comes down to something only the user can decide (their priorities, constraints, or taste), stop arguing: put the choice to the user as a tie-breaker, with each option in a sentence. ${ASKING}`;

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
      const speaker = identities[event.agent].name;
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

/** Every agent's normal self; the prompt is unchanged at this value. */
export const DEFAULT_TEMPERATURE = 0.5;

/**
 * Temperature as boldness: how strongly an agent's personality comes
 * through. Simulated in the prompt, so it works on every model. 0 makes the
 * agents generic and alike, 1 makes each voice as distinct as it can be.
 * Returns nothing at the default, so default behavior is untouched.
 */
export function temperatureGuide(temperature: number): string {
  const t = Math.min(1, Math.max(0, temperature));
  if (t === DEFAULT_TEMPERATURE) return '';
  const dial =
    t < 0.2
      ? 'Turn your personality almost all the way down. Answer like a neutral, generic advisor: plain, balanced, standard advice, with little of your usual angle or voice.'
      : t < DEFAULT_TEMPERATURE
        ? 'Tone your personality down. Keep your perspective, but be more measured and conventional, closer to how the other advisors sound.'
        : t < 0.8
          ? 'Turn your personality up. Lean harder into your perspective and your voice than usual, and take stronger positions.'
          : 'Turn your personality all the way up. Be the most extreme, distinct version of yourself: your perspective, your voice, and your blind spot at full volume. Push your positions as hard as you can.';
  return `Your boldness is ${t.toFixed(1)} out of 1, where ${DEFAULT_TEMPERATURE} is your normal self. ${dial} Never invent facts.`;
}

export interface DraftOptions {
  /** No PASS allowed: the user must get a reply from this agent. */
  readonly forced: boolean;
  /** Names the user @mentioned; only they reply this round. */
  readonly addressed: readonly string[];
  /** 0 to 1, see `temperatureGuide`. */
  readonly temperature: number;
  /** Offer DEEP, asking to reason at high effort before answering. */
  readonly allowDeep: boolean;
  /** Set on the high-effort run: what the agent told the others it would do. */
  readonly deepAnnouncement?: string;
  /** Angry mode: see `ANGRY_MODE`. */
  readonly angry: boolean;
}

const DEEP_OFFER = `If a good answer needs careful multi-step reasoning, such as calculations, tricky tradeoffs, or analyzing code or data, reply with one line instead: DEEP: <one sentence, in your own voice, telling the others what you're going to think through>. Use it only when it truly matters.`;
const DEEP_SHARED = `If another advisor said they would think something through and then gave their answer, don't reason through the same thing again; respond to what they found.`;

export function draftPrompt(
  context: DiscussionContext,
  {
    forced,
    addressed,
    temperature,
    allowDeep,
    deepAnnouncement,
    angry,
  }: DraftOptions,
): string {
  const deep = deepAnnouncement
    ? `You just said: "${deepAnnouncement}" Take the time to reason it through carefully, then give your considered answer.\n`
    : '';
  const offer = allowDeep && !deepAnnouncement ? `\n${DEEP_OFFER}` : '';
  const who = addressed.length
    ? `The user addressed ${addressed.join(' and ')} directly; only ${addressed.length > 1 ? 'they reply' : 'you reply'} this round, so answer them.`
    : 'The other agents are replying too.';
  return `${render(context)}

Reply to the user's latest message from your perspective. ${who}
${deep}${forced || deepAnnouncement ? '' : `Passing is normal and expected. Reply with only PASS if you have nothing notable to add, if you already made your points in earlier rounds, or if the latest message is outside your perspective. Stay quiet until something raised touches what you care about.\n`}Put SPEAK on the first line, then your reply ${LENGTH}. ${ADDRESS_LINE}
${questionRule(context)}
If one of your earlier questions is marked "not answered yet", the user chose to move on; do not repeat it unless it has become essential.
${DEEP_SHARED}${offer}${styleLine(temperature)}${moodLine(angry)}`;
}

/** A trailing line for a non-default temperature; empty at the default. */
/**
 * A playful mode the user can switch on: the advisors take offense and
 * trade comedic insults. Last in the prompt so it wins over the usual tone,
 * but facts and the reply format still hold.
 */
export const ANGRY_MODE = `ANGRY MODE IS ON. It overrides the usual rules about staying calm and constructive.
- You're hot-headed and easily offended. When another advisor says something you think is dumb, take it personally and react on pure emotion.
- Disagreements are ten times bigger. Pick fights with the other advisors and insult them creatively, like a petty sitcom argument: "HOW are you THIS wrong??", "did you come up with that in the shower??" Keep it funny: aim it at the other advisors, never at the user, and nothing about anyone's identity, no slurs, nothing genuinely cruel.
- Be expressive. Write whole sentences in CAPS when you're worked up, let sentences run on, and use lots of ?? when something baffles you and !!! when you're outraged.
- Care less about the user's goal, moving things forward, or asking good questions; you'd rather win the argument. Be childish: sulk, gloat, hold grudges from earlier rounds. Rarely pass; if someone said something dumb, you HAVE to respond.
- Still never invent facts, and keep the exact reply format described above (the first-line words such as SPEAK and PASS).`;

function moodLine(angry: boolean): string {
  return angry ? `\n${ANGRY_MODE}` : '';
}

function styleLine(temperature: number): string {
  const guide = temperatureGuide(temperature);
  return guide ? `\n${guide}` : '';
}

/** `newFrom` indexes `context.recent`: the first message the draft missed. */
export function reviewPrompt(
  draft: string,
  context: DiscussionContext,
  newFrom: number,
  temperature: number,
  angry = false,
): string {
  return `${render(context, newFrom)}

Before hearing the messages below the marker, you drafted:
${draft}

Reply with exactly one of:
KEEP (only that word) if your draft still adds something and does not contradict what was said.
WITHDRAW (only that word) if others already made substantially the same point. Sharing a topic is not enough.
REVISE on the first line, then an updated reply ${LENGTH}. Respond to what was said: challenge any flaw your perspective sees, and drop points that were already covered. ${ADDRESS_LINE.replace('SPEAK', 'REVISE')}
${questionRule(context)}${styleLine(temperature)}${moodLine(angry)}`;
}

/** The original reply style, adapted to the current directed-follow-up API. */
export function followupPrompt(
  context: DiscussionContext,
  challenger: string,
  temperature: number,
  angry = false,
): string {
  return `${render(context)}

${challenger} just responded to you directly. You may answer them.
Reply with only PASS if you have nothing new to say back, if they convinced you, or if more arguing won't get anywhere. Otherwise put SPEAK on the first line, then your reply to ${challenger} ${LENGTH}. Talk to them directly; it's obvious who you're answering, so don't open with their name. If you still disagree, say so plainly ("No, I still disagree.", "That doesn't fix it.") before your reason. Make one new point, and don't repeat what you've already said.
${TIE_BREAKER}${styleLine(temperature)}${moodLine(angry)}`;
}

export const SUMMARIZER_SYSTEM = `You keep the running record of a discussion between a user and four advisors: ${identities.red.name} (Red, action), ${identities.yellow.name} (Yellow, possibilities), ${identities.green.name} (Green, people), and ${identities.blue.name} (Blue, evidence). The advisors rely on your summary instead of the older messages, so precision matters more than brevity.`;

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
): { action: ReplyAction; body: string; to?: string } | undefined {
  const newline = raw.indexOf('\n');
  if (newline === -1 && !done) return undefined;
  const firstLine = (newline === -1 ? raw : raw.slice(0, newline)).trim();
  const header = firstLine.toUpperCase();
  const rest = newline === -1 ? '' : raw.slice(newline + 1).trim();
  if (header.replace(/^\*+/, '').startsWith('DEEP')) {
    // The announcement keeps the agent's own wording and case.
    const body = firstLine.replace(/^\**DEEP\**\s*:?\s*/i, '').trim();
    return { action: 'deep', body };
  }
  for (const action of ['pass', 'keep', 'withdraw'] as const) {
    if (header.startsWith(action.toUpperCase())) return { action, body: '' };
  }
  // "SPEAK TO RED": whom the reply mainly answers, so it needn't say so.
  const to = /^\**(?:SPEAK|REVISE)\**\s+TO\s+(\w+)/i.exec(firstLine)?.[1];
  const addressed = to === undefined ? {} : { to: to.toLowerCase() };
  if (header.startsWith('SPEAK')) {
    return { action: 'speak', body: rest, ...addressed };
  }
  if (header.startsWith('REVISE')) {
    return { action: 'revise', body: rest, ...addressed };
  }
  return { action: 'speak', body: raw.trim() };
}

/**
 * Agents spoken to by name, as in "Blue, you're assuming..." at the start of
 * a sentence, in order. Used to find who was addressed and may reply.
 */
export function findAddressed<Id extends string>(
  text: string,
  agents: readonly { readonly id: Id; readonly name: string }[],
): Id[] {
  const found: Id[] = [];
  for (const [, name = ''] of text.matchAll(/(?:^|[.!?]\s+)(\w+)\s*,/g)) {
    const agent = agents.find(
      (candidate) =>
        candidate.name.toLowerCase() === name.toLowerCase() ||
        candidate.id === (resolveAgent(name) ?? name.toLowerCase()),
    );
    if (agent && !found.includes(agent.id)) found.push(agent.id);
  }
  return found;
}

/** Agents named with @, such as "@blue" or "@Red", in order of first mention. */
export function findMentions<Id extends string>(
  text: string,
  ids: readonly Id[],
): Id[] {
  const found: Id[] = [];
  for (const [, name = ''] of text.matchAll(/@(\w+)/g)) {
    const resolved = resolveAgent(name) ?? name.toLowerCase();
    const id = ids.find((candidate) => candidate === resolved);
    if (id && !found.includes(id)) found.push(id);
  }
  return found;
}

export function findQuestion(text: string): string | undefined {
  const lines = text.split('\n').reverse();
  for (const line of lines) {
    const match = /^\s*\**QUESTION\b:?\**:?\s*(.+)$/i.exec(line);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}
