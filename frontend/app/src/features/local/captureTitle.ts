/** Keep the playlist title steady while per-song status and saved rows catch up. */
export function createCaptureTitle() {
  let highest = 0;
  return (active: boolean, trackCount: number, percentage: number) => {
    if (!active) {
      highest = 0;
      return 'ktv420';
    }
    if (trackCount && Number.isFinite(percentage))
      highest = Math.max(highest, Math.min(99, Math.max(0, percentage)));
    return `${highest}% · ktv420`;
  };
}

/** Mutation observers may fire even when a title is assigned its current value. */
export function createTitlePublisher(publish: (title: string) => void) {
  let previous: string | undefined;
  return (title: string) => {
    const next = title.slice(0, 500);
    if (next === previous) return;
    previous = next;
    publish(next);
  };
}

export function setCaptureDocumentTitle(target: { title: string }, title: string) {
  if (target.title !== title) target.title = title;
}
