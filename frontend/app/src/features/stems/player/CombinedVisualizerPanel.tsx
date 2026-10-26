import { useLayoutEffect, useRef, type RefObject } from 'react';
import { combinedVisualizers, type CombinedVisualizerType } from './visuals/combinedVisualizers';

/** In-flow expansion keeps transport/scrolling available without a fullscreen API. */
export function CombinedVisualizerPanel({ type, canvasRef, expanded, onExpandedChange }: {
  type: CombinedVisualizerType; canvasRef: RefObject<HTMLCanvasElement | null>;
  expanded: boolean; onExpandedChange: (expanded: boolean) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const interacted = useRef(false);
  const scene = combinedVisualizers[type];
  const toggle = () => { interacted.current = true; onExpandedChange(!expanded); };
  useLayoutEffect(() => {
    // Only an explicit size toggle scrolls. Remounting for another song or
    // finishing audio decode must preserve wherever the listener has scrolled.
    if (interacted.current) panel.current?.scrollIntoView({ block: expanded ? 'start' : 'nearest', behavior: 'instant' });
    interacted.current = false;
  }, [expanded]);
  return <section ref={panel} role="button" tabIndex={0} aria-pressed={expanded}
    aria-label={`${scene.label}: ${expanded ? 'restore compact view' : 'expand to full height'}`}
    className={`combined-visualizer${expanded ? ' combined-visualizer--expanded' : ''}`}
    onClick={toggle} onKeyDown={event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); toggle(); }
    }}>
    <canvas ref={canvasRef} aria-label="Combined stem visualization" />
  </section>;
}
