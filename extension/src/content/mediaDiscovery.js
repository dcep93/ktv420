export async function waitForSingleCaptureTarget(timeoutMs = 1000) {
  const deadline = performance.now() + timeoutMs;
  let lastTargets = [];

  while (performance.now() <= deadline) {
    lastTargets = discoverCaptureTargets();

    if (lastTargets.length === 1) {
      return lastTargets[0];
    }

    if (lastTargets.length > 1) {
      throw new Error(`Expected one Spotify media element, found ${lastTargets.length}.`);
    }

    await delay(50);
  }

  throw new Error(`No usable Spotify media element found after ${timeoutMs}ms.`);
}

export function discoverCaptureTargets(rootWindow = window) {
  const contexts = collectAccessibleContexts(rootWindow);
  const elements = [];

  for (const context of contexts) {
    elements.push(...collectMediaElements(context.document));
  }

  return elements.filter(isUsableCaptureTarget);
}

export function getMediaSource(element) {
  return element?.currentSrc || element?.src || "";
}

export function isUsableCaptureTarget(element) {
  const mediaWindow = element?.ownerDocument?.defaultView;
  if (!mediaWindow || !(element instanceof mediaWindow.HTMLMediaElement)) {
    return false;
  }

  return Boolean(getMediaSource(element)) &&
    Number.isFinite(element.duration) &&
    element.duration > 0 &&
    element.readyState >= 1 &&
    element.muted === false &&
    element.volume > 0 &&
    element.playbackRate > 0;
}

function collectAccessibleContexts(rootWindow) {
  const contexts = [];
  const seen = new Set();

  const visit = (contextWindow) => {
    if (!contextWindow || seen.has(contextWindow)) {
      return;
    }

    seen.add(contextWindow);

    let doc;
    try {
      doc = contextWindow.document;
    } catch {
      return;
    }

    if (!doc) {
      return;
    }

    contexts.push({ window: contextWindow, document: doc });

    for (const frame of doc.querySelectorAll("iframe, frame")) {
      try {
        visit(frame.contentWindow);
      } catch {
        // Cross-origin frames are intentionally ignored.
      }
    }
  };

  visit(rootWindow);
  return contexts;
}

function collectMediaElements(rootNode) {
  const elements = [];
  const visitRoot = (node) => {
    if (!node) {
      return;
    }

    const ownerDocument = node.ownerDocument || (node.nodeType === Node.DOCUMENT_NODE ? node : document);
    const ownerWindow = ownerDocument.defaultView || window;

    if (node instanceof ownerWindow.HTMLMediaElement) {
      elements.push(node);
    }

    if (node.querySelectorAll) {
      elements.push(...node.querySelectorAll("audio, video"));
    }

    const walker = ownerDocument.createTreeWalker(node, ownerWindow.NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode;
    while (current) {
      if (current.shadowRoot) {
        visitRoot(current.shadowRoot);
      }
      current = walker.nextNode();
    }
  };

  visitRoot(rootNode);
  return Array.from(new Set(elements));
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
