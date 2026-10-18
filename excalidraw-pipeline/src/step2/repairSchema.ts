import { validateSchema, type Schema } from '../contracts.js';
import type {
  ConversationKnowledgeGraph,
  ImplementationGraph,
  ValidationIssue,
} from '../contracts/domain.js';
import {
  implementationEndpoints,
  isApprovedImplementationObject,
} from './validate.js';

type RecordSchema = Extract<Schema, { type: 'object' }>;
const enumeration = (values: string[]): Schema => ({
  type: 'string',
  enum: values,
});

/** Preserve identities/commitments and valid endpoint IDs, without enforcing soft type hints. */
export function edgeRepairSchema(
  schema: Schema,
  draft: unknown,
  knowledge: ConversationKnowledgeGraph,
  errors: ValidationIssue[],
): Schema {
  if (validateSchema(draft, schema).length) return schema;
  const graph = draft as ImplementationGraph;
  if (!graph.nodes.length) return schema;
  const primaryRepairIds = new Set(
    errors
      .filter((e) =>
        [
          'plan_origin',
          'node_kind',
          'object_reference',
          'technology_choice',
        ].includes(e.code),
      )
      .flatMap((e) => e.objectOrGraphIds),
  );
  const statusRepairIds = new Set(
    errors
      .filter((error) =>
        [
          'plan_status',
          'technology_choice',
          'constraint_conflict',
          'approval_fidelity',
        ].includes(error.code),
      )
      .flatMap((error) => error.objectOrGraphIds),
  );
  const nodeKindIds = new Set(
    errors
      .filter((e) => e.code === 'node_kind')
      .flatMap((e) => e.objectOrGraphIds),
  );
  const nodes = graph.nodes.map((node) => {
    const canonical = knowledge.objects.find(
      (o) => o.id === node.primaryObjectId,
    );
    return nodeKindIds.has(node.id) &&
      canonical?.kind === 'implementation_entity'
      ? { ...node, nodeType: canonical.subtype }
      : node;
  });
  const output = structuredClone(schema) as RecordSchema;
  const nodeList = output.properties.nodes as Extract<
    Schema,
    { type: 'array' }
  >;
  const nodeTemplate = nodeList.items as RecordSchema;
  nodeList.minItems = nodes.length;
  nodeList.maxItems = nodes.length;
  const edgeList = output.properties.edges as Extract<
    Schema,
    { type: 'array' }
  >;
  const edgeTemplate = edgeList.items as RecordSchema;
  // Preserve identities; only implicated nodes may change their primary reference.
  nodeList.items = {
    anyOf: nodes.map((node) => {
      const item = structuredClone(nodeTemplate);
      item.properties.id = enumeration([node.id]);
      item.properties.nodeType = enumeration([node.nodeType]);
      const primary = knowledge.objects.find(
        (object) => object.id === node.primaryObjectId,
      );
      if (isApprovedImplementationObject(primary, knowledge))
        item.properties.status = enumeration(['confirmed']);
      else if (!statusRepairIds.has(node.id))
        item.properties.status = enumeration([node.status]);
      if (primaryRepairIds.has(node.id)) {
        item.properties.primaryObjectId = enumeration(
          knowledge.objects.map((o) => o.id),
        );
      } else if (node.primaryObjectId) {
        item.properties.primaryObjectId = enumeration([node.primaryObjectId]);
        item.required.push('primaryObjectId');
      } else delete item.properties.primaryObjectId;
      return item;
    }),
  };
  const variants: Schema[] = [];
  for (const relation of Object.keys(implementationEndpoints)) {
    const sources = nodes;
    const targets = nodes;
    if (!sources.length || !targets.length) continue;
    const item = structuredClone(edgeTemplate);
    item.properties.relation = enumeration([relation]);
    item.properties.sourceNodeId = enumeration(sources.map((n) => n.id));
    item.properties.targetNodeId = enumeration(targets.map((n) => n.id));
    delete item.properties.primaryRelationshipId;
    variants.push(item);
    for (const canonical of knowledge.relationships) {
      const expected = relation === 'contains' ? 'part_of' : relation;
      if (canonical.relation !== expected) continue;
      const from = sources.filter(
        (n) =>
          !primaryRepairIds.has(n.id) &&
          n.primaryObjectId ===
            (relation === 'contains'
              ? canonical.targetObjectId
              : canonical.sourceObjectId),
      );
      const to = targets.filter(
        (n) =>
          !primaryRepairIds.has(n.id) &&
          n.primaryObjectId ===
            (relation === 'contains'
              ? canonical.sourceObjectId
              : canonical.targetObjectId),
      );
      if (!from.length || !to.length) continue;
      const referenced = structuredClone(item);
      referenced.properties.sourceNodeId = enumeration(from.map((n) => n.id));
      referenced.properties.targetNodeId = enumeration(to.map((n) => n.id));
      referenced.properties.primaryRelationshipId = enumeration([canonical.id]);
      referenced.required.push('primaryRelationshipId');
      variants.push(referenced);
    }
  }
  if (variants.length) edgeList.items = { anyOf: variants };
  return output;
}
