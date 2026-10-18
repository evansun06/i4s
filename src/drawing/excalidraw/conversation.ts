import { createHash } from 'node:crypto';
import { conversationSchema, validateSchema } from './contracts.js';
import type { ConversationInput, Speaker } from './contracts/domain.js';
import { issue, report, uniqueIds } from './common/validation.js';

export function validateConversation(input: ConversationInput) {
  const shapeIssues = validateSchema(input, conversationSchema).map((message) =>
    issue('schema', message),
  );
  if (shapeIssues.length) return report(shapeIssues);
  const issues = uniqueIds(input.messages, 'message');
  if (!input.conversationId.trim() || input.messages.length === 0)
    issues.push(
      issue(
        'conversation',
        'Conversation ID and at least one message are required.',
      ),
    );
  let previous = -1;
  const seen = new Set<string>();
  for (const message of input.messages) {
    if (
      !Number.isSafeInteger(message.sequence) ||
      message.sequence < 0 ||
      message.sequence <= previous
    )
      issues.push(
        issue('sequence', 'Message sequences must strictly increase.', [
          message.id,
        ]),
      );
    if (message.speaker !== 'system' && !message.content.trim())
      issues.push(
        issue('content', 'Message content must be nonempty.', [message.id]),
      );
    if (
      message.timestamp !== undefined &&
      (!/^\d{4}-\d\d-\d\dT/.test(message.timestamp) ||
        !Number.isFinite(Date.parse(message.timestamp)))
    )
      issues.push(
        issue('timestamp', 'Timestamp must be an ISO date-time.', [message.id]),
      );
    if (
      message.replyToMessageId !== undefined &&
      !seen.has(message.replyToMessageId)
    )
      issues.push(
        issue(
          'reply_reference',
          'Reply must refer to an earlier message in the snapshot.',
          [message.id],
        ),
      );
    previous = message.sequence;
    seen.add(message.id);
  }
  if (input.snapshotSequence !== input.messages.at(-1)?.sequence)
    issues.push(
      issue(
        'snapshot',
        'snapshotSequence must equal the last included sequence.',
      ),
    );
  return report(issues);
}

export function ingestConversation(
  value: unknown,
  conversationId?: string,
): ConversationInput {
  let input: ConversationInput;
  if (Array.isArray(value)) {
    const messages: ConversationInput['messages'] = [];
    for (const [index, raw] of value.entries()) {
      if (!raw || typeof raw !== 'object')
        throw new Error(`Invalid EventBus event at ${index}.`);
      const e = raw as Record<string, unknown>;
      if (
        e.id !== index ||
        typeof e.text !== 'string' ||
        !['user-message', 'agent-message'].includes(String(e.kind))
      )
        throw new Error(
          `Invalid EventBus event at ${index}; IDs must be zero-based and sequential.`,
        );
      const speaker = e.kind === 'user-message' ? 'user' : e.agent;
      if (
        typeof speaker !== 'string' ||
        !['user', 'red', 'yellow', 'green', 'blue'].includes(speaker)
      )
        throw new Error(`Invalid agent at event ${index}.`);
      if (
        e.kind === 'user-message' &&
        e.replyTo !== undefined &&
        (!Number.isSafeInteger(e.replyTo) ||
          Number(e.replyTo) >= index ||
          Number(e.replyTo) < 0 ||
          messages[Number(e.replyTo)]?.speaker === 'user')
      )
        throw new Error(`Invalid replyTo at event ${index}.`);
      messages.push({
        id: `m${index}`,
        sequence: index,
        speaker: speaker as Speaker,
        content: e.text,
        ...(e.kind === 'user-message' && e.replyTo !== undefined
          ? { replyToMessageId: `m${Number(e.replyTo)}` }
          : {}),
      });
    }
    input = {
      conversationId:
        conversationId ??
        `conversation-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)}`,
      messages,
      snapshotSequence: messages.at(-1)?.sequence ?? -1,
    };
  } else {
    const errors = validateSchema(value, conversationSchema);
    if (errors.length) throw new Error(errors.join('\n'));
    input = structuredClone(value) as ConversationInput;
  }
  const errors = validateConversation(input);
  if (!errors.passed)
    throw new Error(errors.issues.map((i) => i.message).join('\n'));
  return input;
}
