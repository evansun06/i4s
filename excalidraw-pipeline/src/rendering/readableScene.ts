import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import {
  knowledgeSchema,
  planningGraphsSchema,
  parseContract,
  normalizeWireValue,
} from '../contracts.js';
import type {
  ConversationKnowledgeGraph,
  ValidatedPlanningGraphs,
  ImplementationGraphNode,
} from '../contracts/domain.js';
import { wrapText, textHeight, renderingConfig as cfg } from './config.js';
import {
  elementId,
  rectangle,
  textElement,
  arrowElement,
  bindText,
} from './excalidrawAdapter.js';
import type {
  SceneElement,
  Shape,
  ExcalidrawScene,
  Point,
} from './excalidrawAdapter.js';
import { validatePresentation } from './presentation.js';
import type {
  PresentationPlan,
  PresentationNode,
  MapPresentation,
} from './presentation.js';

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
export function normalizeRenderingInputs(
  planningInput: unknown,
  knowledgeInput: unknown,
) {
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
  return { graphs, knowledge };
}

type Name = 'decision' | 'implementation';
type Line = { text: string; size: number; color: string; role: string };
type Card = {
  node: PresentationNode;
  lines: Line[];
  height: number;
  width: number;
  state: string;
  states: Record<string, string>;
  outcomes: string[];
};

/** Two explanatory maps only. Complete evidence stays in the source JSON, not on the canvas. */
export async function buildReadableScene(
  planningInput: unknown,
  knowledgeInput: unknown,
  presentationInput: PresentationPlan,
): Promise<ExcalidrawScene> {
  const { graphs, knowledge } = normalizeRenderingInputs(
    planningInput,
    knowledgeInput,
  );
  const presentation = validatePresentation(
    presentationInput,
    graphs,
    knowledge,
  );
  const objects = new Map(knowledge.objects.map((o) => [o.id, o]));
  const elements: SceneElement[] = [];
  const warnings: string[] = [];
  function addText(
    id: string,
    text: string,
    x: number,
    y: number,
    width: number,
    size: number,
    color: string,
    metadata: Record<string, unknown>,
  ) {
    const wrapped = wrapText(text, width, size);
    const element = textElement(
      id,
      wrapped,
      x,
      y,
      width,
      textHeight(wrapped, size),
      size,
      color,
      metadata,
    );
    elements.push(element);
    return element;
  }
  function makeCard(node: PresentationNode, name: Name, width: number): Card {
    const source = node.sourceNodeIds.map((id) =>
      (name === 'decision'
        ? graphs.decisionGraph
        : graphs.implementationGraph
      ).nodes.find((n) => n.id === id)!,
    );
    const outcomes: string[] = [];
    const states: Record<string, string> = {};
    const choices = new Map<string, string[]>();
    if (name === 'decision') {
      for (const node of source) {
        const decision = objects.get(node.primaryObjectId ?? '');
        if (decision?.kind !== 'decision')
          throw new Error(`Missing canonical decision for ${node.id}.`);
        states[node.id] = decision.state;
        const selected: string[] = [];
        for (const option of decision.options.filter(
          (o) => o.disposition === 'selected',
        )) {
          const title = objects.get(option.proposalId)?.title;
          if (title) {
            selected.push(title);
            if (!outcomes.includes(title)) outcomes.push(title);
          }
        }
        choices.set(node.id, selected);
      }
    } else
      for (const node of source)
        states[node.id] = (node as ImplementationGraphNode).status;
    const distinct = [...new Set(Object.values(states))];
    const state = distinct.length > 1 ? 'mixed' : distinct[0]!;
    const lines: Line[] = [
      { text: node.label, size: 26, color: cfg.colors.ink, role: 'node-text' },
    ];
    if (state === 'mixed') {
      const labels: Record<string, string> = {
        confirmed: 'Confirmed',
        proposed: 'Suggested — not confirmed',
        undecided: 'Undecided',
        deferred: 'Deferred',
        resolved: 'Resolved',
        open: 'Open',
        superseded: 'Superseded',
      };
      for (const node of source) {
        const selected = choices.get(node.id) ?? [];
        lines.push({
          text: `${node.title}: ${labels[states[node.id]!] ?? states[node.id]}${selected.length ? ` — Chosen: ${selected.join('; ')}` : ''}`,
          size: 18,
          color: cfg.colors.muted,
          role: 'node-item-status',
        });
      }
    } else if (name === 'decision')
      lines.push({
        text:
          state === 'resolved'
            ? outcomes.length
              ? `Chosen: ${outcomes.join('; ')}`
              : 'Decision resolved'
            : state === 'open'
              ? 'Still open'
              : state === 'deferred'
                ? 'Deferred / not decided for now'
                : 'Previous decision',
        size: 18,
        color: state === 'resolved' ? cfg.colors.green : cfg.colors.amber,
        role: 'node-outcome',
      });
    else if (state !== 'confirmed')
      lines.push({
        text:
          state === 'proposed'
            ? 'Suggested work — not yet confirmed'
            : state === 'undecided'
              ? 'Still open'
              : 'For later',
        size: 18,
        color: state === 'proposed' ? cfg.colors.blue : cfg.colors.amber,
        role: 'node-status',
      });
    lines.push({
      text: node.description,
      size: 22,
      color: cfg.colors.ink,
      role: 'node-description',
    });
    if (node.reason.trim())
      lines.push({
        text: `Why: ${node.reason}`,
        size: 20,
        color: cfg.colors.muted,
        role: 'node-rationale',
      });
    return {
      node,
      lines,
      width,
      state,
      states,
      outcomes,
      height:
        36 +
        lines.reduce(
          (height, line) =>
            height +
            textHeight(wrapText(line.text, width - 36, line.size), line.size) +
            8,
          0,
        ) -
        8,
    };
  }
  function drawCard(card: Card, name: Name, x: number, y: number): Shape {
    const open = [
      'open',
      'deferred',
      'undecided',
      'superseded',
      'mixed',
    ].includes(card.state);
    const color = open
      ? cfg.colors.amber
      : name === 'decision'
        ? cfg.colors.purple
        : card.state === 'confirmed'
          ? cfg.colors.green
          : cfg.colors.blue;
    const fill = open
      ? cfg.fills.amber
      : name === 'decision'
        ? cfg.fills.purple
        : card.state === 'confirmed'
          ? cfg.fills.green
          : cfg.fills.blue;
    const id = elementId(name, 'card', card.node.id);
    const metadata = {
      graph: name,
      graphNodeId: card.node.sourceNodeIds[0],
      sourceNodeIds: card.node.sourceNodeIds,
      annotationIds: card.node.annotationIds,
      canonicalState: card.state,
      canonicalStates: card.states,
      canonicalOutcomes: card.outcomes,
      section: 'overview',
    };
    const shape = rectangle(
      id,
      x,
      y,
      card.width,
      card.height,
      color,
      fill,
      { ...metadata, role: 'node', note: card.node.note },
      open || card.state === 'proposed',
    );
    shape.groupIds = [id + '_group'];
    elements.push(shape);
    let lineY = y + 18;
    for (const [i, line] of card.lines.entries()) {
      const label = addText(
        `${id}_line_${i}`,
        line.text,
        x + 18,
        lineY,
        card.width - 36,
        line.size,
        line.color,
        { ...metadata, role: line.role },
      );
      label.groupIds = [...shape.groupIds];
      if (i === 0) bindText(shape, label);
      lineY += label.height + 8;
    }
    return shape;
  }
  function connect(
    name: Name,
    id: string,
    source: Shape,
    target: Shape,
    points: Point[],
    metadata: Record<string, unknown>,
    label = '',
    labelPoint?: Point,
  ) {
    const arrow = arrowElement(
      elementId(name, 'arrow', id),
      points,
      source,
      target,
      cfg.colors.muted,
      false,
      { graph: name, section: 'overview', role: 'edge', ...metadata },
    );
    elements.push(arrow);
    if (label.trim()) {
      const point = labelPoint ?? points[Math.floor(points.length / 2)]!;
      const text = addText(
        `${arrow.id}_label`,
        label,
        point.x,
        point.y,
        240,
        18,
        cfg.colors.muted,
        { graph: name, section: 'overview', role: 'edge-label' },
      );
      bindText(arrow, text);
    }
  }
  async function mapScene(
    name: Name,
    plan: MapPresentation,
    offset: number,
  ): Promise<{ width: number; height: number }> {
    // Endpoints belong to code, not the model. Collapse self/parallel arrows after grouping.
    const owner = new Map(
      plan.nodes.flatMap((n) =>
        n.sourceNodeIds.map((id) => [id, n.id] as const),
      ),
    );
    const selected = new Map<
      string,
      {
        sourceNodeId: string;
        targetNodeId: string;
        label: string;
        sourceEdgeIds: string[];
      }
    >();
    for (const edge of plan.edges) {
      const original = graphs.implementationGraph.edges.find(
        (e) => e.id === edge.sourceEdgeId,
      )!;
      const sourceNodeId = owner.get(original.sourceNodeId)!,
        targetNodeId = owner.get(original.targetNodeId)!;
      if (sourceNodeId === targetNodeId) continue;
      const key = JSON.stringify([sourceNodeId, targetNodeId]);
      const existing = selected.get(key);
      if (existing) existing.sourceEdgeIds.push(original.id);
      else
        selected.set(key, {
          sourceNodeId,
          targetNodeId,
          label: edge.label,
          sourceEdgeIds: [original.id],
        });
    }
    const edges = [...selected.values()];
    const connected = new Set(
      edges.flatMap((e) => [e.sourceNodeId, e.targetNodeId]),
    );
    const flow = plan.nodes
      .filter((n) =>
        name === 'decision' || !edges.length ? !n.note : connected.has(n.id),
      )
      .map((n) => makeCard(n, name, name === 'decision' ? 660 : 460));
    const flowIds = new Set(flow.map((c) => c.node.id));
    const notes = plan.nodes.filter((n) => !flowIds.has(n.id));
    const region = rectangle(
      elementId(name, 'region'),
      offset,
      0,
      720,
      150,
      '#d3cde2',
      'transparent',
      { role: 'region', graph: name, section: 'overview' },
      true,
    );
    region.locked = true;
    elements.push(region);
    const title = addText(
      elementId(name, 'title'),
      name === 'decision' ? 'Decision Map' : 'Implementation Map',
      offset + 30,
      24,
      660,
      34,
      cfg.colors.ink,
      { role: 'title', graph: name, section: 'overview' },
    );
    const subtitle = addText(
      elementId(name, 'subtitle'),
      plan.heading,
      offset + 30,
      title.y + title.height + 10,
      660,
      20,
      cfg.colors.muted,
      { role: 'subtitle', graph: name, section: 'overview' },
    );
    let y = subtitle.y + subtitle.height + 30;
    const shapes = new Map<string, Shape>();
    if (name === 'decision') {
      if (flow.length > 1) {
        const guide = addText(
          elementId(name, 'reading-guide'),
          'Read top to bottom; arrows guide reading, not dependencies.',
          offset + 30,
          y,
          660,
          18,
          cfg.colors.muted,
          { role: 'reading-guide', graph: name, section: 'overview' },
        );
        y += guide.height + 26;
      }
      for (const [i, card] of flow.entries()) {
        const shape = drawCard(card, name, offset + 30 + (i % 2 ? 4 : 0), y);
        shapes.set(card.node.id, shape);
        const previous = flow[i - 1];
        if (previous) {
          const source = shapes.get(previous.node.id)!;
          connect(
            name,
            `reading-${i}`,
            source,
            shape,
            [
              {
                x: source.x + source.width / 2,
                y: source.y + source.height + 4,
              },
              { x: shape.x + shape.width / 2, y: shape.y - 4 },
            ],
            {
              kind: 'reading-order',
              sourceNodeIds: previous.node.sourceNodeIds,
              targetNodeIds: card.node.sourceNodeIds,
            },
          );
        }
        y += card.height + 58;
      }
    } else if (flow.length) {
      const graph: ElkNode = {
        id: 'implementation',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.spacing.nodeNode': '80',
          'elk.layered.spacing.nodeNodeBetweenLayers': '130',
          'elk.edgeRouting': 'ORTHOGONAL',
        },
        children: flow.map((card) => ({
          id: card.node.id,
          width: card.width,
          height: card.height,
        })),
        edges: edges.map((edge, i) => ({
          id: String(i),
          sources: [edge.sourceNodeId],
          targets: [edge.targetNodeId],
          ...(edge.label.trim()
            ? {
                labels: [
                  {
                    text: edge.label,
                    width: 240,
                    height: textHeight(wrapText(edge.label, 240, 18), 18),
                  },
                ],
              }
            : {}),
        })),
      };
      const laidOut = await new ELK.default().layout(graph);
      region.width = Math.max(720, (laidOut.width ?? 0) + 60);
      for (const node of laidOut.children ?? []) {
        const card = flow.find((c) => c.node.id === node.id)!;
        shapes.set(
          node.id,
          drawCard(card, name, offset + 30 + (node.x ?? 0), y + (node.y ?? 0)),
        );
      }
      for (const edge of laidOut.edges ?? []) {
        const original = edges[Number(edge.id)]!,
          section = edge.sections?.[0];
        if (!section)
          throw new Error('Could not route a selected implementation arrow.');
        const points = [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ].map((p) => ({ x: offset + 30 + p.x, y: y + p.y }));
        const label = edge.labels?.[0];
        connect(
          name,
          edge.id,
          shapes.get(original.sourceNodeId)!,
          shapes.get(original.targetNodeId)!,
          points,
          {
            kind: 'relationship',
            sourceEdgeIds: original.sourceEdgeIds,
            sourceNodeIds: plan.nodes.find(
              (n) => n.id === original.sourceNodeId,
            )!.sourceNodeIds,
            targetNodeIds: plan.nodes.find(
              (n) => n.id === original.targetNodeId,
            )!.sourceNodeIds,
          },
          original.label,
          label
            ? { x: offset + 30 + (label.x ?? 0), y: y + (label.y ?? 0) }
            : undefined,
        );
      }
      y += (laidOut.height ?? 0) + 35;
    }
    if (notes.length) {
      const header = addText(
        elementId(name, 'notes'),
        name === 'decision' ? 'Open choices / later' : 'Scope / open questions',
        offset + 30,
        y,
        region.width - 60,
        23,
        cfg.colors.muted,
        { role: 'notes-header', graph: name, section: 'overview' },
      );
      y += header.height + 20;
      const columns = region.width >= 1080 ? 2 : 1;
      const width = (region.width - 60 - (columns - 1) * 30) / columns;
      for (let i = 0; i < notes.length; i += columns) {
        const cards = notes
          .slice(i, i + columns)
          .map((n) => makeCard(n, name, width));
        for (const [column, card] of cards.entries())
          drawCard(
            card,
            name,
            offset + 30 + column * (width + 30),
            y + column * 3,
          );
        y += Math.max(...cards.map((c) => c.height)) + 26;
      }
    }
    region.height = y + 8;
    return { width: region.width, height: region.height };
  }
  const decision = await mapScene('decision', presentation.decision, 0);
  await mapScene(
    'implementation',
    presentation.implementation,
    decision.width + 100,
  );
  return {
    elements,
    appState: {
      viewBackgroundColor: '#ffffff',
      theme: 'light',
      zoom: { value: 0.7 },
      scrollX: 20,
      scrollY: 20,
    },
    files: {},
    warnings,
  };
}
