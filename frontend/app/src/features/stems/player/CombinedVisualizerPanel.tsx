import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { combinedVisualizers, type CombinedVisualizerType } from './visuals/combinedVisualizers';

/** In-flow expansion keeps transport/scrolling available without a fullscreen API. */
export function CombinedVisualizerPanel({ type, canvasRef }: {
  type: CombinedVisualizerType; canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const interacted = useRef(false);
  const scene = combinedVisualizers[type];
  const toggle = () => { interacted.current = true; setExpanded(value => !value); };
  useLayoutEffect(() => {
    if (interacted.current) panel.current?.scrollIntoView({ block: expanded ? 'start' : 'nearest', behavior: 'instant' });
  }, [expanded]);
  return <section ref={panel} role="button" tabIndex={0} aria-pressed={expanded}
    aria-label={`${scene.label}: ${expanded ? 'restore compact view' : 'expand to full height'}`}
    className={`combined-visualizer${expanded ? ' combined-visualizer--expanded' : ''}`}
    onClick={toggle} onKeyDown={event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); toggle(); }
    }}>
    <canvas ref={canvasRef} aria-label="Combined stem visualization" />
    <div className="combined-visualizer__legend">
      {scene.legend.map(label => <span key={label}>{label}</span>)}
      <span className="combined-visualizer__size">{expanded ? 'Click to shrink ↙' : 'Click to expand ↗'}</span>
    </div>
  </section>;
}
