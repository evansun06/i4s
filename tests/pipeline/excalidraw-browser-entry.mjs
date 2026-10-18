// Browser-only import/edit smoke test for the pinned official Excalidraw package.
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Excalidraw,
  loadFromBlob,
  convertToExcalidrawElements,
  mutateElement,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

async function verify() {
  const document = globalThis.document;
  const original = JSON.parse(document.getElementById('scene').textContent);
  const restored = await loadFromBlob(
    new File([JSON.stringify(original)], 'project-plan.excalidraw', {
      type: 'application/json',
    }),
    null,
    null,
  );
  if (restored.elements.length !== original.elements.length)
    throw new Error('Official Excalidraw import dropped elements.');
  const api = await new Promise((resolve) => {
    createRoot(document.getElementById('root')).render(
      React.createElement(Excalidraw, {
        initialData: restored,
        excalidrawAPI: resolve,
      }),
    );
  });
  await new Promise((resolve) =>
    globalThis.requestAnimationFrame(() =>
      globalThis.requestAnimationFrame(resolve),
    ),
  );
  const elements = api.getSceneElements();
  const handwritten = elements.filter(
    (e) => e.type === 'text' && e.fontFamily === 5,
  );
  if (handwritten.length)
    await document.fonts.load(
      '20px Excalifont',
      handwritten.map((e) => e.text).join(' '),
    );
  const boxes = elements
    .filter((e) => e.type === 'rectangle' && e.customData?.role === 'node')
    .slice(0, 2);
  const label = elements.find(
    (e) => e.type === 'text' && e.customData?.role === 'node-text',
  );
  const arrow = elements.find((e) => e.type === 'arrow');
  if (boxes.length !== 2 || !label || !arrow)
    throw new Error('Native editable scene objects missing.');
  const before = boxes.map((e) => e.width);
  for (const box of boxes) mutateElement(box, { width: box.width + 12 });
  const originalText = label.text;
  mutateElement(label, {
    text: `${label.text}\nEdit check`,
    originalText: `${label.originalText}\nEdit check`,
  });
  mutateElement(arrow, { strokeColor: '#7c3aed' });
  api.updateScene({ elements: [...elements] });
  const edited = api.getSceneElements();
  if (
    !boxes.every(
      (b, i) => edited.find((e) => e.id === b.id).width === before[i] + 12,
    ) ||
    !edited.find((e) => e.id === label.id).text.includes('Edit check') ||
    edited.find((e) => e.id === arrow.id).strokeColor !== '#7c3aed'
  )
    throw new Error('Native element editing failed.');
  // Restore the inspection scene; the generated disk artifact is never changed.
  for (const [i, box] of boxes.entries())
    mutateElement(box, { width: before[i] });
  mutateElement(label, { text: originalText, originalText });
  api.updateScene({ elements: [...elements] });
  const overview = elements.filter(
    (element) => element.customData?.section === 'overview',
  );
  api.scrollToContent(overview.length ? overview : undefined, {
    fitToContent: true,
  });
  const fixture = convertToExcalidrawElements([
    {
      type: 'rectangle',
      id: 'official-box-a',
      x: 10,
      y: 10,
      width: 160,
      height: 100,
      label: { text: 'Official fixture' },
    },
    {
      type: 'rectangle',
      id: 'official-box-b',
      x: 300,
      y: 10,
      width: 160,
      height: 100,
    },
    {
      type: 'arrow',
      id: 'official-arrow',
      x: 170,
      y: 60,
      points: [
        [0, 0],
        [130, 0],
      ],
      start: { id: 'official-box-a' },
      end: { id: 'official-box-b' },
    },
  ]);
  return {
    passed: true,
    importedElements: elements.length,
    editedBoxes: boxes.length,
    editedText: true,
    editedConnector: true,
    handwrittenFontLoaded: [...document.fonts].some(
      (font) => font.family === 'Excalifont' && font.status === 'loaded',
    ),
    fixture: {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: fixture,
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    },
  };
}

verify()
  .then((report) => {
    globalThis.document.getElementById('result').textContent = globalThis.btoa(
      JSON.stringify(report),
    );
  })
  .catch((error) => {
    globalThis.document.getElementById('result').textContent = globalThis.btoa(
      JSON.stringify({ passed: false, error: String(error) }),
    );
  });
