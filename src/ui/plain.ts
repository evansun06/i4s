import { createInterface } from 'node:readline/promises';
import type { Orchestrator } from '../core/orchestrator.js';
import type { AgentDefinition, AgentId, RoomSnapshot } from '../core/types.js';

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

  // Status lines wait until the current speaker finishes.
  let held: string[] = [];
  let speaker: AgentId | undefined;
  let printed = 0;
  let askingForBudget = false;
  const status = (line: string) => {
    if (speaker) held.push(line);
    else out.write(`${DIM}  · ${line}${RESET}\n`);
  };

  let previous: RoomSnapshot = orchestrator.snapshot();
  orchestrator.subscribe(() => {
    const next = orchestrator.snapshot();

    if (next.speaking) {
      if (speaker !== next.speaking.agent) {
        speaker = next.speaking.agent;
        printed = 0;
        out.write(`\n${name(speaker)}: `);
      }
      out.write(next.speaking.text.slice(printed));
      printed = next.speaking.text.length;
    } else if (speaker) {
      out.write('\n\n');
      speaker = undefined;
      const lines = held;
      held = [];
      lines.forEach(status);
    }

    for (const { id } of agents) {
      const before = previous.agents[id].activity;
      const now = next.agents[id].activity;
      if (now === 'reviewing' && before !== 'reviewing') {
        status(`${agentName(id)} is catching up on what was said`);
      }
    }
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

  out.write('\nWelcome to The Idiots! Type "exit" to quit.\n\n');
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

      // "/new ..." sets a pending question aside and talks to everyone.
      const moveOn = asking !== undefined && /^\/new\b/i.test(input);
      const text = moveOn ? input.replace(/^\/new\b\s*/i, '') : input;
      if (!text) continue;

      status('the panel is thinking');
      await orchestrator.submit(text, { answer: !moveOn });
      const snapshot = orchestrator.snapshot();
      const { callsUsed, callLimit, pendingQuestion } = snapshot;
      out.write(`${DIM}  [${callsUsed}/${callLimit} calls used]${RESET}\n\n`);
      if (pendingQuestion) {
        out.write(
          `${BOLD}  ? QUESTION FROM ${agentName(pendingQuestion.agent)}: ${pendingQuestion.question}${RESET}\n`,
        );
        // Drafting or holding a draft: these agents continue after the answer.
        const held = agents
          .filter(({ id }) => id !== pendingQuestion.agent)
          .filter(({ id }) =>
            ['thinking', 'waiting', 'has-question'].includes(
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
    }
  } finally {
    terminal.close();
  }
}
