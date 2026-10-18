import type {
  ConversationKnowledgeGraph,
  ValidatedPlanningGraphs,
} from './contracts/domain.js';

/** Model views omit audit bookkeeping, never authoritative facts or current states.
 * The full canonical records, history and original evidence remain on disk.
 */
export function compactKnowledge(
  knowledge: ConversationKnowledgeGraph,
): unknown {
  return JSON.parse(
    JSON.stringify(knowledge, (key, value: unknown) =>
      [
        'sourceRefs',
        'dispositionSourceRefs',
        'answerSourceRefs',
        'history',
      ].includes(key)
        ? undefined
        : value,
    ),
  ) as unknown;
}

export function presentationContext(
  graphs: ValidatedPlanningGraphs,
  knowledge: ConversationKnowledgeGraph,
): unknown {
  const graph = (name: 'decisionGraph' | 'implementationGraph') => ({
    nodes: graphs[name].nodes
      .filter((node) => !['group', 'option'].includes(node.nodeType))
      .map((node) => ({
        id: node.id,
        nodeType: node.nodeType,
        title: node.title,
        description: node.description,
        primaryObjectId: node.primaryObjectId,
        ...('status' in node
          ? { status: node.status, origin: node.origin }
          : {}),
      })),
    edges:
      name === 'decisionGraph'
        ? []
        : graphs[name].edges
            .filter(
              (edge) =>
                graphs[name].nodes.some(
                  (node) =>
                    node.id === edge.sourceNodeId && node.nodeType !== 'group',
                ) &&
                graphs[name].nodes.some(
                  (node) =>
                    node.id === edge.targetNodeId && node.nodeType !== 'group',
                ),
            )
            .map(
              ({ id, sourceNodeId, targetNodeId, relation, description }) => ({
                id,
                sourceNodeId,
                targetNodeId,
                relation,
                description,
              }),
            ),
  });
  return {
    planningGraphs: {
      decisionGraph: graph('decisionGraph'),
      implementationGraph: graph('implementationGraph'),
    },
    // Implementation is already expressed by the validated graph above. The
    // designer needs canonical decision outcomes/alternatives and recorded
    // reasons, not a second copy of all implementation entities/relationships.
    knowledge: {
      objects: knowledge.objects
        .filter((object) => ['decision', 'proposal'].includes(object.kind))
        .map((object) => ({
          id: object.id,
          kind: object.kind,
          title: object.title,
          description: object.description,
          ...('state' in object ? { state: object.state } : {}),
          ...(object.kind === 'decision'
            ? {
                selectedProposalId: object.selectedProposalId,
                options: object.options.map(({ proposalId, disposition }) => ({
                  proposalId,
                  disposition,
                })),
              }
            : {}),
        })),
      annotations: knowledge.annotations.map(
        ({
          id,
          agent,
          targetObjectId,
          stance,
          reasoning,
          conditions,
          state,
          revisesAnnotationId,
        }) => ({
          id,
          agent,
          targetObjectId,
          stance,
          reasoning,
          conditions,
          state,
          revisesAnnotationId,
        }),
      ),
      warnings: knowledge.warnings.map(({ message }) => ({ message })),
    },
  };
}
