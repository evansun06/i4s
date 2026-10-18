import { planningGraphsSchema, validateSchema } from '../contracts.js';
import { isDeepStrictEqual } from 'node:util';
import type {
  ConversationKnowledgeGraph,
  ValidatedPlanningGraphs,
  GraphNodeBase,
  DecisionGraphNode,
  ImplementationGraphNode,
  ValidationIssue,
  KnowledgeObject,
} from '../contracts/domain.js';
import { cycleIds, issue, report, uniqueIds } from '../common/validation.js';
import { deriveCrossGraphLinks, resolveNodeAnnotations } from './link.js';
import { canonicalRoleKey } from './reconcile.js';

export const implementationEndpoints: Record<string, [string[], string[]]> = {
  contains: [
    ['group', 'component'],
    [
      'group',
      'component',
      'technology',
      'workflow',
      'task',
      'interface',
      'data_entity',
      'milestone',
    ],
  ],
  uses: [
    ['component', 'workflow'],
    ['technology', 'data_entity'],
  ],
  communicates_with: [
    ['component', 'interface'],
    ['component', 'interface'],
  ],
  depends_on: [
    ['task', 'milestone', 'component'],
    ['task', 'milestone', 'component'],
  ],
  implements: [['task'], ['component', 'workflow', 'interface']],
  precedes: [
    ['workflow', 'task', 'milestone'],
    ['workflow', 'task', 'milestone'],
  ],
  produces: [
    ['workflow', 'component', 'task'],
    ['data_entity', 'component'],
  ],
};

/** Direct representation carries approval; mere justification does not. */
export function isApprovedImplementationObject(
  object: KnowledgeObject | undefined,
  knowledge: ConversationKnowledgeGraph,
): boolean {
  if (object?.kind === 'implementation_entity')
    return object.adoptionState === 'confirmed';
  if (object?.kind === 'requirement') return object.state === 'confirmed';
  if (object?.kind !== 'proposal') return false;
  return knowledge.objects.some(
    (decision) =>
      decision.kind === 'decision' &&
      decision.state === 'resolved' &&
      decision.authority !== 'not_decided' &&
      (decision.selectedProposalId === object.id ||
        decision.selectedProposalIds?.includes(object.id)),
  );
}

export function validatePlanningGraphs(
  value: unknown,
  knowledge: ConversationKnowledgeGraph,
) {
  const shape = validateSchema(value, planningGraphsSchema).map((message) =>
    issue('schema', message),
  );
  if (shape.length) return report(shape);
  const planning = value as ValidatedPlanningGraphs;
  const issues: ValidationIssue[] = [];
  const objects = new Map(knowledge.objects.map((o) => [o.id, o]));
  const annotations = new Map(knowledge.annotations.map((a) => [a.id, a]));
  const relationships = new Map(knowledge.relationships.map((r) => [r.id, r]));
  if (
    planning.conversationId !== knowledge.conversationId ||
    planning.knowledgeSnapshotSequence !== knowledge.snapshotSequence
  )
    issues.push(
      issue(
        'snapshot',
        'Planning graphs must reference the canonical knowledge snapshot.',
      ),
    );
  const checkObject = (id: string, owner: string) => {
    if (!objects.has(id))
      issues.push(
        issue('object_reference', `Unknown knowledge object ${id}.`, [owner]),
      );
  };
  for (const [graph, implementation] of [
    [planning.decisionGraph, false],
    [planning.implementationGraph, true],
  ] as const) {
    issues.push(
      ...uniqueIds(graph.nodes, 'graph node'),
      ...uniqueIds(graph.edges, 'graph edge'),
    );
    const nodes = new Map<string, DecisionGraphNode | ImplementationGraphNode>(
      graph.nodes.map((n) => [n.id, n]),
    );
    const roles = new Set<string>();
    for (const node of graph.nodes) {
      if (!node.title.trim())
        issues.push(
          issue('node_title', 'Graph nodes need readable titles.', [node.id]),
        );
      if (node.primaryObjectId) checkObject(node.primaryObjectId, node.id);
      node.justifiedByObjectIds.forEach((id) => checkObject(id, node.id));
      const primary = node.primaryObjectId
        ? objects.get(node.primaryObjectId)
        : undefined;
      if (primary) {
        const role = canonicalRoleKey(node, primary);
        if (roles.has(role))
          issues.push(
            issue(
              'duplicate_role',
              'Duplicate graph representation remains after reconciliation.',
              [node.id],
              'warning',
            ),
          );
        roles.add(role);
      }
      if (!implementation) {
        const expected = node.nodeType === 'decision' ? 'decision' : 'proposal';
        if (node.nodeType !== 'group' && primary?.kind !== expected)
          issues.push(
            issue(
              'node_kind',
              'Decision/option node must reference its matching canonical kind.',
              [node.id],
            ),
          );
      } else {
        const planNode = node as ImplementationGraphNode;
        if (
          isApprovedImplementationObject(primary, knowledge) &&
          planNode.status !== 'confirmed'
        )
          issues.push(
            issue(
              'approval_fidelity',
              'A directly represented approved object must remain confirmed. Use justification-only references for additional unapproved details.',
              [node.id],
            ),
          );
        if (
          primary?.kind === 'implementation_entity' &&
          primary.subtype !== node.nodeType &&
          !(node.nodeType === 'milestone' && primary.subtype === 'task')
        )
          issues.push(
            issue(
              'node_kind',
              'Planner classification differs from the canonical entity subtype; retained for presentation.',
              [node.id],
              'warning',
            ),
          );
        if (
          planNode.origin === 'conversation_explicit' &&
          !primary &&
          node.nodeType !== 'group'
        )
          issues.push(
            issue(
              'plan_origin',
              'Conversation-explicit node needs a canonical primary object.',
              [node.id],
            ),
          );
        if (
          !primary &&
          node.nodeType !== 'group' &&
          node.justifiedByObjectIds.length === 0
        )
          issues.push(
            issue(
              'plan_grounding',
              'Synthesized node needs consequential knowledge justifications.',
              [node.id],
              planNode.status === 'confirmed' ? 'error' : 'warning',
            ),
          );
        if (
          planNode.origin === 'decision_derived' &&
          node.nodeType !== 'group' &&
          !node.justifiedByObjectIds.some((id) => {
            const o = objects.get(id);
            return (
              o?.kind === 'decision' &&
              o.state === 'resolved' &&
              o.authority !== 'not_decided'
            );
          })
        )
          issues.push(
            issue(
              'plan_origin',
              'Decision-derived node must cite an authoritative resolved decision.',
              [node.id],
              isApprovedImplementationObject(primary, knowledge) ||
                planNode.status !== 'confirmed'
                ? 'warning'
                : 'error',
            ),
          );
        if (
          planNode.origin === 'planner_suggested' &&
          planNode.status === 'confirmed'
        )
          issues.push(
            issue(
              'plan_status',
              'A discretionary suggestion is not user-confirmed.',
              [node.id],
            ),
          );
        if (planNode.status === 'confirmed') {
          if (
            primary?.kind === 'implementation_entity' &&
            primary.adoptionState !== 'confirmed'
          )
            issues.push(
              issue(
                'plan_status',
                'Unadopted, rejected or deferred entity cannot be confirmed.',
                [node.id],
              ),
            );
          if (primary?.kind === 'requirement' && primary.state !== 'confirmed')
            issues.push(
              issue(
                'plan_status',
                'Unconfirmed requirement cannot establish confirmed implementation.',
                [node.id],
              ),
            );
          if (
            primary?.kind === 'proposal' &&
            !knowledge.objects.some(
              (o) =>
                o.kind === 'decision' &&
                o.state === 'resolved' &&
                (o.selectedProposalId === primary.id ||
                  o.selectedProposalIds?.includes(primary.id)),
            )
          )
            issues.push(
              issue(
                'plan_status',
                'An unselected proposal cannot be confirmed implementation.',
                [node.id],
              ),
            );
          if (
            node.nodeType === 'technology' &&
            !(
              (primary?.kind === 'implementation_entity' ||
                primary?.kind === 'proposal') &&
              isApprovedImplementationObject(primary, knowledge)
            )
          )
            issues.push(
              issue(
                'technology_choice',
                'A confirmed named technology needs an adopted entity or an authoritatively selected proposal.',
                [node.id],
              ),
            );
          if (
            !primary &&
            node.nodeType !== 'group' &&
            planNode.origin === 'planner_derived' &&
            !node.justifiedByObjectIds.some((id) => {
              const o = objects.get(id);
              return (
                (o?.kind === 'requirement' && o.state === 'confirmed') ||
                (o?.kind === 'decision' &&
                  o.state === 'resolved' &&
                  o.authority !== 'not_decided')
              );
            })
          )
            issues.push(
              issue(
                'plan_status',
                'A confirmed necessary elaboration needs a confirmed requirement or authoritative decision; otherwise keep it proposed.',
                [node.id],
              ),
            );
          const represented = new Set([
            node.primaryObjectId,
            ...node.justifiedByObjectIds,
          ]);
          for (const relation of knowledge.relationships.filter(
            (r) => r.relation === 'conflicts_with',
          )) {
            const left = objects.get(relation.sourceObjectId),
              right = objects.get(relation.targetObjectId);
            if (
              (represented.has(relation.sourceObjectId) &&
                authoritativeLimit(right)) ||
              (represented.has(relation.targetObjectId) &&
                authoritativeLimit(left))
            )
              issues.push(
                issue(
                  'constraint_conflict',
                  'Confirmed implementation conflicts with a confirmed requirement or hard constraint.',
                  [node.id, relation.id],
                ),
              );
          }
        }
      }
      if (
        new Set(node.annotations.map((a) => a.annotationId)).size !==
        node.annotations.length
      )
        issues.push(
          issue(
            'duplicate_annotation',
            'Duplicate node annotation references.',
            [node.id],
          ),
        );
      for (const ref of node.annotations) {
        const annotation = annotations.get(ref.annotationId);
        const valid =
          annotation &&
          (ref.association === 'direct'
            ? annotation.targetObjectId === node.primaryObjectId &&
              ref.viaObjectIds.length === 0
            : annotation.targetObjectId !== node.primaryObjectId &&
              ref.viaObjectIds.length > 0 &&
              ref.viaObjectIds.every(
                (id) =>
                  id === annotation.targetObjectId &&
                  node.justifiedByObjectIds.includes(id),
              ));
        if (!valid)
          issues.push(
            issue(
              'annotation_association',
              'Annotation association does not match its canonical target.',
              [node.id, ref.annotationId],
            ),
          );
      }
      if (
        !isDeepStrictEqual(
          node.annotations,
          resolveNodeAnnotations(node, knowledge),
        )
      )
        issues.push(
          issue(
            'annotation_completeness',
            'Linked annotations disagree with deterministic direct/inherited resolution.',
            [node.id],
          ),
        );
    }
    const edgeKeys = new Set<string>();
    const parents = new Map<string, string>();
    for (const edge of graph.edges) {
      const source = nodes.get(edge.sourceNodeId),
        target = nodes.get(edge.targetNodeId);
      const key = JSON.stringify([
        edge.sourceNodeId,
        edge.relation,
        edge.targetNodeId,
      ]);
      if (edgeKeys.has(key))
        issues.push(
          issue(
            'duplicate_edge',
            'Duplicate edge remains after reconciliation.',
            [edge.id],
          ),
        );
      edgeKeys.add(key);
      edge.justifiedByObjectIds.forEach((id) => checkObject(id, edge.id));
      if (!source || !target) {
        issues.push(
          issue(
            'edge_endpoint',
            'Edge endpoints must exist in the same graph.',
            [edge.id],
          ),
        );
        continue;
      }
      if (edge.relation === 'contains') {
        if (parents.has(target.id) && parents.get(target.id) !== source.id)
          issues.push(
            issue(
              'containment_parent',
              'Multiple containment parents; layout may choose one primary parent without discarding the other association.',
              [target.id],
              'warning',
            ),
          );
        parents.set(target.id, source.id);
      }
      const primaryRelationship = edge.primaryRelationshipId
        ? relationships.get(edge.primaryRelationshipId)
        : undefined;
      if (edge.primaryRelationshipId && !primaryRelationship)
        issues.push(
          issue('relationship_reference', 'Unknown canonical relationship.', [
            edge.id,
          ]),
        );
      if (primaryRelationship) {
        const expectedRelation =
          edge.relation === 'influences'
            ? 'affects'
            : edge.relation === 'contains'
              ? 'part_of'
              : edge.relation;
        // Knowledge part_of points child -> parent; contains points parent -> child.
        const sourceObject =
          edge.relation === 'contains'
            ? target.primaryObjectId
            : source.primaryObjectId;
        const targetObject =
          edge.relation === 'contains'
            ? source.primaryObjectId
            : target.primaryObjectId;
        if (
          primaryRelationship.relation !== expectedRelation ||
          !sourceObject ||
          !targetObject ||
          primaryRelationship.sourceObjectId !== sourceObject ||
          primaryRelationship.targetObjectId !== targetObject
        )
          issues.push(
            issue(
              'relationship_semantics',
              `Graph ${edge.relation} edge (${sourceObject ?? 'no source object'} -> ${targetObject ?? 'no target object'}) cannot represent canonical ${primaryRelationship.relation} (${primaryRelationship.sourceObjectId} -> ${primaryRelationship.targetObjectId}); relation and direction must match.`,
              [edge.id, primaryRelationship.id],
            ),
          );
      }
      if (implementation) {
        const matrix = implementationEndpoints[edge.relation];
        if (
          !matrix ||
          !matrix[0].includes(source.nodeType) ||
          !matrix[1].includes(target.nodeType)
        )
          issues.push(
            issue(
              'edge_type',
              `Advisory relation hint: ${edge.relation} pairs ${source.nodeType} -> ${target.nodeType}. Typical sources: ${matrix?.[0].join(', ') ?? 'none'}; targets: ${matrix?.[1].join(', ') ?? 'none'}. Retained for natural-language presentation.`,
              [edge.id],
              'warning',
            ),
          );
        if (
          !edge.primaryRelationshipId &&
          edge.justifiedByObjectIds.length === 0 &&
          edge.relation !== 'contains'
        )
          issues.push(
            issue(
              'edge_grounding',
              'Consequential edge needs canonical provenance or planning justification.',
              [edge.id],
              'warning',
            ),
          );
        if (
          edge.origin === 'conversation_explicit' &&
          !primaryRelationship &&
          !knowledge.relationships.some(
            (r) =>
              r.sourceObjectId === source.primaryObjectId &&
              r.targetObjectId === target.primaryObjectId &&
              r.relation === edge.relation,
          )
        )
          issues.push(
            issue(
              'edge_origin',
              'Conversation-explicit edge needs a matching knowledge relationship.',
              [edge.id],
            ),
          );
      } else if (edge.relation === 'contains') {
        if (
          source.nodeType !== 'group' ||
          !['group', 'decision'].includes(target.nodeType)
        )
          issues.push(
            issue(
              'edge_type',
              'Decision contains edge must connect group -> group/decision.',
              [edge.id],
            ),
          );
      } else if (edge.relation === 'has_option') {
        const decision = source.primaryObjectId
          ? objects.get(source.primaryObjectId)
          : undefined;
        if (
          source.nodeType !== 'decision' ||
          target.nodeType !== 'option' ||
          decision?.kind !== 'decision' ||
          !decision.options.some(
            (o) => o.proposalId === target.primaryObjectId,
          ) ||
          edge.origin === 'planner_derived'
        )
          issues.push(
            issue(
              'edge_type',
              'has_option must match an existing decision option.',
              [edge.id],
            ),
          );
      } else {
        if (source.nodeType !== 'decision' || target.nodeType !== 'decision')
          issues.push(
            issue(
              'edge_type',
              'Decision dependency/influence must connect two decisions.',
              [edge.id],
            ),
          );
        if (
          edge.origin === 'planner_derived' ||
          !knowledge.relationships.some(
            (r) =>
              r.sourceObjectId === source.primaryObjectId &&
              r.targetObjectId === target.primaryObjectId &&
              r.relation ===
                (edge.relation === 'influences' ? 'affects' : 'depends_on'),
          )
        )
          issues.push(
            issue(
              'decision_dependency',
              'Decision dependencies/influences need canonical support.',
              [edge.id],
              'warning',
            ),
          );
      }
    }
    for (const relation of ['contains', 'depends_on']) {
      const cycle = cycleIds(
        graph.edges.filter((e) => e.relation === relation),
      );
      if (cycle.length)
        issues.push(
          issue('cycle', `${relation} graph contains a cycle.`, cycle),
        );
    }
    if (implementation) {
      const cycle = cycleIds(
        graph.edges.flatMap((e) =>
          e.relation === 'depends_on'
            ? [e]
            : e.relation === 'precedes'
              ? [{ sourceNodeId: e.targetNodeId, targetNodeId: e.sourceNodeId }]
              : [],
        ),
      );
      if (cycle.length)
        issues.push(
          issue(
            'prerequisite_cycle',
            'Dependency/order constraints cannot all be satisfied.',
            cycle,
          ),
        );
    }
  }
  for (const decision of knowledge.objects.filter(
    (o) => o.kind === 'decision',
  )) {
    const representations = planning.decisionGraph.nodes.filter(
      (n) => n.primaryObjectId === decision.id && n.nodeType === 'decision',
    );
    if (decision.state === 'resolved' && representations.length === 0)
      issues.push(
        issue(
          'decision_coverage',
          'Accepted decision is missing from the decision graph.',
          [decision.id],
        ),
      );
    for (const node of representations)
      for (const option of decision.options) {
        if (
          !planning.decisionGraph.edges.some(
            (e) =>
              e.sourceNodeId === node.id &&
              e.relation === 'has_option' &&
              planning.decisionGraph.nodes.some(
                (n) =>
                  n.id === e.targetNodeId &&
                  n.primaryObjectId === option.proposalId &&
                  n.nodeType === 'option',
              ),
          )
        )
          issues.push(
            issue(
              'option_coverage',
              'Decision graph omitted a considered option.',
              [node.id, option.proposalId],
            ),
          );
      }
  }
  for (const node of planning.decisionGraph.nodes.filter(
    (n) => n.nodeType === 'option',
  )) {
    if (
      !planning.decisionGraph.edges.some((e) => {
        const parent = planning.decisionGraph.nodes.find(
          (n) => n.id === e.sourceNodeId,
        );
        const object = objects.get(parent?.primaryObjectId ?? '');
        return (
          e.relation === 'has_option' &&
          e.targetNodeId === node.id &&
          parent?.nodeType === 'decision' &&
          object?.kind === 'decision' &&
          object.options.some((o) => o.proposalId === node.primaryObjectId)
        );
      })
    )
      issues.push(
        issue(
          'orphan_option',
          'An option needs a canonical decision parent; standalone proposals are not decision options.',
          [node.id],
        ),
      );
  }
  const expectedLinks = deriveCrossGraphLinks(
    planning.decisionGraph,
    planning.implementationGraph,
  );
  if (!isDeepStrictEqual(expectedLinks, planning.crossGraphLinks))
    issues.push(
      issue(
        'cross_links',
        'Cross-links or indexes do not match canonical object associations.',
      ),
    );
  for (const object of knowledge.objects.filter(
    (o) => o.kind === 'requirement' && o.state === 'confirmed',
  ))
    if (
      !planning.implementationGraph.nodes.some(
        (n) =>
          n.primaryObjectId === object.id ||
          n.justifiedByObjectIds.includes(object.id),
      )
    )
      issues.push(
        issue(
          'requirement_coverage',
          'Confirmed requirement has no explicit implementation association.',
          [object.id],
          'warning',
        ),
      );
  return report(issues);
}

function authoritativeLimit(object: KnowledgeObject | undefined): boolean {
  return (
    (object?.kind === 'constraint' && object.flexibility === 'hard') ||
    (object?.kind === 'requirement' && object.state === 'confirmed')
  );
}

export function validateBuilderAnnotations(
  nodes: (GraphNodeBase & { nodeType: string })[],
): ValidationIssue[] {
  return nodes.flatMap((node) =>
    node.annotations.length
      ? [
          issue(
            'builder_annotations',
            'Builders must leave annotation references empty for deterministic resolution.',
            [node.id],
          ),
        ]
      : [],
  );
}
