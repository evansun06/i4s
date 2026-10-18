import type {
  ConversationKnowledgeGraph,
  ConversationInput,
  KnowledgeObject,
  Decision,
  ValidationIssue,
} from '../contracts/domain.js';
import {
  mergeSources,
  sortedUnique,
  uniqueIds,
  issue,
} from '../common/validation.js';

export interface ObjectRedirect {
  fromObjectId: string;
  toObjectId: string;
}
export interface KnowledgeExtraction {
  knowledgeGraph: ConversationKnowledgeGraph;
  objectRedirects: ObjectRedirect[];
}

/** Quote formatting repair only; never searches for a different source or changes claims. */
function repairSourceExcerpts(
  graph: ConversationKnowledgeGraph,
  input: ConversationInput,
): ValidationIssue[] {
  const messages = new Map(input.messages.map((m) => [m.id, m]));
  const issues: ValidationIssue[] = [];
  const visit = (value: unknown, owner: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, owner));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : owner;
    if (
      typeof record.messageId === 'string' &&
      typeof record.excerpt === 'string'
    ) {
      const message = messages.get(record.messageId);
      if (
        message?.content &&
        (!record.excerpt || !message.content.includes(record.excerpt))
      ) {
        record.excerpt = message.content;
        issues.push(
          issue(
            'source_excerpt_repaired',
            `Replaced a non-verbatim excerpt with the complete original message ${message.id}; source attribution and extracted claims are unchanged. Review semantic support separately.`,
            [id],
            'warning',
          ),
        );
      }
    }
    Object.values(record).forEach((item) => visit(item, id));
  };
  visit(graph, graph.conversationId);
  return issues;
}

/** Only the interpreter declares semantic identity; code never guesses from titles. */
export function remapKnowledgeReferences<T>(
  value: T,
  redirects: ReadonlyMap<string, string>,
): T {
  const single = new Set([
    'targetObjectId',
    'sourceObjectId',
    'parentGoalId',
    'proposalId',
    'selectedProposalId',
    'actorOrComponentId',
  ]);
  const many = new Set([
    'appliesToObjectIds',
    'affectedObjectIds',
    'relatedObjectIds',
    'justifiedByObjectIds',
    'selectedProposalIds',
  ]);
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item).map(([key, field]) => [
        key,
        single.has(key) && typeof field === 'string'
          ? (redirects.get(field) ?? field)
          : many.has(key) && Array.isArray(field)
            ? sortedUnique(field.map((id: string) => redirects.get(id) ?? id))
            : visit(field),
      ]),
    );
  };
  return visit(value) as T;
}

function mergeObjects(
  target: KnowledgeObject,
  other: KnowledgeObject,
): KnowledgeObject {
  const merged = {
    ...other,
    ...target,
    sourceRefs: mergeSources(target.sourceRefs, other.sourceRefs),
  };
  switch (merged.kind) {
    case 'decision': {
      const previous = other as Decision;
      const options = new Map(
        previous.options.map((option) => [option.proposalId, option]),
      );
      for (const option of merged.options) {
        const old = options.get(option.proposalId);
        options.set(option.proposalId, {
          ...option,
          dispositionSourceRefs: mergeSources(
            old?.dispositionSourceRefs ?? [],
            option.dispositionSourceRefs,
          ),
        });
      }
      merged.options = [...options.values()].sort((a, b) =>
        a.proposalId.localeCompare(b.proposalId),
      );
      merged.history = [
        ...new Map(
          [...previous.history, ...merged.history].map((change) => [
            JSON.stringify(change),
            change,
          ]),
        ).values(),
      ];
      break;
    }
    case 'proposal':
      merged.proposedBy = [
        ...new Set([
          ...merged.proposedBy,
          ...(other as typeof merged).proposedBy,
        ]),
      ].sort();
      merged.tradeoffs = sortedUnique([
        ...merged.tradeoffs,
        ...(other as typeof merged).tradeoffs,
      ]);
      break;
    case 'goal':
      merged.successCriteria = sortedUnique([
        ...merged.successCriteria,
        ...(other as typeof merged).successCriteria,
      ]);
      break;
    case 'requirement':
      merged.acceptanceCriteria = sortedUnique([
        ...merged.acceptanceCriteria,
        ...(other as typeof merged).acceptanceCriteria,
      ]);
      break;
    case 'constraint':
      merged.appliesToObjectIds = sortedUnique([
        ...merged.appliesToObjectIds,
        ...(other as typeof merged).appliesToObjectIds,
      ]);
      break;
    case 'risk':
      merged.affectedObjectIds = sortedUnique([
        ...merged.affectedObjectIds,
        ...(other as typeof merged).affectedObjectIds,
      ]);
      break;
    case 'open_question':
      merged.relatedObjectIds = sortedUnique([
        ...merged.relatedObjectIds,
        ...(other as typeof merged).relatedObjectIds,
      ]);
      merged.answerSourceRefs = mergeSources(
        merged.answerSourceRefs,
        (other as typeof merged).answerSourceRefs,
      );
      break;
    case 'implementation_entity':
      if (
        merged.subtype === 'data_entity' &&
        other.kind === 'implementation_entity' &&
        other.subtype === 'data_entity'
      )
        merged.fieldsMentioned = sortedUnique([
          ...merged.fieldsMentioned,
          ...other.fieldsMentioned,
        ]);
      break;
  }
  return merged;
}

export function reconcileDecision(decision: Decision): ValidationIssue[] {
  decision.history.sort((a, b) => a.sequence - b.sequence);
  const authoritative = decision.history.filter(
    (h) => h.authority !== 'not_decided' && h.changeType !== 'proposed',
  );
  const latest = authoritative.at(-1);
  if (!latest) return [];
  if (
    authoritative.some(
      (h) =>
        h !== latest &&
        h.sequence === latest.sequence &&
        (h.changeType !== latest.changeType ||
          h.selectedProposalId !== latest.selectedProposalId ||
          JSON.stringify(sortedUnique(h.selectedProposalIds ?? [])) !==
            JSON.stringify(sortedUnique(latest.selectedProposalIds ?? []))),
    )
  )
    return [
      issue(
        'ambiguous_history',
        'Conflicting authoritative changes at the same sequence require clarification.',
        [decision.id],
      ),
    ];
  if (
    decision.selectionMode === 'multiple' &&
    latest.changeType === 'selected' &&
    latest.selectedProposalIds?.length
  ) {
    decision.state = 'resolved';
    delete decision.selectedProposalId;
    decision.selectedProposalIds = sortedUnique(latest.selectedProposalIds);
    decision.authority = latest.authority;
    decision.options = decision.options.map((option) =>
      decision.selectedProposalIds!.includes(option.proposalId)
        ? {
            ...option,
            disposition: 'selected',
            dispositionSourceRefs: latest.sourceRefs,
          }
        : option.disposition === 'selected'
          ? {
              ...option,
              disposition: 'not_selected',
              dispositionSourceRefs: latest.sourceRefs,
            }
          : option,
    );
  } else if (
    latest.changeType === 'selected' &&
    latest.selectedProposalId &&
    decision.selectionMode !== 'multiple'
  ) {
    decision.state = 'resolved';
    decision.selectedProposalId = latest.selectedProposalId;
    decision.authority = latest.authority;
    decision.options = decision.options.map((option) =>
      option.proposalId === latest.selectedProposalId
        ? {
            ...option,
            disposition: 'selected',
            dispositionSourceRefs: latest.sourceRefs,
          }
        : option.disposition === 'selected'
          ? {
              ...option,
              disposition: 'not_selected',
              dispositionSourceRefs: latest.sourceRefs,
            }
          : option,
    );
  } else if (
    ['revoked', 'deferred', 'superseded'].includes(latest.changeType)
  ) {
    decision.state =
      latest.changeType === 'deferred'
        ? 'deferred'
        : latest.changeType === 'superseded'
          ? 'superseded'
          : 'open';
    delete decision.selectedProposalId;
    delete decision.selectedProposalIds;
    decision.authority = latest.authority;
    decision.options = decision.options.map((option) =>
      option.disposition === 'selected'
        ? {
            ...option,
            disposition:
              latest.changeType === 'deferred' ? 'deferred' : 'not_selected',
            dispositionSourceRefs: latest.sourceRefs,
          }
        : option,
    );
  }
  return [];
}

export function reconcileKnowledge(
  extraction: KnowledgeExtraction,
  input: ConversationInput,
) {
  let graph = structuredClone(extraction.knowledgeGraph);
  const excerptRepairs = repairSourceExcerpts(graph, input);
  const issues: ValidationIssue[] = [
    ...excerptRepairs,
    ...uniqueIds(graph.objects, 'object'),
    ...uniqueIds(graph.annotations, 'annotation'),
    ...uniqueIds(graph.relationships, 'relationship'),
  ];
  const objects = new Map(graph.objects.map((o) => [o.id, o]));
  const direct = new Map<string, string>();
  for (const redirect of extraction.objectRedirects) {
    if (
      direct.has(redirect.fromObjectId) &&
      direct.get(redirect.fromObjectId) !== redirect.toObjectId
    )
      issues.push(
        issue(
          'ambiguous_redirect',
          'One candidate maps to multiple canonical identities.',
          [redirect.fromObjectId],
        ),
      );
    if (
      !objects.has(redirect.fromObjectId) ||
      !objects.has(redirect.toObjectId)
    )
      issues.push(
        issue(
          'redirect_reference',
          'Redirect endpoints must be extracted objects.',
          [redirect.fromObjectId, redirect.toObjectId],
        ),
      );
    direct.set(redirect.fromObjectId, redirect.toObjectId);
  }
  const redirects = new Map<string, string>();
  for (const id of objects.keys()) {
    const seen = new Set<string>();
    let next = id;
    while (direct.has(next) && direct.get(next) !== next) {
      if (seen.has(next)) {
        issues.push(
          issue(
            'redirect_cycle',
            'Canonical identity redirects contain a cycle.',
            [...seen],
          ),
        );
        break;
      }
      seen.add(next);
      next = direct.get(next)!;
    }
    redirects.set(id, next);
  }
  if (issues.some((i) => i.severity === 'error'))
    return {
      knowledgeGraph: graph,
      redirects: Object.fromEntries(redirects),
      issues,
    };
  const merged = new Map<string, KnowledgeObject>();
  for (const object of graph.objects) {
    const id = redirects.get(object.id)!;
    const canonical = objects.get(id)!;
    if (
      canonical.kind !== object.kind ||
      (canonical.kind === 'implementation_entity' &&
        object.kind === 'implementation_entity' &&
        canonical.subtype !== object.subtype)
    ) {
      issues.push(
        issue(
          'redirect_kind',
          'Cannot merge distinct knowledge kinds or entity subtypes.',
          [object.id, id],
        ),
      );
      continue;
    }
    if (
      canonical.kind === 'constraint' &&
      object.kind === 'constraint' &&
      canonical.value !== undefined &&
      object.value !== undefined &&
      (canonical.value !== object.value || canonical.unit !== object.unit)
    ) {
      issues.push(
        issue(
          'ambiguous_merge',
          'Conflicting quantities must be reconciled by the interpreter with current transcript evidence before merging.',
          [object.id, id],
        ),
      );
      continue;
    }
    if (
      object.kind === 'implementation_entity' &&
      object.subtype === 'workflow' &&
      canonical.kind === 'implementation_entity' &&
      canonical.subtype === 'workflow' &&
      JSON.stringify(object.steps) !== JSON.stringify(canonical.steps)
    ) {
      issues.push(
        issue(
          'ambiguous_merge',
          'Conflicting workflow steps require semantic reconciliation before merging.',
          [object.id, id],
        ),
      );
      continue;
    }
    merged.set(id, mergeObjects(merged.get(id) ?? canonical, object));
  }
  graph.objects = [...merged.values()];
  graph = remapKnowledgeReferences(graph, redirects);
  const sequenceById = new Map(input.messages.map((m) => [m.id, m.sequence]));
  for (const object of graph.objects)
    if (object.kind === 'decision') {
      // Proposal aliases can collapse options after all knowledge references redirect.
      const options = new Map<string, Decision['options'][number]>();
      for (const option of object.options) {
        const previous = options.get(option.proposalId);
        if (!previous) {
          options.set(option.proposalId, option);
          continue;
        }
        const previousAt = Math.max(
          ...previous.dispositionSourceRefs.map(
            (r) => sequenceById.get(r.messageId) ?? -1,
          ),
        );
        const nextAt = Math.max(
          ...option.dispositionSourceRefs.map(
            (r) => sequenceById.get(r.messageId) ?? -1,
          ),
        );
        if (
          previousAt === nextAt &&
          previous.disposition !== option.disposition
        )
          issues.push(
            issue(
              'ambiguous_option',
              'Equivalent proposal options have conflicting outcomes at the same sequence.',
              [object.id, option.proposalId],
            ),
          );
        options.set(
          option.proposalId,
          previous.disposition === option.disposition
            ? {
                ...previous,
                dispositionSourceRefs: mergeSources(
                  previous.dispositionSourceRefs,
                  option.dispositionSourceRefs,
                ),
              }
            : nextAt > previousAt
              ? option
              : previous,
        );
      }
      object.options = [...options.values()].sort((a, b) =>
        a.proposalId.localeCompare(b.proposalId),
      );
      const history = new Map<string, Decision['history'][number]>();
      for (const change of object.history) {
        const key = JSON.stringify([
          change.sequence,
          change.changeType,
          change.authority,
          change.selectedProposalId,
          sortedUnique(change.selectedProposalIds ?? []),
        ]);
        const previous = history.get(key);
        history.set(key, {
          ...change,
          sourceRefs: mergeSources(
            previous?.sourceRefs ?? [],
            change.sourceRefs,
          ),
        });
      }
      object.history = [...history.values()];
      issues.push(...reconcileDecision(object));
    }
  // Relations express current state; historical choices stay in Decision.history.
  graph.relationships = graph.relationships.filter((r) => {
    const source = graph.objects.find((o) => o.id === r.sourceObjectId);
    if (
      r.relation !== 'selects' ||
      source?.kind !== 'decision' ||
      source.selectedProposalId === r.targetObjectId ||
      (source.kind === 'decision' &&
        source.selectedProposalIds?.includes(r.targetObjectId))
    )
      return true;
    const historical = source.history.some(
      (h) =>
        h.changeType === 'selected' &&
        (h.selectedProposalId === r.targetObjectId ||
          h.selectedProposalIds?.includes(r.targetObjectId)) &&
        r.sourceRefs.every((ref) =>
          h.sourceRefs.some((e) => e.messageId === ref.messageId),
        ),
    );
    if (historical)
      issues.push(
        issue(
          'historical_selection',
          'Historical selects relationship retained in decision history rather than current relationships.',
          [r.id],
          'info',
        ),
      );
    return !historical;
  });
  const relations = new Map<string, (typeof graph.relationships)[number]>();
  for (const r of graph.relationships.sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const key = JSON.stringify([
      r.sourceObjectId,
      r.relation,
      r.targetObjectId,
      r.origin,
    ]);
    const existing = relations.get(key);
    if (existing)
      existing.sourceRefs = mergeSources(existing.sourceRefs, r.sourceRefs);
    else relations.set(key, r);
  }
  graph.relationships = [...relations.values()];
  // Keep annotation history intact; mechanical source duplication is safe to remove.
  for (const annotation of graph.annotations)
    annotation.sourceRefs = mergeSources(annotation.sourceRefs);
  const sequence = new Map(input.messages.map((m) => [m.id, m.sequence]));
  graph.objects.sort(
    (a, b) =>
      Math.min(
        ...a.sourceRefs.map((r) => sequence.get(r.messageId) ?? Infinity),
      ) -
        Math.min(
          ...b.sourceRefs.map((r) => sequence.get(r.messageId) ?? Infinity),
        ) || a.id.localeCompare(b.id),
  );
  graph.annotations.sort(
    (a, b) =>
      Math.min(
        ...a.sourceRefs.map((r) => sequence.get(r.messageId) ?? Infinity),
      ) -
        Math.min(
          ...b.sourceRefs.map((r) => sequence.get(r.messageId) ?? Infinity),
        ) || a.id.localeCompare(b.id),
  );
  graph.warnings.sort((a, b) => a.id.localeCompare(b.id));
  return {
    knowledgeGraph: graph,
    redirects: Object.fromEntries(redirects),
    issues,
  };
}
