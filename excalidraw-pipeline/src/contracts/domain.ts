/** Domain contracts transcribed from docs/excalidraw.md, Parts II–III. */
export type MessageId = string;
export type KnowledgeObjectId = string;
export type AnnotationId = string;
export type KnowledgeRelationshipId = string;
export type GraphNodeId = string;
export type GraphEdgeId = string;
export type ConversationId = string;
export type AgentId = 'red' | 'yellow' | 'green' | 'blue';
export type Speaker = 'user' | AgentId | 'system' | 'other';
export interface ConversationMessage {
  id: MessageId;
  sequence: number;
  speaker: Speaker;
  content: string;
  timestamp?: string;
  replyToMessageId?: MessageId;
}
export interface ConversationInput {
  conversationId: ConversationId;
  messages: ConversationMessage[];
  snapshotSequence: number;
}
export type KnowledgeOrigin =
  'user_explicit' | 'agent_explicit' | 'conversation_inferred';
export interface SourceRef {
  messageId: MessageId;
  excerpt?: string;
}
export interface KnowledgeObjectBase {
  id: KnowledgeObjectId;
  kind: KnowledgeObjectKind;
  title: string;
  description: string;
  origin: KnowledgeOrigin;
  sourceRefs: SourceRef[];
}
export type KnowledgeObjectKind =
  | 'goal'
  | 'requirement'
  | 'constraint'
  | 'context_fact'
  | 'decision'
  | 'proposal'
  | 'risk'
  | 'assumption'
  | 'open_question'
  | 'implementation_entity';
export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'unspecified';
export interface Goal extends KnowledgeObjectBase {
  kind: 'goal';
  priority: Priority;
  successCriteria: string[];
  state: 'active' | 'proposed' | 'abandoned' | 'achieved';
  parentGoalId?: KnowledgeObjectId;
}
export type RequirementKind =
  'functional' | 'nonfunctional' | 'quality' | 'policy' | 'other';
export type RequirementState =
  'confirmed' | 'proposed' | 'deferred' | 'removed';
export interface Requirement extends KnowledgeObjectBase {
  kind: 'requirement';
  requirementKind: RequirementKind;
  priority: Priority;
  state: RequirementState;
  acceptanceCriteria: string[];
}
export type ConstraintKind =
  | 'time'
  | 'budget'
  | 'people'
  | 'skill'
  | 'platform'
  | 'legal'
  | 'resource'
  | 'scope'
  | 'compatibility'
  | 'other';
export type Flexibility = 'hard' | 'soft' | 'unknown';
export interface Constraint extends KnowledgeObjectBase {
  kind: 'constraint';
  constraintKind: ConstraintKind;
  flexibility: Flexibility;
  expression: string;
  value?: number | string;
  unit?: string;
  appliesToObjectIds: KnowledgeObjectId[];
}
export type FactVerification =
  | 'user_reported'
  | 'agent_claimed'
  | 'externally_verified'
  | 'unverified'
  | 'disputed';
export interface ContextFact extends KnowledgeObjectBase {
  kind: 'context_fact';
  statement: string;
  verification: FactVerification;
  status: 'current' | 'disputed' | 'outdated' | 'unknown';
}
export type DecisionCategory =
  | 'architecture'
  | 'feature'
  | 'workflow'
  | 'strategy'
  | 'resource'
  | 'schedule'
  | 'product'
  | 'other';
export type DecisionState = 'open' | 'resolved' | 'deferred' | 'superseded';
export type OptionDisposition =
  | 'selected'
  | 'explicitly_rejected'
  | 'not_selected'
  | 'considered'
  | 'deferred'
  | 'withdrawn';
export type DecisionAuthority =
  'explicit_user' | 'delegated_by_user' | 'not_decided';
export interface DecisionOptionRef {
  proposalId: KnowledgeObjectId;
  disposition: OptionDisposition;
  dispositionSourceRefs: SourceRef[];
}
export interface DecisionChange {
  sequence: number;
  selectedProposalId?: KnowledgeObjectId;
  selectedProposalIds?: KnowledgeObjectId[];
  changeType: 'proposed' | 'selected' | 'revoked' | 'deferred' | 'superseded';
  authority: DecisionAuthority;
  sourceRefs: SourceRef[];
}
export interface Decision extends KnowledgeObjectBase {
  kind: 'decision';
  question: string;
  category: DecisionCategory;
  state: DecisionState;
  options: DecisionOptionRef[];
  selectedProposalId?: KnowledgeObjectId;
  selectionMode?: 'single' | 'multiple';
  selectedProposalIds?: KnowledgeObjectId[];
  authority: DecisionAuthority;
  history: DecisionChange[];
  unresolvedReason?: string;
}
export type ProposalState = 'active' | 'withdrawn' | 'superseded';
export interface Proposal extends KnowledgeObjectBase {
  kind: 'proposal';
  proposedBy: Speaker[];
  state: ProposalState;
  intendedBenefit?: string;
  tradeoffs: string[];
}
export type RiskSeverity = 'low' | 'medium' | 'high' | 'unknown';
export type RiskLikelihood = 'low' | 'medium' | 'high' | 'unknown';
export interface Risk extends KnowledgeObjectBase {
  kind: 'risk';
  severity: RiskSeverity;
  likelihood: RiskLikelihood;
  impact: string;
  mitigation?: string;
  affectedObjectIds: KnowledgeObjectId[];
}
export type AssumptionState =
  'unverified' | 'supported' | 'challenged' | 'disproven';
export interface Assumption extends KnowledgeObjectBase {
  kind: 'assumption';
  statement: string;
  state: AssumptionState;
  validationNeeded?: string;
}
export type QuestionState = 'open' | 'answered' | 'deferred';
export interface OpenQuestion extends KnowledgeObjectBase {
  kind: 'open_question';
  question: string;
  state: QuestionState;
  blocking: boolean | 'unknown';
  relatedObjectIds: KnowledgeObjectId[];
  answerSourceRefs: SourceRef[];
}
export type ImplementationSubtype =
  | 'component'
  | 'technology'
  | 'workflow'
  | 'interface'
  | 'task'
  | 'data_entity';
export type AdoptionState =
  'confirmed' | 'proposed' | 'rejected' | 'deferred' | 'superseded';
export interface ImplementationEntityBase extends KnowledgeObjectBase {
  kind: 'implementation_entity';
  subtype: ImplementationSubtype;
  adoptionState: AdoptionState;
}
export interface ComponentEntity extends ImplementationEntityBase {
  subtype: 'component';
  responsibility?: string;
  boundaryDescription?: string;
}
export interface TechnologyEntity extends ImplementationEntityBase {
  subtype: 'technology';
  technologyName: string;
  version?: string;
  intendedUse?: string;
}
export interface WorkflowStep {
  stepId: string;
  label: string;
  order: number;
  actorOrComponentId?: KnowledgeObjectId;
  sourceRefs: SourceRef[];
}
export interface WorkflowEntity extends ImplementationEntityBase {
  subtype: 'workflow';
  trigger?: string;
  steps: WorkflowStep[];
  outcome?: string;
}
export interface InterfaceEntity extends ImplementationEntityBase {
  subtype: 'interface';
  contractType?: 'api' | 'event' | 'message' | 'data_exchange' | 'other';
  protocol?: string;
  endpointOrTopic?: string;
}
export interface TaskEntity extends ImplementationEntityBase {
  subtype: 'task';
  intendedAction: string;
  owner?: string;
  explicitlyStatedDeadline?: string;
  completionState:
    'proposed' | 'committed' | 'in_progress' | 'done' | 'cancelled';
}
export interface DataEntity extends ImplementationEntityBase {
  subtype: 'data_entity';
  dataDescription?: string;
  fieldsMentioned: string[];
  storageOrFormat?: string;
}
export type ImplementationEntity =
  | ComponentEntity
  | TechnologyEntity
  | WorkflowEntity
  | InterfaceEntity
  | TaskEntity
  | DataEntity;
export type KnowledgeObject =
  | Goal
  | Requirement
  | Constraint
  | ContextFact
  | Decision
  | Proposal
  | Risk
  | Assumption
  | OpenQuestion
  | ImplementationEntity;
export type Stance =
  'support' | 'oppose' | 'conditional' | 'neutral' | 'concern' | 'question';
export type AnnotationState = 'current' | 'revised' | 'withdrawn';
export interface AgentAnnotation {
  id: AnnotationId;
  agent: AgentId;
  targetObjectId: KnowledgeObjectId;
  stance: Stance;
  reasoning: string;
  conditions: string[];
  sourceRefs: SourceRef[];
  state: AnnotationState;
  revisesAnnotationId?: AnnotationId;
}
export type KnowledgeRelation =
  | 'part_of'
  | 'supports'
  | 'conflicts_with'
  | 'constrains'
  | 'satisfies'
  | 'depends_on'
  | 'selects'
  | 'rejects'
  | 'addresses'
  | 'implements'
  | 'uses'
  | 'communicates_with'
  | 'precedes'
  | 'produces'
  | 'affects';
export type RelationshipOrigin = KnowledgeOrigin;
export interface KnowledgeRelationship {
  id: KnowledgeRelationshipId;
  sourceObjectId: KnowledgeObjectId;
  targetObjectId: KnowledgeObjectId;
  relation: KnowledgeRelation;
  origin: RelationshipOrigin;
  sourceRefs: SourceRef[];
  description?: string;
}
export type WarningSeverity = 'info' | 'warning' | 'error';
export type WarningKind =
  | 'ambiguity'
  | 'contradiction'
  | 'unsupported_claim'
  | 'missing_information'
  | 'invalid_reference'
  | 'incomplete_extraction'
  | 'other';
export interface ExtractionWarning {
  id: string;
  kind: WarningKind;
  severity: WarningSeverity;
  message: string;
  relatedObjectIds: KnowledgeObjectId[];
  sourceRefs: SourceRef[];
}
export interface ConversationKnowledgeGraph {
  schemaVersion: string;
  conversationId: ConversationId;
  snapshotSequence: number;
  objects: KnowledgeObject[];
  annotations: AgentAnnotation[];
  relationships: KnowledgeRelationship[];
  warnings: ExtractionWarning[];
}
export type NodeAnnotationAssociation = 'direct' | 'inherited';
export interface NodeAnnotationRef {
  annotationId: AnnotationId;
  association: NodeAnnotationAssociation;
  viaObjectIds: KnowledgeObjectId[];
}
export interface GraphNodeBase {
  id: GraphNodeId;
  title: string;
  description: string;
  primaryObjectId?: KnowledgeObjectId;
  justifiedByObjectIds: KnowledgeObjectId[];
  annotations: NodeAnnotationRef[];
}
export type EdgeOrigin =
  'conversation_explicit' | 'knowledge_derived' | 'planner_derived';
export interface GraphEdgeBase {
  id: GraphEdgeId;
  sourceNodeId: GraphNodeId;
  targetNodeId: GraphNodeId;
  primaryRelationshipId?: KnowledgeRelationshipId;
  justifiedByObjectIds: KnowledgeObjectId[];
  origin: EdgeOrigin;
  description?: string;
}
export type DecisionNodeType = 'group' | 'decision' | 'option';
export interface DecisionGraphNode extends GraphNodeBase {
  nodeType: DecisionNodeType;
}
export type DecisionEdgeRelation =
  'contains' | 'has_option' | 'depends_on' | 'influences';
export interface DecisionGraphEdge extends GraphEdgeBase {
  relation: DecisionEdgeRelation;
}
export interface DecisionGraph {
  nodes: DecisionGraphNode[];
  edges: DecisionGraphEdge[];
}
export type ImplementationNodeType =
  'group' | ImplementationSubtype | 'milestone';
export type PlanOrigin =
  | 'conversation_explicit'
  | 'decision_derived'
  | 'planner_derived'
  | 'planner_suggested';
export type PlanStatus = 'confirmed' | 'proposed' | 'undecided' | 'deferred';
export interface ImplementationGraphNode extends GraphNodeBase {
  nodeType: ImplementationNodeType;
  origin: PlanOrigin;
  status: PlanStatus;
}
export type ImplementationEdgeRelation =
  | 'contains'
  | 'uses'
  | 'communicates_with'
  | 'depends_on'
  | 'implements'
  | 'precedes'
  | 'produces';
export interface ImplementationGraphEdge extends GraphEdgeBase {
  relation: ImplementationEdgeRelation;
}
export interface ImplementationGraph {
  nodes: ImplementationGraphNode[];
  edges: ImplementationGraphEdge[];
}
export type CrossLinkKind = 'primary_shared_object' | 'justification';
export interface CrossGraphLink {
  decisionNodeId: GraphNodeId;
  implementationNodeId: GraphNodeId;
  viaKnowledgeObjectId: KnowledgeObjectId;
  kind: CrossLinkKind;
}
export interface CrossGraphLinkIndex {
  links: CrossGraphLink[];
  byDecisionNodeId: Record<GraphNodeId, CrossGraphLink[]>;
  byImplementationNodeId: Record<GraphNodeId, CrossGraphLink[]>;
}
export interface ValidationIssue {
  code: string;
  severity: WarningSeverity;
  message: string;
  objectOrGraphIds: string[];
}
export interface ValidationReport {
  passed: boolean;
  issues: ValidationIssue[];
}
export interface Step1Result {
  knowledgeGraph?: ConversationKnowledgeGraph;
  validationReport: ValidationReport;
}
export interface ValidatedPlanningGraphs {
  schemaVersion: string;
  conversationId: ConversationId;
  knowledgeSnapshotSequence: number;
  decisionGraph: DecisionGraph;
  implementationGraph: ImplementationGraph;
  crossGraphLinks: CrossGraphLinkIndex;
  warnings: ValidationIssue[];
}
export interface Step2Result {
  planningGraphs?: ValidatedPlanningGraphs;
  validationReport: ValidationReport;
}
export interface FinalOrchestratorResult {
  knowledgeGraph?: ConversationKnowledgeGraph;
  planningGraphs?: ValidatedPlanningGraphs;
  step1Report: ValidationReport;
  step2Report?: ValidationReport;
}
