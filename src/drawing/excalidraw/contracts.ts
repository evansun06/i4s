/** JSON contracts for the isolated seeded experiment. No application imports. */
export type Schema =
  | {
      type: 'string';
      enum?: readonly string[];
      minLength?: number;
      maxLength?: number;
    }
  | {
      type: 'number' | 'integer' | 'boolean' | 'null';
      enum?: readonly string[];
    }
  | { type: 'array'; items: Schema; minItems?: number; maxItems?: number }
  | {
      type: 'object';
      properties: Record<string, Schema>;
      required: string[];
      additionalProperties?: Schema | false;
    }
  | { anyOf: Schema[] };

const str: Schema = { type: 'string' };
const num: Schema = { type: 'number' };
const integer: Schema = { type: 'integer' };
const bool: Schema = { type: 'boolean' };
const values = (text: string): Schema => ({
  type: 'string',
  enum: text.split(' '),
});
const list = (items: Schema): Schema => ({ type: 'array', items });
function record(
  fields: Record<string, Schema>,
  optional: Record<string, Schema> = {},
): Schema {
  return {
    type: 'object',
    properties: { ...fields, ...optional },
    required: Object.keys(fields),
    additionalProperties: false,
  };
}
const refs = list(record({ messageId: str }, { excerpt: str }));
const ids = list(str);
const origin = values('user_explicit agent_explicit conversation_inferred');
const priority = values('critical high medium low unspecified');
const base = {
  id: str,
  title: str,
  description: str,
  origin,
  sourceRefs: refs,
};
const object = (
  kind: string,
  fields: Record<string, Schema>,
  optional: Record<string, Schema> = {},
): Schema => record({ ...base, kind: values(kind), ...fields }, optional);
const entity = (
  subtype: string,
  fields: Record<string, Schema>,
  optional: Record<string, Schema> = {},
): Schema =>
  object(
    'implementation_entity',
    {
      subtype: values(subtype),
      adoptionState: values('confirmed proposed rejected deferred superseded'),
      ...fields,
    },
    optional,
  );
const authority = values('explicit_user delegated_by_user not_decided');
const knowledgeObject: Schema = {
  anyOf: [
    object(
      'goal',
      {
        priority,
        successCriteria: ids,
        state: values('active proposed abandoned achieved'),
      },
      { parentGoalId: str },
    ),
    object('requirement', {
      requirementKind: values('functional nonfunctional quality policy other'),
      priority,
      state: values('confirmed proposed deferred removed'),
      acceptanceCriteria: ids,
    }),
    object(
      'constraint',
      {
        constraintKind: values(
          'time budget people skill platform legal resource scope compatibility other',
        ),
        flexibility: values('hard soft unknown'),
        expression: str,
        appliesToObjectIds: ids,
      },
      { value: { anyOf: [num, str] }, unit: str },
    ),
    object('context_fact', {
      statement: str,
      verification: values(
        'user_reported agent_claimed externally_verified unverified disputed',
      ),
      status: values('current disputed outdated unknown'),
    }),
    object(
      'decision',
      {
        question: str,
        category: values(
          'architecture feature workflow strategy resource schedule product other',
        ),
        state: values('open resolved deferred superseded'),
        options: list(
          record({
            proposalId: str,
            disposition: values(
              'selected explicitly_rejected not_selected considered deferred withdrawn',
            ),
            dispositionSourceRefs: refs,
          }),
        ),
        authority,
        history: list(
          record(
            {
              sequence: integer,
              changeType: values(
                'proposed selected revoked deferred superseded',
              ),
              authority,
              sourceRefs: refs,
            },
            { selectedProposalId: str, selectedProposalIds: ids },
          ),
        ),
      },
      {
        selectedProposalId: str,
        selectionMode: values('single multiple'),
        selectedProposalIds: ids,
        unresolvedReason: str,
      },
    ),
    object(
      'proposal',
      {
        proposedBy: list(values('user red yellow green blue system other')),
        state: values('active withdrawn superseded'),
        tradeoffs: ids,
      },
      { intendedBenefit: str },
    ),
    object(
      'risk',
      {
        severity: values('low medium high unknown'),
        likelihood: values('low medium high unknown'),
        impact: str,
        affectedObjectIds: ids,
      },
      { mitigation: str },
    ),
    object(
      'assumption',
      {
        statement: str,
        state: values('unverified supported challenged disproven'),
      },
      { validationNeeded: str },
    ),
    object('open_question', {
      question: str,
      state: values('open answered deferred'),
      blocking: { anyOf: [bool, values('unknown')] },
      relatedObjectIds: ids,
      answerSourceRefs: refs,
    }),
    entity('component', {}, { responsibility: str, boundaryDescription: str }),
    entity(
      'technology',
      { technologyName: str },
      { version: str, intendedUse: str },
    ),
    entity(
      'workflow',
      {
        steps: list(
          record(
            { stepId: str, label: str, order: integer, sourceRefs: refs },
            { actorOrComponentId: str },
          ),
        ),
      },
      { trigger: str, outcome: str },
    ),
    entity(
      'interface',
      {},
      {
        contractType: values('api event message data_exchange other'),
        protocol: str,
        endpointOrTopic: str,
      },
    ),
    entity(
      'task',
      {
        intendedAction: str,
        completionState: values(
          'proposed committed in_progress done cancelled',
        ),
      },
      { owner: str, explicitlyStatedDeadline: str },
    ),
    entity(
      'data_entity',
      { fieldsMentioned: ids },
      { dataDescription: str, storageOrFormat: str },
    ),
  ],
};
const warning = record({
  id: str,
  kind: values(
    'ambiguity contradiction unsupported_claim missing_information invalid_reference incomplete_extraction other',
  ),
  severity: values('info warning error'),
  message: str,
  relatedObjectIds: ids,
  sourceRefs: refs,
});
const annotation = record(
  {
    id: str,
    agent: values('red yellow green blue'),
    targetObjectId: str,
    stance: values('support oppose conditional neutral concern question'),
    reasoning: str,
    conditions: ids,
    sourceRefs: refs,
    state: values('current revised withdrawn'),
  },
  { revisesAnnotationId: str },
);
const relationship = record(
  {
    id: str,
    sourceObjectId: str,
    targetObjectId: str,
    relation: values(
      'part_of supports conflicts_with constrains satisfies depends_on selects rejects addresses implements uses communicates_with precedes produces affects',
    ),
    origin,
    sourceRefs: refs,
  },
  { description: str },
);
const nodeBase = {
  id: str,
  title: str,
  description: str,
  justifiedByObjectIds: ids,
  annotations: list(
    record({
      annotationId: str,
      association: values('direct inherited'),
      viaObjectIds: ids,
    }),
  ),
};
const edgeBase = {
  id: str,
  sourceNodeId: str,
  targetNodeId: str,
  justifiedByObjectIds: ids,
  origin: values('conversation_explicit knowledge_derived planner_derived'),
};
function graph(implementation: boolean): Schema {
  return record({
    nodes: list(
      record(
        {
          ...nodeBase,
          nodeType: values(
            implementation
              ? 'group component technology workflow task interface data_entity milestone'
              : 'group decision option',
          ),
          ...(implementation
            ? {
                origin: values(
                  'conversation_explicit decision_derived planner_derived planner_suggested',
                ),
                status: values('confirmed proposed undecided deferred'),
              }
            : {}),
        },
        { primaryObjectId: str },
      ),
    ),
    edges: list(
      record(
        {
          ...edgeBase,
          relation: values(
            implementation
              ? 'contains uses communicates_with depends_on implements precedes produces'
              : 'contains has_option depends_on influences',
          ),
        },
        { primaryRelationshipId: str, description: str },
      ),
    ),
  });
}
export const knowledgeSchema = record({
  schemaVersion: values('1.0'),
  conversationId: str,
  snapshotSequence: integer,
  objects: list(knowledgeObject),
  annotations: list(annotation),
  relationships: list(relationship),
  warnings: list(warning),
});
export const decisionGraphSchema = graph(false);
export const implementationGraphSchema = graph(true);
export const draftSchema = record({
  knowledgeGraph: knowledgeSchema,
  decisionGraph: decisionGraphSchema,
  implementationGraph: implementationGraphSchema,
});

export const conversationSchema = record({
  conversationId: str,
  snapshotSequence: integer,
  messages: list(
    record(
      {
        id: str,
        sequence: integer,
        speaker: values('user red yellow green blue system other'),
        content: str,
      },
      { timestamp: str, replyToMessageId: str },
    ),
  ),
});
export const extractionSchema = record({
  knowledgeGraph: knowledgeSchema,
  objectRedirects: list(record({ fromObjectId: str, toObjectId: str })),
});
const validationIssueSchema = record({
  code: str,
  severity: values('info warning error'),
  message: str,
  objectOrGraphIds: ids,
});
export const validationReportSchema = record({
  passed: bool,
  issues: list(validationIssueSchema),
});
const crossLinkSchema = record({
  decisionNodeId: str,
  implementationNodeId: str,
  viaKnowledgeObjectId: str,
  kind: values('primary_shared_object justification'),
});
const linkMap: Schema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: list(crossLinkSchema),
};
export const planningGraphsSchema = record({
  schemaVersion: values('1.0'),
  conversationId: str,
  knowledgeSnapshotSequence: integer,
  decisionGraph: decisionGraphSchema,
  implementationGraph: implementationGraphSchema,
  crossGraphLinks: record({
    links: list(crossLinkSchema),
    byDecisionNodeId: linkMap,
    byImplementationNodeId: linkMap,
  }),
  warnings: list(validationIssueSchema),
});
export const step1ResultSchema = record(
  { validationReport: validationReportSchema },
  { knowledgeGraph: knowledgeSchema },
);
export const step2ResultSchema = record(
  { validationReport: validationReportSchema },
  { planningGraphs: planningGraphsSchema },
);
export const finalResultSchema = record(
  { step1Report: validationReportSchema },
  {
    knowledgeGraph: knowledgeSchema,
    planningGraphs: planningGraphsSchema,
    step2Report: validationReportSchema,
  },
);

export type JsonRecord = { [key: string]: JsonValue };
export type JsonValue =
  string | number | boolean | null | JsonRecord | JsonValue[];

/** Exact required fields and enum checks before any graph operations. */
export function validateSchema(
  value: unknown,
  schema: Schema = draftSchema,
  path = '$',
): string[] {
  if ('anyOf' in schema) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const item = value as Record<string, unknown>;
      const candidates = schema.anyOf.filter(
        (candidate) =>
          !('anyOf' in candidate) &&
          candidate.type === 'object' &&
          ['kind', 'subtype'].every((key) => {
            const field = candidate.properties[key];
            return (
              !field ||
              !('enum' in field) ||
              !field.enum ||
              field.enum.includes(String(item[key]))
            );
          }),
      );
      if (candidates.length === 1)
        return validateSchema(value, candidates[0], path);
    }
    return schema.anyOf.some(
      (candidate) => validateSchema(value, candidate, path).length === 0,
    )
      ? []
      : [`${path}: does not match any supported object type`];
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    return [
      ...(schema.minItems !== undefined && value.length < schema.minItems
        ? [`${path}: must contain at least ${schema.minItems} items`]
        : []),
      ...(schema.maxItems !== undefined && value.length > schema.maxItems
        ? [`${path}: must not exceed ${schema.maxItems} items`]
        : []),
      ...value.flatMap((item: unknown, i) =>
        validateSchema(item, schema.items, `${path}[${i}]`),
      ),
    ];
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      return [`${path}: expected object`];
    const input = value as Record<string, unknown>;
    return [
      ...schema.required
        .filter((key) => !Object.hasOwn(input, key))
        .map((key) => `${path}.${key}: required`),
      ...Object.keys(input).flatMap((key) => {
        const field = schema.properties[key] ?? schema.additionalProperties;
        return field
          ? validateSchema(input[key], field, `${path}.${key}`)
          : [`${path}.${key}: unknown field`];
      }),
    ];
  }
  if (schema.type === 'null')
    return value === null ? [] : [`${path}: expected null`];
  if (schema.type === 'integer')
    return typeof value === 'number' && Number.isSafeInteger(value)
      ? []
      : [`${path}: expected safe integer`];
  if (
    typeof value !== schema.type ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
    return [`${path}: expected ${schema.type}`];
  if (schema.type === 'string' && typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength)
      return [`${path}: must contain at least ${schema.minLength} characters`];
    if (schema.maxLength !== undefined && length > schema.maxLength)
      return [`${path}: must not exceed ${schema.maxLength} characters`];
  }
  return schema.enum && !schema.enum.includes(value as string)
    ? [`${path}: unsupported value ${String(value)}`]
    : [];
}

// Accessors are used only after validating the complete JSON contract.
export const records = (value: JsonValue | undefined): JsonRecord[] =>
  (value ?? []) as JsonRecord[];
export const strings = (value: JsonValue | undefined): string[] =>
  (value ?? []) as string[];
export const rec = (value: JsonValue | undefined): JsonRecord =>
  value as JsonRecord;

/** Provider wire schemas require nullable optionals; canonical records omit them. */
export function strictWireSchema(schema: Schema): Schema {
  if ('anyOf' in schema) return { anyOf: schema.anyOf.map(strictWireSchema) };
  if (schema.type === 'array')
    return { ...schema, items: strictWireSchema(schema.items) };
  if (schema.type !== 'object') return schema;
  if (schema.additionalProperties)
    throw new Error('Dynamic indexes are local outputs, not model schemas.');
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(schema.properties),
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, field]) => [
        key,
        schema.required.includes(key)
          ? strictWireSchema(field)
          : { anyOf: [strictWireSchema(field), { type: 'null' }] },
      ]),
    ),
  };
}

export function normalizeWireValue(value: unknown, schema: Schema): unknown {
  if ('anyOf' in schema) {
    const choices = schema.anyOf.map((candidate) => ({
      candidate,
      normalized: normalizeWireValue(value, candidate),
    }));
    return (
      choices.find(
        ({ candidate, normalized }) =>
          validateSchema(normalized, candidate).length === 0,
      )?.normalized ?? value
    );
  }
  if (schema.type === 'array' && Array.isArray(value))
    return value.map((item: unknown) => normalizeWireValue(item, schema.items));
  if (
    schema.type !== 'object' ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, field]) =>
          !(
            field === null &&
            Object.hasOwn(schema.properties, key) &&
            !schema.required.includes(key)
          ),
      )
      .map(([key, field]) => [
        key,
        schema.properties[key]
          ? normalizeWireValue(field, schema.properties[key])
          : field,
      ]),
  );
}

export function parseContract<T>(value: unknown, schema: Schema): T {
  const errors = validateSchema(value, schema);
  if (errors.length) throw new Error(errors.join('\n'));
  return value as T;
}

export type * from './contracts/domain.js';
