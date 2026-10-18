import type {
  ValidationIssue,
  ValidationReport,
  SourceRef,
  ConversationInput,
} from '../contracts/domain.js';

export function issue(
  code: string,
  message: string,
  ids: string[] = [],
  severity: ValidationIssue['severity'] = 'error',
): ValidationIssue {
  return { code, severity, message, objectOrGraphIds: ids };
}
export function report(issues: ValidationIssue[]): ValidationReport {
  return { passed: !issues.some((i) => i.severity === 'error'), issues };
}
export function uniqueIds(
  items: { id: string }[],
  namespace: string,
): ValidationIssue[] {
  const seen = new Set<string>();
  return items.flatMap(({ id }) => {
    const invalid = !id.trim() || seen.has(id);
    seen.add(id);
    return invalid
      ? [issue('duplicate_id', `Empty or duplicate ${namespace} ID.`, [id])]
      : [];
  });
}
export function validateSources(
  refs: SourceRef[],
  input: ConversationInput,
  owner: string,
  speaker?: string,
  required = true,
): ValidationIssue[] {
  const messages = new Map(input.messages.map((m) => [m.id, m]));
  const issues: ValidationIssue[] = [];
  if (required && refs.length === 0)
    issues.push(
      issue(
        'missing_evidence',
        'Extracted claim requires transcript evidence.',
        [owner],
      ),
    );
  for (const ref of refs) {
    const message = messages.get(ref.messageId);
    if (!message)
      issues.push(
        issue('source_reference', `Unknown message ${ref.messageId}.`, [owner]),
      );
    else {
      if (speaker && message.speaker !== speaker)
        issues.push(
          issue(
            'attribution',
            `Source ${message.id} does not belong to ${speaker}.`,
            [owner],
          ),
        );
      if (
        ref.excerpt !== undefined &&
        (!ref.excerpt || !message.content.includes(ref.excerpt))
      )
        issues.push(
          issue('excerpt', 'Source excerpt is not an exact nonempty passage.', [
            owner,
          ]),
        );
    }
  }
  return issues;
}
export function hasUserSource(
  refs: SourceRef[],
  input: ConversationInput,
): boolean {
  return refs.some((r) =>
    input.messages.some((m) => m.id === r.messageId && m.speaker === 'user'),
  );
}
export function mergeSources(...groups: SourceRef[][]): SourceRef[] {
  return [
    ...new Map(
      groups.flat().map((r) => [JSON.stringify([r.messageId, r.excerpt]), r]),
    ).values(),
  ].sort(
    (a, b) =>
      a.messageId.localeCompare(b.messageId) ||
      (a.excerpt ?? '').localeCompare(b.excerpt ?? ''),
  );
}
export function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
export function cycleIds(
  edges: { sourceNodeId: string; targetNodeId: string }[],
): string[] {
  const adj = new Map<string, string[]>();
  for (const edge of edges)
    adj.set(edge.sourceNodeId, [
      ...(adj.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ]);
  const visited = new Set<string>();
  const active = new Set<string>();
  const cycle = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (active.has(id)) {
      path.slice(path.indexOf(id)).forEach((key) => cycle.add(key));
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    for (const next of adj.get(id) ?? []) visit(next, [...path, id]);
    active.delete(id);
    visited.add(id);
  };
  for (const id of adj.keys()) visit(id, []);
  return [...cycle].sort();
}
