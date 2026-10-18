export type RoomMode =
  'initial-prompt' | 'running' | 'awaiting-user' | 'paused';

export type AgentId = 'red' | 'yellow' | 'green' | 'blue';

export type AgentActivity =
  /** Following the discussion; spoke this round or has not started one. */
  | 'listening'
  /** Drafting a reply to the latest user message. */
  | 'thinking'
  /** Reasoning at high effort after telling the others it would. */
  | 'deliberating'
  /** Has a finished draft and is waiting for the floor. */
  | 'waiting'
  /** Checking a queued contribution against new messages; reviews may run together. */
  | 'reviewing'
  | 'speaking'
  /** Holding a question for the user, or waiting for the user's answer. */
  | 'has-question'
  /** Nothing notable to add this round, or its point was already made. */
  | 'passing';

/** One agent's live state, readable at any moment for visuals. */
export interface AgentState {
  readonly activity: AgentActivity;
}

export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  readonly perspective: string;
  readonly systemPrompt: string;
  /** Starting boldness, 0 to 1, simulated in the prompt. Default 0.5. */
  readonly temperature?: number;
}

/**
 * The only things written to the shared log, in speaking order. A question
 * for the user is an agent message whose text ends with a "QUESTION:" line.
 */
export type LogEntry =
  | {
      readonly kind: 'user-message';
      readonly text: string;
      /** Id of the agent message whose question this answers. */
      readonly replyTo?: number;
    }
  | {
      readonly kind: 'agent-message';
      readonly agent: AgentId;
      readonly text: string;
    };

export type LogEvent = LogEntry & { readonly id: number };

export type TurnResult = 'spoke' | 'asked' | 'passed' | 'withdrew' | 'failed';

export interface RoomSnapshot {
  readonly mode: RoomMode;
  readonly agents: Readonly<Record<AgentId, AgentState>>;
  /** Agents with a finished draft, in the order they will take the floor. */
  readonly queue: readonly AgentId[];
  /** Agents @mentioned this round, the only ones replying; empty means all. */
  readonly mentioned: readonly AgentId[];
  /** The user asked for the floor; the round ends after the current speaker. */
  readonly handRaised: boolean;
  /** Angry mode: the advisors take offense and trade comedic insults. */
  readonly angry: boolean;
  /** Each agent's boldness, 0 to 1; 0.5 is its normal self. */
  readonly temperatures: Readonly<Record<AgentId, number>>;
  readonly speaking?: { readonly agent: AgentId; readonly text: string };
  /** Set while the room waits for the user to answer this question. */
  readonly pendingQuestion?: {
    readonly agent: AgentId;
    readonly eventId: number;
    readonly question: string;
  };
  readonly callsUsed: number;
  readonly callLimit: number;
  readonly notice?: string;
  /** How the most recent turn ended; a new object for every turn. */
  readonly lastTurn?: { readonly agent: AgentId; readonly result: TurnResult };
}
