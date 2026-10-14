import type { ReactNode } from 'react';

type IconName = 'close' | 'settings' | 'play' | 'clock' | 'processing' | 'alert' | 'trash' | 'retry' | 'music' | 'back';

/** One rounded stroke style for the capture overlay, independent of OS emoji fonts. */
export default function OverlayIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    close: <path d="m6 6 12 12M18 6 6 18" />,
    settings: <><path d="M4 6h5m4 0h7M4 12h9m4 0h3M4 18h3m4 0h9" /><circle cx="11" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
    play: <path d="m9 5 10 7-10 7Z" />,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    processing: <path d="M20 12a8 8 0 1 1-8-8" />,
    alert: <><circle cx="12" cy="12" r="8" /><path d="M12 7v6m0 3h.01" /></>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></>,
    retry: <><path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5" /></>,
    music: <><path d="M9 17V5l10-2v12M9 9l10-2" /><ellipse cx="6" cy="18" rx="3" ry="2" /><ellipse cx="16" cy="16" rx="3" ry="2" /></>,
    back: <path d="m10 5-7 7 7 7M3 12h18" />,
  };
  return <svg className="overlay-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
