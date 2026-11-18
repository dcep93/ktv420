export type CaptureStatus = {
  request: { id: string; trackId?: string; state: string; error: string } | null;
};

/** Subscribe before starting: completion can arrive before the request response. */
export function captureStatusInbox<T extends CaptureStatus>(target: EventTarget) {
  let latest: T | undefined, wake: (() => void) | undefined;
  const changed = (event: Event) => {
    const value = (event as CustomEvent<T>).detail;
    if (!value?.request?.id) return;
    latest = value;
    wake?.();
  };
  target.addEventListener('ktv420:spotify-status', changed);
  return {
    take(id: string) { const value = latest; latest = undefined; return value?.request?.id === id ? value : undefined; },
    wait() {
      if (latest) return Promise.resolve();
      return new Promise<void>(resolve => {
        const timer = setTimeout(() => { wake = undefined; resolve(); }, 1000);
        wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
      });
    },
    dispose() { target.removeEventListener('ktv420:spotify-status', changed); wake?.(); },
  };
}
