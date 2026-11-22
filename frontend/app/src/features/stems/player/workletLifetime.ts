/** Native worklets can outlive a closed context. Never leave JS owners on them. */
export function disposeWorkletNode(node: AudioWorkletNode, release: () => void) {
  node.onprocessorerror = null;
  // Clear callbacks before releasing: even a failed teardown must break the
  // native pending-activity -> listener -> decoded song retention chain.
  node.port.onmessage = null;
  node.port.onmessageerror = null;
  try { release(); }
  finally {
    try { node.disconnect(); }
    finally { node.port.close(); }
  }
}
