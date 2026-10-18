import {
  decisionGraphSchema,
  implementationGraphSchema,
  validateSchema,
} from '../contracts.js';
import type {
  ConversationKnowledgeGraph,
  DecisionGraph,
  ImplementationGraph,
  Step2Result,
  ValidatedPlanningGraphs,
  ValidationIssue,
} from '../contracts/domain.js';
import { issue, report } from '../common/validation.js';
import { linkPlanningGraphs } from './link.js';
import { reconcilePlanningGraphs } from './reconcile.js';
import {
  validateBuilderAnnotations,
  validatePlanningGraphs,
} from './validate.js';

export function finalizePlanningGraphs(
  knowledge: ConversationKnowledgeGraph,
  decisionDraft: unknown,
  implementationDraft: unknown,
  diagnostics?: (candidate: unknown) => void,
): Step2Result {
  const schemaIssues = [
    ...validateSchema(decisionDraft, decisionGraphSchema, '$.decisionGraph'),
    ...validateSchema(
      implementationDraft,
      implementationGraphSchema,
      '$.implementationGraph',
    ),
  ].map((message) => issue('schema', message));
  if (schemaIssues.length) return { validationReport: report(schemaIssues) };
  const decision = structuredClone(decisionDraft) as DecisionGraph;
  const implementation = structuredClone(
    implementationDraft,
  ) as ImplementationGraph;
  const initialIssues = [
    ...validateBuilderAnnotations(decision.nodes),
    ...validateBuilderAnnotations(implementation.nodes),
  ].map((item) => ({ ...item, severity: 'warning' as const }));
  let linked = linkPlanningGraphs(knowledge, decision, implementation);
  const reconciled = reconcilePlanningGraphs(
    linked.decisionGraph,
    linked.implementationGraph,
    knowledge,
  );
  linked = {
    ...linked,
    decisionGraph: reconciled.decisionGraph,
    implementationGraph: reconciled.implementationGraph,
  };
  if (reconciled.changed)
    linked = linkPlanningGraphs(
      knowledge,
      reconciled.decisionGraph,
      reconciled.implementationGraph,
    );
  const warnings: ValidationIssue[] = knowledge.warnings.map((w) =>
    issue(w.kind, w.message, w.relatedObjectIds, w.severity),
  );
  const planningGraphs: ValidatedPlanningGraphs = {
    schemaVersion: '1.0',
    conversationId: knowledge.conversationId,
    knowledgeSnapshotSequence: knowledge.snapshotSequence,
    ...linked,
    warnings,
  };
  const finalReport = validatePlanningGraphs(planningGraphs, knowledge);
  const validationReport = report([
    ...initialIssues,
    ...warnings,
    ...reconciled.issues,
    ...finalReport.issues,
  ]);
  const coverage = (graph: DecisionGraph | ImplementationGraph) => {
    const used = new Set(
      graph.nodes.flatMap((n) => n.annotations.map((a) => a.annotationId)),
    );
    return {
      totalNodes: graph.nodes.length,
      annotatedNodes: graph.nodes.filter((n) => n.annotations.length > 0)
        .length,
      unannotatedNodeIds: graph.nodes
        .filter((n) => n.annotations.length === 0)
        .map((n) => n.id),
      unassociatedAnnotationIds: knowledge.annotations
        .filter((a) => !used.has(a.id))
        .map((a) => a.id),
    };
  };
  // Diagnostic candidates are never the validated public handoff.
  diagnostics?.({
    validated: validationReport.passed,
    candidate: planningGraphs,
    annotationCoverage: {
      decisionGraph: coverage(planningGraphs.decisionGraph),
      implementationGraph: coverage(planningGraphs.implementationGraph),
    },
    reconciliation: { changed: reconciled.changed, issues: reconciled.issues },
    validationReport,
  });
  if (!validationReport.passed) return { validationReport };
  planningGraphs.warnings = validationReport.issues.filter(
    (i) => i.severity !== 'error',
  );
  return { planningGraphs, validationReport };
}
