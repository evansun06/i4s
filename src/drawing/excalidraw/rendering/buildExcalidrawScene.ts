import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import {
  knowledgeSchema,
  planningGraphsSchema,
  parseContract,
  normalizeWireValue,
} from '../contracts.js';
import type {
  ConversationKnowledgeGraph,
  ValidatedPlanningGraphs,
  KnowledgeObject,
  AgentAnnotation,
  DecisionGraphNode,
  ImplementationGraphNode,
  GraphEdgeBase,
  CrossGraphLink,
} from '../contracts/domain.js';
import { renderingConfig as cfg, wrapText, textHeight } from './config.js';
import { buildReadableScene } from './readableScene.js';
import type { PresentationPlan } from './presentation.js';
import {
  elementId,
  rectangle,
  textElement,
  arrowElement,
  bindText,
} from './excalidrawAdapter.js';
import type {
  ExcalidrawScene,
  SceneElement,
  Point,
  Shape,
} from './excalidrawAdapter.js';

type Node = DecisionGraphNode | ImplementationGraphNode;
type Edge = GraphEdgeBase & { relation: string };
type Graph = { nodes: Node[]; edges: Edge[] };
type Indexes = {
  objects: Map<string, KnowledgeObject>;
  annotations: Map<string, AgentAnnotation>;
  annotationTags: Map<string, string>;
  decisionTags: Map<string, string>;
};
type Card = {
  text: string;
  color: string;
  height: number;
  annotationId: string;
  association: string;
};
type Block = {
  node: Node;
  label: string;
  mainHeight: number;
  height: number;
  cards: Card[];
  references: string[];
  status: string;
  x: number;
  y: number;
};
type Layout = {
  blocks: Map<string, Block>;
  routes: Map<string, Point[]>;
  width: number;
  height: number;
  lanes: { title: string; y: number }[];
};

function unwrap(
  value: unknown,
  field: 'planningGraphs' | 'knowledgeGraph',
): unknown {
  if (!value || typeof value !== 'object') return value;
  if ('validationReport' in value) {
    const report = value.validationReport;
    if (
      !report ||
      typeof report !== 'object' ||
      !('passed' in report) ||
      report.passed !== true
    )
      throw new Error('Step 3 requires successful input validation.');
  }
  return field in value ? (value as Record<string, unknown>)[field] : value;
}

function agentColor(agent: string): string {
  return cfg.colors[agent as 'red' | 'yellow' | 'green' | 'blue'];
}

function annotationText(
  annotation: AgentAnnotation,
  tag: string,
  index: Indexes,
  full: boolean,
): string {
  const state =
    annotation.state === 'revised'
      ? 'PREVIOUS VIEW · revised'
      : annotation.state;
  const revision = annotation.revisesAnnotationId
    ? ` · revises ${index.annotationTags.get(annotation.revisesAnnotationId) ?? annotation.revisesAnnotationId}`
    : '';
  const header = `${tag} · ${annotation.agent.toUpperCase()} · ${annotation.stance} · ${state}${revision}`;
  return full
    ? `${header}\n${annotation.reasoning}${annotation.conditions.length ? `\nConditions: ${annotation.conditions.join('; ')}` : ''}\nSources: ${annotation.sourceRefs.map((r) => r.messageId).join(', ')}`
    : header;
}

function decisionStatus(node: Node, graph: Graph, index: Indexes): string {
  if (node.nodeType === 'group') return 'ORGANIZER';
  const object = index.objects.get(node.primaryObjectId ?? '');
  if (node.nodeType === 'decision')
    return object?.kind === 'decision' ? object.state.toUpperCase() : 'UNKNOWN';
  const states = graph.edges
    .filter((e) => e.relation === 'has_option' && e.targetNodeId === node.id)
    .map((e) => {
      const parent = graph.nodes.find((n) => n.id === e.sourceNodeId);
      const decision = index.objects.get(parent?.primaryObjectId ?? '');
      const option =
        decision?.kind === 'decision'
          ? decision.options.find((o) => o.proposalId === node.primaryObjectId)
          : undefined;
      if (!option)
        throw new Error(
          `Option ${node.id} has no canonical parent disposition.`,
        );
      return `${index.decisionTags.get(e.sourceNodeId)}: ${option.disposition.replaceAll('_', ' ').toUpperCase()}`;
    });
  return states.join(' · ') || 'CONSIDERED';
}

function referencesFor(
  nodeId: string,
  links: CrossGraphLink[],
  graphs: ValidatedPlanningGraphs,
  index: Indexes,
): string[] {
  const byDecision = new Map<string, Set<string>>();
  for (const link of links.filter((l) => l.implementationNodeId === nodeId)) {
    const kinds = byDecision.get(link.decisionNodeId) ?? new Set<string>();
    kinds.add(link.kind);
    byDecision.set(link.decisionNodeId, kinds);
  }
  return [...byDecision]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, kinds]) => {
      const decision = graphs.decisionGraph.nodes.find((n) => n.id === id);
      if (!decision) throw new Error(`Unknown decision reference ${id}.`);
      return `${index.decisionTags.get(id)} · ${decision.title} [${[...kinds].sort().join(', ')}]`;
    });
}

function displayBlocks(
  graph: Graph,
  implementation: boolean,
  graphs: ValidatedPlanningGraphs,
  index: Indexes,
  warnings: string[],
): Map<string, Block> {
  return new Map(
    graph.nodes.map((node, position) => {
      const plan = implementation
        ? (node as ImplementationGraphNode)
        : undefined;
      const status = plan
        ? plan.status.toUpperCase()
        : decisionStatus(node, graph, index);
      const tag = implementation
        ? `I${position + 1}`
        : index.decisionTags.get(node.id)!;
      const origin = plan ? `\n${plan.origin.replaceAll('_', ' ')}` : '';
      const label = wrapText(
        `${tag} · ${node.nodeType}\n${node.title}\n${status}${origin}`,
        cfg.nodeWidth - cfg.padding * 2,
        cfg.fontSize,
      );
      const mainHeight = textHeight(label, cfg.fontSize) + cfg.padding * 2;
      const cards: Card[] = [];
      for (const ref of [
        ...new Map(node.annotations.map((r) => [r.annotationId, r])).values(),
      ]) {
        const annotation = index.annotations.get(ref.annotationId);
        if (!annotation)
          throw new Error(`Unknown annotation ${ref.annotationId}.`);
        const via = ref.viaObjectIds
          .map((id) => index.objects.get(id)?.title ?? id)
          .join(', ');
        const full = ref.association === 'direct';
        const content = `${annotationText(annotation, index.annotationTags.get(annotation.id)!, index, full)}\n${ref.association}${via ? ` · via ${via}` : ''}`;
        const text = wrapText(
          content,
          cfg.nodeWidth - cfg.padding * 2,
          cfg.noteFontSize,
        );
        cards.push({
          text,
          color: agentColor(annotation.agent),
          height: textHeight(text, cfg.noteFontSize) + cfg.padding * 2,
          annotationId: annotation.id,
          association: ref.association,
        });
      }
      const references = implementation
        ? referencesFor(node.id, graphs.crossGraphLinks.links, graphs, index)
        : [];
      const referenceText = wrapText(
        references.length
          ? `Decision references:\n${references.join('\n')}`
          : '',
        cfg.nodeWidth - 12,
        cfg.noteFontSize,
      );
      const referenceHeight = references.length
        ? textHeight(referenceText, cfg.noteFontSize) + 12
        : 0;
      if (plan?.primaryObjectId) {
        const object = index.objects.get(plan.primaryObjectId);
        if (
          object?.kind === 'implementation_entity' &&
          object.adoptionState !== plan.status
        )
          warnings.push(
            `${node.title}: Step 2 status ${plan.status} retained; knowledge adoption state is ${object.adoptionState}.`,
          );
      }
      return [
        node.id,
        {
          node,
          label,
          mainHeight,
          cards,
          references: referenceText ? [referenceText] : [],
          status,
          height:
            mainHeight +
            cards.reduce((sum, c) => sum + c.height + 10, 0) +
            referenceHeight,
          x: 0,
          y: 0,
        },
      ];
    }),
  );
}

async function layoutGraph(
  graph: Graph,
  blocks: Map<string, Block>,
  implementation: boolean,
): Promise<Layout> {
  const routes = new Map<string, Point[]>();
  const lanes: { title: string; y: number }[] = [];
  let width: number = cfg.nodeWidth,
    height = 0;
  const laneNames = implementation
    ? ['Plan', 'Needs decision', 'Later / Deferred']
    : ['Decisions'];
  for (const lane of laneNames) {
    const members = [...blocks.values()].filter((b) => {
      if (!implementation) return true;
      const status = (b.node as ImplementationGraphNode).status;
      return lane === 'Needs decision'
        ? status === 'undecided'
        : lane === 'Later / Deferred'
          ? status === 'deferred'
          : !['undecided', 'deferred'].includes(status);
    });
    if (!members.length) continue;
    if (implementation) {
      lanes.push({ title: lane, y: height });
      height += 46;
    }
    const ids = new Set(members.map((b) => b.node.id));
    const parents = new Set<string>();
    const primary = graph.edges
      .filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId))
      .filter((e) => {
        if (implementation && e.relation === 'precedes') return true;
        if (
          !['contains', ...(implementation ? [] : ['has_option'])].includes(
            e.relation,
          ) ||
          parents.has(e.targetNodeId)
        )
          return false;
        parents.add(e.targetNodeId);
        return true;
      });
    const edges: ElkExtendedEdge[] = primary.map((e) => ({
      id: e.id,
      sources: [`${e.sourceNodeId}:out`],
      targets: [`${e.targetNodeId}:in`],
    }));
    const layout = await new ELK.default().layout<ElkNode>({
      id: lane,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': implementation ? 'RIGHT' : 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': String(cfg.gap),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(cfg.gap + 60),
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      },
      children: members.map((b) => ({
        id: b.node.id,
        width: cfg.nodeWidth,
        height: b.height,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: [
          {
            id: `${b.node.id}:out`,
            x: cfg.nodeWidth,
            y: b.mainHeight / 2,
            width: 0,
            height: 0,
            layoutOptions: { 'elk.port.side': 'EAST' },
          },
          {
            id: `${b.node.id}:in`,
            x: 0,
            y: b.mainHeight / 2,
            width: 0,
            height: 0,
            layoutOptions: { 'elk.port.side': 'WEST' },
          },
        ],
      })),
      edges,
    });
    for (const child of layout.children ?? []) {
      const block = blocks.get(child.id)!;
      block.x = child.x ?? 0;
      block.y = height + (child.y ?? 0);
    }
    for (const edge of layout.edges ?? []) {
      const section = edge.sections?.[0];
      if (section)
        routes.set(
          edge.id,
          [
            section.startPoint,
            ...(section.bendPoints ?? []),
            section.endPoint,
          ].map((p) => ({ x: p.x, y: p.y + height })),
        );
    }
    width = Math.max(width, layout.width ?? 0);
    height += (layout.height ?? 0) + cfg.gap;
  }
  return { blocks, routes, width, height: Math.max(height, 120), lanes };
}

function nodeColors(
  block: Block,
  implementation: boolean,
): { stroke: string; fill: string; dashed: boolean } {
  const status = block.status;
  if (/UNDECIDED|OPEN|DEFERRED/.test(status))
    return {
      stroke: cfg.colors.amber,
      fill: cfg.fills.amber,
      dashed: status.includes('DEFERRED'),
    };
  if (/NOT SELECTED|EXPLICITLY REJECTED|WITHDRAWN/.test(status))
    return {
      stroke: cfg.colors.rejected,
      fill: cfg.fills.rejected,
      dashed: false,
    };
  const type = block.node.nodeType;
  const color = /CONFIRMED|SELECTED/.test(status)
    ? cfg.colors.green
    : !implementation || type === 'group'
      ? cfg.colors.purple
      : type === 'technology'
        ? cfg.colors.green
        : cfg.colors.blue;
  return {
    stroke: color,
    fill: !implementation
      ? cfg.fills.purple
      : type === 'technology'
        ? cfg.fills.green
        : cfg.fills.blue,
    dashed: status === 'PROPOSED',
  };
}

function cardElements(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  fill: string,
  fontSize: number,
  metadata: Record<string, unknown>,
  dashed = false,
): SceneElement[] {
  const shape = rectangle(
    id,
    x,
    y,
    width,
    height,
    color,
    fill,
    metadata,
    dashed,
  );
  const label = textElement(
    `${id}_text`,
    text,
    x + cfg.padding,
    y + cfg.padding,
    width - cfg.padding * 2,
    height - cfg.padding * 2,
    fontSize,
    cfg.colors.ink,
    { ...metadata, role: `${String(metadata.role)}-text` },
  );
  bindText(shape, label);
  return [shape, label];
}

function renderMap(
  layout: Layout,
  graph: Graph,
  implementation: boolean,
  offsetX: number,
  index: Indexes,
): { elements: SceneElement[]; width: number; height: number } {
  const name = implementation ? 'implementation' : 'decision';
  const elements: SceneElement[] = [];
  const shapes = new Map<string, Shape>();
  const top = 150;
  for (const lane of layout.lanes)
    elements.push(
      textElement(
        elementId(name, 'lane', lane.title),
        lane.title,
        offsetX + 36,
        top + lane.y,
        layout.width,
        32,
        22,
        cfg.colors.amber,
        { role: 'lane', graph: name },
      ),
    );
  for (const block of layout.blocks.values()) {
    const { stroke, fill, dashed } = nodeColors(block, implementation);
    const x = offsetX + block.x + 36,
      y = top + block.y;
    const id = elementId(name, 'node', block.node.id);
    const metadata = { graph: name, role: 'node', graphNodeId: block.node.id };
    const nodeElements = cardElements(
      id,
      block.label,
      x,
      y,
      cfg.nodeWidth,
      block.mainHeight,
      stroke,
      fill,
      cfg.fontSize,
      metadata,
      dashed,
    );
    const shape = nodeElements[0] as Shape;
    shapes.set(block.node.id, shape);
    elements.push(...nodeElements);
    let cardY = y + block.mainHeight + 10;
    for (const card of block.cards) {
      elements.push(
        ...cardElements(
          elementId(name, 'note', block.node.id, card.annotationId),
          card.text,
          x,
          cardY,
          cfg.nodeWidth,
          card.height,
          card.color,
          '#ffffff',
          cfg.noteFontSize,
          {
            graph: name,
            role: card.association === 'direct' ? 'annotation' : 'marker',
            graphNodeId: block.node.id,
            annotationId: card.annotationId,
            association: card.association,
          },
        ),
      );
      cardY += card.height + 10;
    }
    if (block.references.length)
      elements.push(
        textElement(
          elementId(name, 'references', block.node.id),
          block.references.join('\n'),
          x + 6,
          cardY,
          cfg.nodeWidth - 12,
          textHeight(block.references.join('\n'), cfg.noteFontSize),
          cfg.noteFontSize,
          cfg.colors.purple,
          {
            graph: name,
            role: 'decision-references',
            graphNodeId: block.node.id,
          },
        ),
      );
  }
  // Draw behind node cards, retaining every original edge, including parallel relations.
  const connectors: SceneElement[] = [];
  for (const [position, edge] of graph.edges.entries()) {
    const source = shapes.get(edge.sourceNodeId),
      target = shapes.get(edge.targetNodeId);
    if (!source || !target)
      throw new Error(`Unknown rendering edge endpoint ${edge.id}.`);
    let points = layout.routes
      .get(edge.id)
      ?.map((p) => ({ x: offsetX + p.x + 36, y: top + p.y }));
    if (!points) {
      const start = {
        x: source.x + source.width + 4,
        y: source.y + source.height / 2,
      };
      const end = { x: target.x - 4, y: target.y + target.height / 2 };
      if (end.x > start.x + 40) {
        const middle = (start.x + end.x) / 2 + (position % 3) * 7;
        points = [
          start,
          { x: middle, y: start.y },
          { x: middle, y: end.y },
          end,
        ];
      } else {
        const gutter = Math.min(source.y, target.y) - 24 - (position % 5) * 12;
        points = [
          start,
          { x: start.x + 24, y: start.y },
          { x: start.x + 24, y: gutter },
          { x: end.x - 24, y: gutter },
          { x: end.x - 24, y: end.y },
          end,
        ];
      }
    }
    const secondary = !layout.routes.has(edge.id);
    const arrow = arrowElement(
      elementId(name, 'edge', edge.id),
      points,
      source,
      target,
      edge.relation === 'precedes' ? cfg.colors.blue : cfg.colors.muted,
      secondary || edge.relation === 'depends_on',
      {
        graph: name,
        role: 'edge',
        graphEdgeId: edge.id,
        relation: edge.relation,
      },
    );
    const midpoint = points[Math.floor(points.length / 2)]!;
    const label = textElement(
      `${arrow.id}_label`,
      edge.relation,
      midpoint.x + 5,
      midpoint.y - 19,
      Math.max(65, edge.relation.length * 8),
      20,
      13,
      cfg.colors.muted,
      { graph: name, role: 'edge-label', graphEdgeId: edge.id },
    );
    bindText(arrow, label);
    connectors.push(arrow, label);
  }
  elements.unshift(...connectors);
  let width = layout.width + 72,
    height = layout.height + top;
  if (!implementation) {
    const x = offsetX + width + 70;
    let y = top;
    elements.push(
      textElement(
        elementId(name, 'details-title'),
        'Agent notes · full source detail',
        x,
        y - 42,
        cfg.detailWidth,
        35,
        20,
        cfg.colors.purple,
        { graph: name, role: 'detail-header' },
      ),
    );
    for (const annotation of index.annotations.values()) {
      const target =
        index.objects.get(annotation.targetObjectId)?.title ??
        annotation.targetObjectId;
      const text = wrapText(
        `${annotationText(annotation, index.annotationTags.get(annotation.id)!, index, true)}\nTarget: ${target}`,
        cfg.detailWidth - cfg.padding * 2,
        cfg.noteFontSize,
      );
      const cardHeight = textHeight(text, cfg.noteFontSize) + cfg.padding * 2;
      elements.push(
        ...cardElements(
          elementId(name, 'detail', annotation.id),
          text,
          x,
          y,
          cfg.detailWidth,
          cardHeight,
          agentColor(annotation.agent),
          '#ffffff',
          cfg.noteFontSize,
          {
            graph: name,
            role: 'annotation-detail',
            annotationId: annotation.id,
          },
        ),
      );
      y += cardHeight + 14;
    }
    width += 70 + cfg.detailWidth;
    height = Math.max(height, y + 40);
  }
  const region = rectangle(
    elementId(name, 'region'),
    offsetX,
    0,
    width,
    height,
    '#c5cad3',
    '#ffffff',
    { graph: name, role: 'region' },
  );
  region.locked = true;
  const title = implementation ? 'Implementation Map' : 'Decision Map';
  const legend = implementation
    ? 'CONFIRMED · PROPOSED · UNDECIDED · DEFERRED\nDerived is a planning origin. Inherited notes are context; A# full text is in the Decision Map.'
    : 'SELECTED · NOT SELECTED · DEFERRED · OPEN\nRED / YELLOW / GREEN / BLUE cards show expressed views. PREVIOUS VIEW preserves history.';
  elements.unshift(
    region,
    textElement(
      elementId(name, 'title'),
      title,
      offsetX + 36,
      24,
      width - 72,
      36,
      28,
      cfg.colors.purple,
      { graph: name, role: 'title' },
    ),
    textElement(
      elementId(name, 'legend'),
      legend,
      offsetX + 36,
      72,
      width - 72,
      58,
      15,
      cfg.colors.muted,
      { graph: name, role: 'legend' },
    ),
  );
  return { elements, width, height };
}

/** Step 3.1: normalize once, deterministic independent layouts, editable native elements. */
export async function buildExcalidrawScene(
  planningInput: unknown,
  knowledgeInput: unknown,
  presentation?: PresentationPlan,
): Promise<ExcalidrawScene> {
  if (presentation)
    return buildReadableScene(planningInput, knowledgeInput, presentation);
  const graphs = parseContract<ValidatedPlanningGraphs>(
    normalizeWireValue(
      unwrap(planningInput, 'planningGraphs'),
      planningGraphsSchema,
    ),
    planningGraphsSchema,
  );
  const knowledge = parseContract<ConversationKnowledgeGraph>(
    normalizeWireValue(
      unwrap(knowledgeInput, 'knowledgeGraph'),
      knowledgeSchema,
    ),
    knowledgeSchema,
  );
  if (graphs.conversationId !== knowledge.conversationId)
    throw new Error('Step 3 conversationId mismatch.');
  if (graphs.knowledgeSnapshotSequence !== knowledge.snapshotSequence)
    throw new Error('Step 3 snapshot sequence mismatch.');
  const index: Indexes = {
    objects: new Map(knowledge.objects.map((o) => [o.id, o])),
    annotations: new Map(knowledge.annotations.map((a) => [a.id, a])),
    annotationTags: new Map(
      knowledge.annotations.map((a, i) => [a.id, `A${i + 1}`]),
    ),
    decisionTags: new Map(
      graphs.decisionGraph.nodes.map((n, i) => [n.id, `D${i + 1}`]),
    ),
  };
  const warnings: string[] = [];
  const decisionBlocks = displayBlocks(
    graphs.decisionGraph,
    false,
    graphs,
    index,
    warnings,
  );
  const implementationBlocks = displayBlocks(
    graphs.implementationGraph,
    true,
    graphs,
    index,
    warnings,
  );
  const [decisionLayout, implementationLayout] = await Promise.all([
    layoutGraph(graphs.decisionGraph, decisionBlocks, false),
    layoutGraph(graphs.implementationGraph, implementationBlocks, true),
  ]);
  const decision = renderMap(
    decisionLayout,
    graphs.decisionGraph,
    false,
    0,
    index,
  );
  const implementation = renderMap(
    implementationLayout,
    graphs.implementationGraph,
    true,
    decision.width + cfg.mapGap,
    index,
  );
  return {
    elements: [...decision.elements, ...implementation.elements],
    appState: { viewBackgroundColor: '#ffffff', theme: 'light' },
    files: {},
    warnings,
  };
}
