import type {
  ConversationKnowledgeGraph,
  DecisionGraph,
  ImplementationGraph,
  GraphNodeBase,
  NodeAnnotationRef,
  CrossGraphLink,
  CrossGraphLinkIndex,
  AgentAnnotation,
} from '../contracts/domain.js';
import { sortedUnique } from '../common/validation.js';

export function indexAnnotationsByTarget(
  annotations: AgentAnnotation[],
): Map<string, AgentAnnotation[]> {
  const index = new Map<string, AgentAnnotation[]>();
  for (const annotation of annotations)
    index.set(annotation.targetObjectId, [
      ...(index.get(annotation.targetObjectId) ?? []),
      annotation,
    ]);
  return index;
}

export function resolveNodeAnnotations(
  node: GraphNodeBase & { nodeType: string },
  graph: ConversationKnowledgeGraph,
  annotationIndex = indexAnnotationsByTarget(graph.annotations),
): NodeAnnotationRef[] {
  if (node.nodeType === 'group' && !node.primaryObjectId) return [];
  const references = new Map<string, NodeAnnotationRef>();
  for (const annotation of annotationIndex.get(node.primaryObjectId ?? '') ??
    [])
    references.set(annotation.id, {
      annotationId: annotation.id,
      association: 'direct',
      viaObjectIds: [],
    });
  for (const objectId of sortedUnique(node.justifiedByObjectIds))
    for (const annotation of annotationIndex.get(objectId) ?? []) {
      if (references.get(annotation.id)?.association === 'direct') continue;
      references.set(annotation.id, {
        annotationId: annotation.id,
        association: 'inherited',
        viaObjectIds: sortedUnique([
          ...(references.get(annotation.id)?.viaObjectIds ?? []),
          objectId,
        ]),
      });
    }
  return [...references.values()].sort((a, b) =>
    a.annotationId.localeCompare(b.annotationId),
  );
}

export function deriveCrossGraphLinks(
  decision: DecisionGraph,
  implementation: ImplementationGraph,
): CrossGraphLinkIndex {
  const index = new Map<string, string[]>();
  for (const node of decision.nodes)
    if (node.primaryObjectId)
      index.set(node.primaryObjectId, [
        ...(index.get(node.primaryObjectId) ?? []),
        node.id,
      ]);
  const links = new Map<string, CrossGraphLink>();
  const add = (
    d: string,
    i: string,
    object: string,
    kind: CrossGraphLink['kind'],
  ) => {
    const link = {
      decisionNodeId: d,
      implementationNodeId: i,
      viaKnowledgeObjectId: object,
      kind,
    };
    links.set(JSON.stringify([d, i, object, kind]), link);
  };
  for (const node of implementation.nodes) {
    if (node.primaryObjectId)
      for (const id of index.get(node.primaryObjectId) ?? [])
        add(id, node.id, node.primaryObjectId, 'primary_shared_object');
    for (const object of sortedUnique(node.justifiedByObjectIds))
      for (const id of index.get(object) ?? [])
        add(id, node.id, object, 'justification');
  }
  const ordered = [...links.values()].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  const byDecisionNodeId: Record<string, CrossGraphLink[]> = Object.fromEntries(
    decision.nodes.map((n) => [n.id, []]),
  );
  const byImplementationNodeId: Record<string, CrossGraphLink[]> =
    Object.fromEntries(implementation.nodes.map((n) => [n.id, []]));
  for (const link of ordered) {
    byDecisionNodeId[link.decisionNodeId]!.push(link);
    byImplementationNodeId[link.implementationNodeId]!.push(link);
  }
  return { links: ordered, byDecisionNodeId, byImplementationNodeId };
}

export function linkPlanningGraphs(
  knowledge: ConversationKnowledgeGraph,
  decision: DecisionGraph,
  implementation: ImplementationGraph,
) {
  const decisionGraph = structuredClone(decision),
    implementationGraph = structuredClone(implementation);
  const annotationIndex = indexAnnotationsByTarget(knowledge.annotations);
  for (const node of [...decisionGraph.nodes, ...implementationGraph.nodes])
    node.annotations = resolveNodeAnnotations(node, knowledge, annotationIndex);
  return {
    decisionGraph,
    implementationGraph,
    crossGraphLinks: deriveCrossGraphLinks(decisionGraph, implementationGraph),
  };
}
