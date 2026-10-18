import type {
  ConversationKnowledgeGraph,
  DecisionGraph,
  Decision,
} from '../contracts/domain.js';
import { stableId } from '../common/ids.js';

/** Decisions/options are already canonical facts, not another inference task.
 * Project them independently of the implementation builder; link annotations later.
 */
export function buildDecisionGraph(
  knowledge: ConversationKnowledgeGraph,
): DecisionGraph {
  const graph: DecisionGraph = { nodes: [], edges: [] };
  const objects = new Map(
    knowledge.objects.map((object) => [object.id, object]),
  );
  const decisions = knowledge.objects.filter(
    (object): object is Decision => object.kind === 'decision',
  );
  for (const decision of decisions) {
    graph.nodes.push({
      id: stableId('decision', decision.id),
      nodeType: 'decision',
      title: decision.title,
      description: decision.description,
      primaryObjectId: decision.id,
      justifiedByObjectIds: [],
      annotations: [],
    });
    for (const option of decision.options) {
      const proposal = objects.get(option.proposalId);
      if (proposal?.kind !== 'proposal')
        throw new Error(
          'Decision projection requires validated proposal references.',
        );
      // One proposal may occur in multiple decisions; each membership is contextual.
      const optionId = stableId('option', decision.id, proposal.id);
      graph.nodes.push({
        id: optionId,
        nodeType: 'option',
        title: proposal.title,
        description: proposal.description,
        primaryObjectId: proposal.id,
        justifiedByObjectIds: [],
        annotations: [],
      });
      graph.edges.push({
        id: stableId('membership', decision.id, proposal.id),
        sourceNodeId: stableId('decision', decision.id),
        targetNodeId: optionId,
        relation: 'has_option',
        origin: 'knowledge_derived',
        justifiedByObjectIds: [decision.id],
      });
    }
  }
  for (const relationship of knowledge.relationships) {
    if (
      !['depends_on', 'affects'].includes(relationship.relation) ||
      objects.get(relationship.sourceObjectId)?.kind !== 'decision' ||
      objects.get(relationship.targetObjectId)?.kind !== 'decision'
    )
      continue;
    graph.edges.push({
      id: stableId('decision-edge', relationship.id),
      sourceNodeId: stableId('decision', relationship.sourceObjectId),
      targetNodeId: stableId('decision', relationship.targetObjectId),
      relation:
        relationship.relation === 'affects' ? 'influences' : 'depends_on',
      origin: 'knowledge_derived',
      primaryRelationshipId: relationship.id,
      justifiedByObjectIds: [],
      ...(relationship.description
        ? { description: relationship.description }
        : {}),
    });
  }
  return graph;
}
