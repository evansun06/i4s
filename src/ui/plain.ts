import { createInterface } from 'node:readline/promises';
import type { Orchestrator } from '../core/orchestrator.js';
import type { AgentDefinition, AgentId, RoomSnapshot } from '../core/types.js';
import { Pacer, type Utterance } from './pacer.js';
import { parseTemperatures } from './temperature.js';

const COLORS: Record<AgentId, string> = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
};
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/**
 * Line-by-line transcript for trying the engine before the Ink room exists.
 * It can only append, so it shows events rather than live agent states.
 */
export async function runPlain(
  orchestrator: Orchestrator,
  agents: readonly AgentDefinition[],
  options: {
    readonly afterRound?: () => Promise<void>;
    /** Display speed for replies; 0 shows them as fast as they arrive. */
    readonly wordsPerMinute?: number;
  } = {},
): Promise<void> {
  const out = process.stdout;
  const terminal = createInterface({ input: process.stdin, output: out });
  terminal.on('SIGINT', () => {
    terminal.close();
    process.exit(130);
  });
  const agentName = (id: AgentId) =>
    agents.find((agent) => agent.id === id)?.name ?? id;
  const name = (id: AgentId) => `${COLORS[id]}${agentName(id)}${RESET}`;

  // Replies and status lines appear in order, at reading speed.
  const wordsPerMinute = options.wordsPerMinute ?? 340;
  const pacer = new Pacer((text) => out.write(text), {
    wordsPerMinute,
    pauseBetweenSpeakersMs: wordsPerMinute ? 1000 : 0,
  });
  const status = (line: string) => pacer.line(`${DIM}  · ${line}${RESET}\n`);
  let current: { agent: AgentId; utterance: Utterance } | undefined;
  let askingForBudget = false;

  let previous: RoomSnapshot = orchestrator.snapshot();
  orchestrator.subscribe(() => {
    const next = orchestrator.snapshot();

    if (next.speaking?.agent !== current?.agent) {
      current?.utterance.finish();
      current = next.speaking && {
        agent: next.speaking.agent,
        utterance: pacer.speech(`\n${name(next.speaking.agent)}: `),
      };
    }
    if (next.speaking) current?.utterance.update(next.speaking.text);

    const turn = next.lastTurn;
    if (turn && turn !== previous.lastTurn && turn.result === 'withdrew') {
      status(`${agentName(turn.agent)} dropped their reply; already covered`);
    }
    if (next.notice && next.notice !== previous.notice) status(next.notice);

    if (
      next.mode === 'paused' &&
      previous.mode !== 'paused' &&
      !askingForBudget
    ) {
      askingForBudget = true;
      void askForMoreCalls().finally(() => (askingForBudget = false));
    }
    previous = next;
  });

  async function askForMoreCalls(): Promise<void> {
    const answer = await terminal.question(
      'Add how many calls? (Enter to quit) ',
    );
    const extra = Number(answer.trim());
    if (!Number.isInteger(extra) || extra <= 0) {
      terminal.close();
      process.exit(0);
    }
    orchestrator.raiseCallLimit(extra);
    orchestrator.resume();
  }

  function showQuestion(): void {
    const snapshot = orchestrator.snapshot();
    const { pendingQuestion } = snapshot;
    if (!pendingQuestion) return;
    out.write(
      `${BOLD}  ? QUESTION FROM ${agentName(pendingQuestion.agent)}: ${pendingQuestion.question}${RESET}\n`,
    );
    // Drafting or holding a draft: these agents continue after the answer.
    const held = agents
      .filter(({ id }) => id !== pendingQuestion.agent)
      .filter(({ id }) =>
        ['thinking', 'deliberating', 'waiting', 'has-question'].includes(
          snapshot.agents[id].activity,
        ),
      );
    if (held.length) {
      out.write(
        `${DIM}  ${held.map((agent) => agent.name).join(', ')} will continue after your answer${RESET}\n`,
      );
    }
    out.write(
      `${DIM}  Answer it, or type /new and a message to move on and talk to everyone${RESET}\n\n`,
    );
  }

  /** When continuing a discussion, replays the last few messages. */
  function showRecap(): void {
    const { log } = orchestrator.bus;
    if (!log.length) return;
    const recent = log.slice(-6);
    if (log.length > recent.length) {
      out.write(
        `${DIM}  (${log.length - recent.length} earlier messages)${RESET}\n`,
      );
    }
    for (const event of recent) {
      const speaker =
        event.kind === 'user-message'
          ? `${BOLD}You${RESET}`
          : name(event.agent);
      out.write(`\n${speaker}: ${event.text}\n`);
    }
    out.write('\n');
    showQuestion();
  }

  async function setTemperatures(spec: string): Promise<void> {
    if (spec.trim()) {
      const settings = parseTemperatures(
        spec,
        agents.map((agent) => agent.id),
      );
      if (!settings) {
        out.write(
          `${DIM}  Use /temp 0.8 for everyone, /temp yellow 0.9 for one agent, or /temp reset (0 = generic, 0.5 = normal, 1 = full personality).${RESET}\n\n`,
        );
        return;
      }
      for (const { target, value } of settings) {
        orchestrator.setTemperature(target, value);
      }
      // Keep the new setting with the discussion.
      await options.afterRound?.().catch(() => undefined);
    }
    const { temperatures } = orchestrator.snapshot();
    const line = agents
      .map(({ id }) => `${name(id)} ${temperatures[id].toFixed(1)}`)
      .join('  ');
    out.write(`  Temperature: ${line}\n\n`);
  }

  out.write(
    [
      '',
      'Welcome to The Idiots! Type "exit" to quit.',
      `${DIM}  /think blue <message>  ask an agent to think it through (/think <message> for all)`,
      `  /temp yellow 0.9       set how bold an agent is (/temp to see all)${RESET}`,
      '',
      '',
    ].join('\n'),
  );
  showRecap();
  try {
    while (true) {
      const asking = orchestrator.snapshot().pendingQuestion;
      const input = (
        await terminal.question(
          asking ? `Answer ${name(asking.agent)}: ` : 'You: ',
        )
      ).trim();
      if (!input) continue;
      if (input.toLowerCase() === 'exit') break;

      // "/temp", "/temp 0.8", "/temp yellow 0.9": a command, not a message.
      const temp = /^\/temp\b\s*(.*)$/i.exec(input);
      if (temp) {
        await setTemperatures(temp[1] ?? '');
        continue;
      }

      // "/new ..." sets a pending question aside and talks to everyone.
      const moveOn = asking !== undefined && /^\/new\b/i.test(input);
      let text = moveOn ? input.replace(/^\/new\b\s*/i, '') : input;

      // "/think blue red <message>" makes those agents reason deeply about
      // it; "/think <message>" asks all four.
      let deep: AgentId[] | undefined;
      const think = /^\/think\b\s*([\s\S]*)$/i.exec(text);
      if (think) {
        const words = (think[1] ?? '').split(/\s+/).filter(Boolean);
        const named: AgentId[] = [];
        while (words[0]) {
          const id = agents.find(
            (agent) => agent.id === words[0]?.toLowerCase(),
          )?.id;
          if (id) named.push(id);
          else if (words[0].toLowerCase() !== 'all') break;
          words.shift();
        }
        deep = named.length ? named : agents.map((agent) => agent.id);
        text = words.join(' ');
        if (!text) {
          out.write(
            `${DIM}  Use /think blue <message> (or /think <message> for everyone).${RESET}\n\n`,
          );
          continue;
        }
      }
      if (!text) continue;

      pacer.newRound();
      const round = orchestrator.submit(text, {
        answer: !moveOn,
        ...(deep && { deep }),
      });
      const { mentioned } = orchestrator.snapshot();
      status(
        mentioned.length
          ? `${mentioned.map(agentName).join(' and ')} replying; the others are listening`
          : 'the panel is thinking',
      );
      await round;
      try {
        await options.afterRound?.();
      } catch (error) {
        status(
          `Could not save this discussion: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      // Let the last reply finish showing before prompting again.
      await pacer.idle();
      const { callsUsed, callLimit } = orchestrator.snapshot();
      out.write(`${DIM}  [${callsUsed}/${callLimit} calls used]${RESET}\n\n`);
      showQuestion();
    }
  } finally {
    terminal.close();
  }
}
