export type RoomMode =
  'initial-prompt' | 'running' | 'awaiting-user' | 'paused';

export type AgentId = 'red' | 'yellow' | 'green' | 'blue';

export type AgentActivity =
  | 'listening'
  | 'thinking'
  | 'waiting'
  | 'reviewing'
  | 'speaking'
  | 'researching';

export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  readonly perspective: string;
}
