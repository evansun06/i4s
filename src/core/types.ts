export type RoomMode =
  'initial-prompt' | 'running' | 'awaiting-user' | 'paused';

export type AgentId = 'red' | 'yellow' | 'green' | 'blue';

export type AgentActivity =
  /** Following the discussion; spoke this round or has not started one. */
  | 'listening'
  /** Drafting a reply to the latest user message. */
  | 'thinking'
  /** Has a finished draft and is waiting for the floor. */
  | 'waiting'
  /** Holds the floor; checking its draft against what it missed. */
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
