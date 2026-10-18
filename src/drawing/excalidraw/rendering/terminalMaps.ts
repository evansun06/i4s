import type { ExcalidrawScene } from './excalidrawAdapter.js';

/** Text projection of the actual rendered scene, never a second model interpretation. */
export function terminalMaps(scene: ExcalidrawScene) {
  return {
    version: 1,
    maps: (['decision', 'implementation'] as const).map((name) => {
      const nodes = scene.elements.filter(
        (element) =>
          element.customData?.graph === name &&
          element.customData.role === 'node',
      );
      const ids = new Set(nodes.map((node) => node.id));
      return {
        name,
        heading: name === 'decision' ? 'Decision Map' : 'Implementation Map',
        cards: nodes.map((node) => {
          const lines = scene.elements
            .filter(
              (element) =>
                element.type === 'text' &&
                (element.containerId === node.id ||
                  element.groupIds.some((id) => node.groupIds.includes(id))),
            )
            .sort((a, b) => a.y - b.y)
            .map((element) =>
              element.type === 'text'
                ? element.text.replace(/\s+/gu, ' ').trim()
                : '',
            );
          return {
            id: node.id,
            label: lines[0] ?? '',
            body: lines.slice(1),
            status:
              typeof node.customData?.canonicalState === 'string'
                ? node.customData.canonicalState
                : 'unknown',
            note: node.customData?.note === true,
          };
        }),
        edges: scene.elements.flatMap((element) => {
          if (
            element.type !== 'arrow' ||
            element.customData?.graph !== name ||
            !element.startBinding ||
            !element.endBinding ||
            !ids.has(element.startBinding.elementId) ||
            !ids.has(element.endBinding.elementId)
          )
            return [];
          const label = scene.elements.find(
            (text) => text.type === 'text' && text.containerId === element.id,
          );
          return [
            {
              source: element.startBinding.elementId,
              target: element.endBinding.elementId,
              label:
                label?.type === 'text'
                  ? label.text.replace(/\s+/gu, ' ').trim()
                  : '',
              kind:
                element.customData.kind === 'reading-order'
                  ? 'reading-order'
                  : 'relationship',
            },
          ];
        }),
      };
    }),
  };
}
