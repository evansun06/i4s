/** Wire-compatible with the EventBus export in jacob/log_usage.txt. */
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
