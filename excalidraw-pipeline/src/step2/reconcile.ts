import type {
  DecisionGraph,
  ImplementationGraph,
  GraphNodeBase,
  GraphEdgeBase,
  ValidationIssue,
  KnowledgeObject,
  ConversationKnowledgeGraph,
} from '../contracts/domain.js';
import { issue, sortedUnique, uniqueIds } from '../common/validation.js';
import { stableId } from '../common/ids.js';

/** A broad proposal/requirement can ground several distinct planning items. */
export function canonicalRoleKey(
  node: GraphNodeBase & { nodeType: string },
  primary: KnowledgeObject | undefined,
): string {
  if (!node.primaryObjectId) return stableId('node', node.id);
  const canonicalIdentity =
    (node.nodeType === 'decision' && primary?.kind === 'decision') ||
    (node.nodeType === 'option' && primary?.kind === 'proposal') ||
    primary?.kind === 'implementation_entity';
  // Only an actual canonical identity permits merging differently worded nodes.
  // For broader sources, exact title AND description are required; no fuzzy matching.
  return JSON.stringify([
    node.nodeType,
    node.primaryObjectId,
    ...(canonicalIdentity ? [] : [node.title, node.description]),
  ]);
}

/** Merge proven canonical duplicates, not distinct elaborations of one proposal. */
export function reconcileGraph<
  N extends GraphNodeBase & { nodeType: string },
  E extends GraphEdgeBase & { relation: string },
>(input: { nodes: N[]; edges: E[] }, knowledge: ConversationKnowledgeGraph) {
  const graph = structuredClone(input);
  const issues: ValidationIssue[] = [
    ...uniqueIds(graph.nodes, 'graph node'),
    ...uniqueIds(graph.edges, 'graph edge'),
  ];
  const redirects = new Map<string, string>();
  const roles = new Map<string, N>();
  const objects = new Map(
    knowledge.objects.map((object) => [object.id, object]),
  );
  let changed = false;
  const relationships = new Map(
    knowledge.relationships.map((relationship) => [
      relationship.id,
      relationship,
    ]),
  );
  const originalNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const normalizeJustifications = (item: GraphNodeBase | GraphEdgeBase) => {
    const expanded = item.justifiedByObjectIds.flatMap((id) => {
      const relationship = !objects.has(id) ? relationships.get(id) : undefined;
      if (!relationship) return [id]; // Truly unknown IDs still fail validation.
      issues.push(
        issue(
          'relationship_justification',
          'Expanded a relationship citation into its canonical object endpoints.',
          [item.id, id],
          'warning',
        ),
      );
      changed = true;
      return [relationship.sourceObjectId, relationship.targetObjectId];
    });
    item.justifiedByObjectIds = sortedUnique(expanded);
  };
  for (const node of graph.nodes) {
    normalizeJustifications(node);
    if (
      'origin' in node &&
      node.origin === 'conversation_explicit' &&
      !node.primaryObjectId
    ) {
      node.origin = 'planner_derived';
      changed = true;
      issues.push(
        issue(
          'inferred_origin',
          'A node without a canonical primary is labeled as planner inference, not an explicit transcript item.',
          [node.id],
          'warning',
        ),
      );
    }
  }
  for (const edge of graph.edges) {
    normalizeJustifications(edge);
    const source = originalNodes.get(edge.sourceNodeId);
    const target = originalNodes.get(edge.targetNodeId);
    const decision = objects.get(source?.primaryObjectId ?? '');
    if (
      edge.relation === 'has_option' &&
      source?.nodeType === 'decision' &&
      target?.nodeType === 'option' &&
      decision?.kind === 'decision' &&
      decision.options.some(
        (option) => option.proposalId === target.primaryObjectId,
      )
    ) {
      if (edge.primaryRelationshipId || edge.origin === 'planner_derived') {
        delete edge.primaryRelationshipId;
        edge.origin = 'knowledge_derived';
        changed = true;
        issues.push(
          issue(
            'canonical_membership',
            'Restored option-membership attribution from canonical Decision.options.',
            [edge.id],
            'warning',
          ),
        );
      }
      continue;
    }
    const relation =
      edge.relation === 'contains'
        ? 'part_of'
        : edge.relation === 'influences'
          ? 'affects'
          : edge.relation;
    const from =
      edge.relation === 'contains'
        ? target?.primaryObjectId
        : source?.primaryObjectId;
    const to =
      edge.relation === 'contains'
        ? source?.primaryObjectId
        : target?.primaryObjectId;
    const matches = (id: string) => {
      const record = relationships.get(id);
      return (
        record &&
        record.relation === relation &&
        record.sourceObjectId === from &&
        record.targetObjectId === to
      );
    };
    if (
      (edge.primaryRelationshipId && !matches(edge.primaryRelationshipId)) ||
      (edge.origin === 'conversation_explicit' &&
        !knowledge.relationships.some((record) => matches(record.id)))
    ) {
      delete edge.primaryRelationshipId;
      edge.origin = 'planner_derived';
      edge.justifiedByObjectIds = sortedUnique([
        ...edge.justifiedByObjectIds,
        ...[source?.primaryObjectId, target?.primaryObjectId].filter(
          (id): id is string => Boolean(id) && objects.has(id!),
        ),
      ]);
      changed = true;
      issues.push(
        issue(
          'inferred_relationship',
          'Removed unsupported explicit relationship attribution; retained the directed connection as planner inference.',
          [edge.id],
          'warning',
        ),
      );
    }
  }
  const nodes: N[] = [];
  for (const node of graph.nodes.sort((a, b) => a.id.localeCompare(b.id))) {
    node.justifiedByObjectIds = sortedUnique(node.justifiedByObjectIds);
    const key = canonicalRoleKey(node, objects.get(node.primaryObjectId ?? ''));
    const previous = roles.get(key);
    if (previous) {
      const a = previous as GraphNodeBase & {
          origin?: string;
          status?: string;
        },
        b = node as typeof a;
      if (a.status !== b.status) {
        issues.push(
          issue(
            'duplicate_node_conflict',
            'Duplicate canonical role has different statuses; retaining both representations rather than guessing a commitment state.',
            [previous.id, node.id],
            'warning',
          ),
        );
        nodes.push(node);
        continue;
      }
      if (a.origin !== b.origin)
        issues.push(
          issue(
            'origin_classification',
            'Merged duplicate canonical role with different origin labels; canonical identity and commitment state agree.',
            [previous.id, node.id],
            'warning',
          ),
        );
      previous.justifiedByObjectIds = sortedUnique([
        ...previous.justifiedByObjectIds,
        ...node.justifiedByObjectIds,
      ]);
      redirects.set(node.id, previous.id);
      changed = true;
    } else {
      roles.set(key, node);
      redirects.set(node.id, node.id);
      nodes.push(node);
    }
  }
  graph.nodes = nodes;
  const edges = new Map<string, E>();
  for (const edge of graph.edges.sort((a, b) => a.id.localeCompare(b.id))) {
    edge.sourceNodeId = redirects.get(edge.sourceNodeId) ?? edge.sourceNodeId;
    edge.targetNodeId = redirects.get(edge.targetNodeId) ?? edge.targetNodeId;
    const key = JSON.stringify([
      edge.sourceNodeId,
      edge.relation,
      edge.targetNodeId,
    ]);
    const previous = edges.get(key);
    if (previous) {
      if (
        previous.origin !== edge.origin ||
        (previous.primaryRelationshipId &&
          edge.primaryRelationshipId &&
          previous.primaryRelationshipId !== edge.primaryRelationshipId)
      )
        issues.push(
          issue(
            'duplicate_edge_conflict',
            'Duplicate edge has incompatible provenance.',
            [previous.id, edge.id],
            'warning',
          ),
        );
      previous.justifiedByObjectIds = sortedUnique([
        ...previous.justifiedByObjectIds,
        ...edge.justifiedByObjectIds,
      ]);
      if (
        previous.primaryRelationshipId === undefined &&
        edge.primaryRelationshipId !== undefined
      )
        previous.primaryRelationshipId = edge.primaryRelationshipId;
      changed = true;
    } else {
      edge.justifiedByObjectIds = sortedUnique(edge.justifiedByObjectIds);
      edges.set(key, edge);
    }
  }
  graph.edges = [...edges.values()];
  return { graph, issues, changed, redirects: Object.fromEntries(redirects) };
}

export function reconcilePlanningGraphs(
  decisionGraph: DecisionGraph,
  implementationGraph: ImplementationGraph,
  knowledge: ConversationKnowledgeGraph,
) {
  const decision = reconcileGraph(decisionGraph, knowledge),
    implementation = reconcileGraph(implementationGraph, knowledge);
  return {
    decisionGraph: decision.graph,
    implementationGraph: implementation.graph,
    issues: [...decision.issues, ...implementation.issues],
    changed: decision.changed || implementation.changed,
    redirects: {
      decision: decision.redirects,
      implementation: implementation.redirects,
    },
  };
}
