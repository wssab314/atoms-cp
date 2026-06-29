const MESSAGE_NAMESPACE = 'atoms-cp';

type InspectorCommand =
  | { type: 'INSPECTOR_ENABLE' }
  | { type: 'INSPECTOR_DISABLE' }
  | { type: 'INSPECTOR_HIGHLIGHT'; aiId?: string };

let inspectorEnabled = false;

function selectedElementPayload(element: HTMLElement) {
  return {
    aiId: element.dataset.aiId ?? '',
    tagName: element.tagName.toLowerCase(),
    text: safeText(element),
    className: String(element.className ?? '').slice(0, 120)
  };
}

function safeText(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return '';
  }

  return (element.textContent ?? '').trim().slice(0, 160);
}

function findTargetElement(eventTarget: EventTarget | null): HTMLElement | null {
  if (!(eventTarget instanceof Element)) {
    return null;
  }

  return eventTarget.closest<HTMLElement>('[data-ai-id]');
}

window.addEventListener('message', (event: MessageEvent<InspectorCommand>) => {
  if (!event.data || typeof event.data !== 'object') {
    return;
  }

  if (event.data.type === 'INSPECTOR_ENABLE') {
    inspectorEnabled = true;
  }

  if (event.data.type === 'INSPECTOR_DISABLE') {
    inspectorEnabled = false;
  }
});

document.addEventListener('click', (event) => {
  if (!inspectorEnabled) {
    return;
  }

  const target = findTargetElement(event.target);
  if (!target) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  window.parent.postMessage(
    {
      type: `${MESSAGE_NAMESPACE}:preview-element-selected`,
      payload: selectedElementPayload(target)
    },
    '*'
  );
});
