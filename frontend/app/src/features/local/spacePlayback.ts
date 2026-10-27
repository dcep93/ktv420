/** Reserve Space before native controls and page scrolling handle it. */
export function bindSpacePlayback(target: EventTarget, toggle: () => void): () => void {
  const handle = (raw: Event) => {
    const event = raw as KeyboardEvent;
    if (event.code !== 'Space' && event.key !== ' ') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'keydown' && !event.repeat) toggle();
  };
  target.addEventListener('keydown', handle, { capture: true });
  target.addEventListener('keyup', handle, { capture: true });
  return () => {
    target.removeEventListener('keydown', handle, { capture: true });
    target.removeEventListener('keyup', handle, { capture: true });
  };
}
