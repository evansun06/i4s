/** Wire-compatible with the core LogEvent; see docs/architecture.md#shared-conversation-log. */
export type LogEvent = {
  readonly id: number;
  readonly text: string;
} & (
  | { readonly kind: 'user-message'; readonly replyTo?: number }
  | {
      readonly kind: 'agent-message';
      readonly agent: 'red' | 'yellow' | 'green' | 'blue';
    }
);
