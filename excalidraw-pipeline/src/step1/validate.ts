import { knowledgeSchema, validateSchema } from '../contracts.js';
import type {
  ConversationKnowledgeGraph,
  ConversationInput,
  Decision,
  Step1Result,
  ValidationIssue,
} from '../contracts/domain.js';
import {
  issue,
  report,
  uniqueIds,
  validateSources,
  hasUserSource,
  cycleIds,
} from '../common/validation.js';

export function validateKnowledge(
  value: unknown,
  input: ConversationInput,
): Step1Result {
  const schemaIssues = validateSchema(value, knowledgeSchema).map((message) =>
    issue('schema', message),
  );
  if (schemaIssues.length) return { validationReport: report(schemaIssues) };
  const graph = structuredClone(value) as ConversationKnowledgeGraph;
  const issues: ValidationIssue[] = [
    ...uniqueIds(graph.objects, 'object'),
    ...uniqueIds(graph.annotations, 'annotation'),
    ...uniqueIds(graph.relationships, 'relationship'),
    ...uniqueIds(graph.warnings, 'warning'),
  ];
  if (
    graph.conversationId !== input.conversationId ||
    graph.snapshotSequence !== input.snapshotSequence
  )
    issues.push(
      issue('snapshot', 'Knowledge graph must match the exact input snapshot.'),
    );
  const objects = new Map(graph.objects.map((o) => [o.id, o]));
  const messages = new Map(input.messages.map((m) => [m.id, m]));
  const checkObject = (id: string, owner: string) => {
    if (!objects.has(id))
      issues.push(
        issue('object_reference', `Unknown knowledge object ${id}.`, [owner]),
      );
  };
  const userEvidence = (
    refs: Parameters<typeof hasUserSource>[0],
    owner: string,
  ) => {
    if (!hasUserSource(refs, input))
      issues.push(
        issue(
          'decision_authority',
          'User authority requires an attributable user source.',
          [owner],
        ),
      );
  };
  for (const object of graph.objects) {
    issues.push(...validateSources(object.sourceRefs, input, object.id));
    if (!object.title.trim() || !object.description.trim())
      issues.push(
        issue(
          'object_text',
          'Knowledge objects need meaningful titles and descriptions.',
          [object.id],
        ),
      );
    if (
      object.origin === 'user_explicit' &&
      !hasUserSource(object.sourceRefs, input)
    )
      issues.push(
        issue('origin', 'User-explicit object needs a user source.', [
          object.id,
        ]),
      );
    if (
      object.origin === 'agent_explicit' &&
      !object.sourceRefs.some((r) =>
        ['red', 'yellow', 'green', 'blue'].includes(
          messages.get(r.messageId)?.speaker ?? '',
        ),
      )
    )
      issues.push(
        issue('origin', 'Agent-explicit object needs an agent source.', [
          object.id,
        ]),
      );
    switch (object.kind) {
      case 'goal':
        if (object.parentGoalId) {
          checkObject(object.parentGoalId, object.id);
          if (objects.get(object.parentGoalId)?.kind !== 'goal')
            issues.push(
              issue('object_kind', 'Parent goal must reference a goal.', [
                object.id,
              ]),
            );
        }
        break;
      case 'constraint':
        object.appliesToObjectIds.forEach((id) => checkObject(id, object.id));
        break;
      case 'risk':
        object.affectedObjectIds.forEach((id) => checkObject(id, object.id));
        break;
      case 'open_question':
        object.relatedObjectIds.forEach((id) => checkObject(id, object.id));
        issues.push(
          ...validateSources(
            object.answerSourceRefs,
            input,
            object.id,
            undefined,
            object.state === 'answered',
          ),
        );
        if (object.state !== 'answered' && object.answerSourceRefs.length)
          issues.push(
            issue(
              'question_state',
              'An unanswered question cannot claim answer evidence.',
              [object.id],
            ),
          );
        break;
      case 'decision': {
        const optionIds = new Set(object.options.map((o) => o.proposalId));
        if (optionIds.size !== object.options.length)
          issues.push(
            issue(
              'decision_option',
              'Decision contains duplicate proposal options.',
              [object.id],
            ),
          );
        const selected = object.options.filter(
          (o) => o.disposition === 'selected',
        );
        const multiple = object.selectionMode === 'multiple';
        if (
          (!multiple && object.selectedProposalIds !== undefined) ||
          (multiple && object.selectedProposalId !== undefined)
        )
          issues.push(
            issue(
              'selection_mode',
              'Single and multiple selection fields cannot be mixed.',
              [object.id],
            ),
          );
        for (const option of object.options) {
          if (objects.get(option.proposalId)?.kind !== 'proposal')
            issues.push(
              issue(
                'decision_option',
                'Every option must reference a proposal.',
                [object.id, option.proposalId],
              ),
            );
          issues.push(
            ...validateSources(
              option.dispositionSourceRefs,
              input,
              object.id,
              undefined,
              true,
            ),
          );
          if (option.disposition === 'explicitly_rejected') {
            const delegated =
              object.authority === 'delegated_by_user' &&
              hasUserSource(object.sourceRefs, input);
            if (!delegated)
              userEvidence(option.dispositionSourceRefs, object.id);
          }
        }
        if (object.state === 'resolved') {
          if (
            (multiple
              ? selected.length === 0 ||
                !object.selectedProposalIds?.length ||
                new Set(object.selectedProposalIds).size !==
                  object.selectedProposalIds.length ||
                [...selected.map((o) => o.proposalId)].sort().join('\0') !==
                  [...object.selectedProposalIds].sort().join('\0')
              : selected.length !== 1 ||
                !object.selectedProposalId ||
                selected[0]?.proposalId !== object.selectedProposalId) ||
            object.authority === 'not_decided'
          )
            issues.push(
              issue(
                'decision_authority',
                'Resolved single-choice decision needs one selected proposal and authority.',
                [object.id],
              ),
            );
          if (object.authority === 'explicit_user')
            for (const option of selected)
              userEvidence(option.dispositionSourceRefs, object.id);
          if (object.authority === 'delegated_by_user')
            userEvidence(object.sourceRefs, object.id);
        } else if (
          selected.length ||
          object.selectedProposalId !== undefined ||
          object.selectedProposalIds?.length
        )
          issues.push(
            issue(
              'decision_state',
              'An unresolved or superseded decision cannot claim a current selection.',
              [object.id],
            ),
          );
        let previous = -1;
        for (const change of object.history) {
          if (
            change.sequence < previous ||
            !Number.isSafeInteger(change.sequence) ||
            !messagesHasSequence(input, change.sequence)
          )
            issues.push(
              issue(
                'decision_history',
                'History must be chronological within this snapshot.',
                [object.id],
              ),
            );
          previous = change.sequence;
          issues.push(...validateSources(change.sourceRefs, input, object.id));
          if (
            !change.sourceRefs.some(
              (r) => messages.get(r.messageId)?.sequence === change.sequence,
            )
          )
            issues.push(
              issue(
                'decision_history',
                'History sequence must match its evidence.',
                [object.id],
              ),
            );
          if (change.authority === 'explicit_user')
            userEvidence(change.sourceRefs, object.id);
          if (change.authority === 'delegated_by_user')
            userEvidence(object.sourceRefs, object.id);
          if (
            change.changeType !== 'proposed' &&
            change.authority === 'not_decided'
          )
            issues.push(
              issue(
                'decision_history',
                'A state-changing history event needs decision authority.',
                [object.id],
              ),
            );
          if (
            change.selectedProposalId &&
            !optionIds.has(change.selectedProposalId)
          )
            issues.push(
              issue(
                'decision_history',
                'Historical selection must be among the decision options.',
                [object.id],
              ),
            );
          if (change.changeType === 'selected' && !change.selectedProposalId)
            if (!multiple || !change.selectedProposalIds?.length)
              issues.push(
                issue(
                  'decision_history',
                  'Selected change needs a proposal ID.',
                  [object.id],
                ),
              );
          if (
            (!multiple && change.selectedProposalIds !== undefined) ||
            (multiple && change.selectedProposalId !== undefined) ||
            change.selectedProposalIds?.some((id) => !optionIds.has(id))
          )
            issues.push(
              issue(
                'decision_history',
                'History selection must match the decision selection mode and proposal options.',
                [object.id],
              ),
            );
        }
        const latest = object.history
          .filter(
            (h) => h.authority !== 'not_decided' && h.changeType !== 'proposed',
          )
          .at(-1);
        if (
          latest?.changeType === 'selected' &&
          (multiple
            ? [...(object.selectedProposalIds ?? [])].sort().join('\0') !==
              [...(latest.selectedProposalIds ?? [])].sort().join('\0')
            : object.selectedProposalId !== latest.selectedProposalId)
        )
          issues.push(
            issue(
              'stale_selection',
              'Current selection disagrees with the latest authoritative change.',
              [object.id],
            ),
          );
        break;
      }
      case 'implementation_entity':
        if (
          object.adoptionState === 'confirmed' &&
          !hasUserSource(object.sourceRefs, input)
        )
          issues.push(
            issue(
              'adoption_authority',
              'Confirmed entity needs evidence of user adoption.',
              [object.id],
            ),
          );
        if (object.subtype === 'workflow') {
          issues.push(
            ...uniqueIds(
              object.steps.map((s) => ({ id: s.stepId })),
              'workflow step',
            ),
          );
          let previous = -Infinity;
          for (const step of object.steps) {
            if (!Number.isSafeInteger(step.order) || step.order <= previous)
              issues.push(
                issue(
                  'workflow_order',
                  'Workflow step order must strictly increase.',
                  [object.id],
                ),
              );
            previous = step.order;
            issues.push(...validateSources(step.sourceRefs, input, object.id));
            if (step.actorOrComponentId)
              checkObject(step.actorOrComponentId, object.id);
          }
        }
        break;
    }
  }
  const annotationIndex = new Map(graph.annotations.map((a) => [a.id, a]));
  const annotatedMessages = new Set(
    graph.annotations.flatMap((a) => a.sourceRefs.map((r) => r.messageId)),
  );
  for (const message of input.messages) {
    if (
      ['red', 'yellow', 'green', 'blue'].includes(message.speaker) &&
      !annotatedMessages.has(message.id)
    )
      issues.push(
        issue(
          'annotation_message_coverage',
          `Agent message ${message.id} (${message.speaker}) has no annotation evidence. Review for omitted expressed views; factual-only messages need no annotation.`,
          [],
          'warning',
        ),
      );
  }
  for (const annotation of graph.annotations) {
    checkObject(annotation.targetObjectId, annotation.id);
    issues.push(
      ...validateSources(
        annotation.sourceRefs,
        input,
        annotation.id,
        annotation.agent,
      ),
    );
    if (!annotation.reasoning.trim())
      issues.push(
        issue('annotation_reasoning', 'Annotation needs expressed reasoning.', [
          annotation.id,
        ]),
      );
    if (annotation.revisesAnnotationId) {
      const previous = annotationIndex.get(annotation.revisesAnnotationId);
      if (
        !previous ||
        previous.agent !== annotation.agent ||
        Math.max(
          ...(previous?.sourceRefs ?? []).map(
            (r) => messages.get(r.messageId)?.sequence ?? Infinity,
          ),
        ) >=
          Math.min(
            ...annotation.sourceRefs.map(
              (r) => messages.get(r.messageId)?.sequence ?? -1,
            ),
          )
      )
        issues.push(
          issue(
            'annotation_revision',
            'Revision must refer to an earlier record from the same agent.',
            [annotation.id],
          ),
        );
      if (previous?.state === 'current')
        issues.push(
          issue(
            'annotation_revision',
            'A revised prior annotation must be marked revised or withdrawn.',
            [previous.id],
          ),
        );
    }
  }
  const annotationCycles = cycleIds(
    graph.annotations.flatMap((a) =>
      a.revisesAnnotationId
        ? [{ sourceNodeId: a.id, targetNodeId: a.revisesAnnotationId }]
        : [],
    ),
  );
  if (annotationCycles.length)
    issues.push(
      issue(
        'revision_cycle',
        'Annotation revisions contain a cycle.',
        annotationCycles,
      ),
    );
  const goalCycles = cycleIds(
    graph.objects.flatMap((o) =>
      o.kind === 'goal' && o.parentGoalId
        ? [{ sourceNodeId: o.id, targetNodeId: o.parentGoalId }]
        : [],
    ),
  );
  if (goalCycles.length)
    issues.push(
      issue('goal_cycle', 'Goal hierarchy contains a cycle.', goalCycles),
    );
  for (const relationship of graph.relationships) {
    checkObject(relationship.sourceObjectId, relationship.id);
    checkObject(relationship.targetObjectId, relationship.id);
    issues.push(
      ...validateSources(relationship.sourceRefs, input, relationship.id),
    );
    if (
      relationship.origin === 'user_explicit' &&
      !hasUserSource(relationship.sourceRefs, input)
    )
      issues.push(
        issue('origin', 'User-explicit relationship needs user evidence.', [
          relationship.id,
        ]),
      );
    if (
      relationship.relation === 'selects' ||
      relationship.relation === 'rejects'
    ) {
      const decision = objects.get(relationship.sourceObjectId);
      if (
        decision?.kind !== 'decision' ||
        objects.get(relationship.targetObjectId)?.kind !== 'proposal'
      )
        issues.push(
          issue(
            'relationship_kind',
            'Selection/rejection connects a decision to a proposal.',
            [relationship.id],
          ),
        );
      else if (
        relationship.relation === 'selects' &&
        (decision.state !== 'resolved' ||
          (decision.selectedProposalId !== relationship.targetObjectId &&
            !decision.selectedProposalIds?.includes(
              relationship.targetObjectId,
            )))
      )
        issues.push(
          issue(
            'selection_relationship',
            'Selection relationship disagrees with current decision.',
            [relationship.id],
          ),
        );
      else if (
        relationship.relation === 'rejects' &&
        decision.options.find(
          (o) => o.proposalId === relationship.targetObjectId,
        )?.disposition !== 'explicitly_rejected'
      )
        issues.push(
          issue(
            'rejection_relationship',
            'Rejection relationship needs an explicitly rejected option.',
            [relationship.id],
          ),
        );
    }
  }
  for (const warning of graph.warnings) {
    warning.relatedObjectIds.forEach((id) => checkObject(id, warning.id));
    issues.push(
      ...validateSources(
        warning.sourceRefs,
        input,
        warning.id,
        undefined,
        false,
      ),
    );
    issues.push(
      issue(
        warning.kind,
        warning.message,
        warning.relatedObjectIds,
        warning.severity,
      ),
    );
  }
  const validationReport = report(issues);
  return validationReport.passed
    ? { knowledgeGraph: graph, validationReport }
    : { validationReport };
}

function messagesHasSequence(
  input: ConversationInput,
  sequence: number,
): boolean {
  return input.messages.some((m) => m.sequence === sequence);
}

export function decisions(graph: ConversationKnowledgeGraph): Decision[] {
  return graph.objects.filter(
    (object): object is Decision => object.kind === 'decision',
  );
}
