import { useEffect, useLayoutEffect, useRef } from 'react';
import { bindSpacePlayback } from './spacePlayback';

export function useSpacePlayback(toggle: () => void, enabled = true) {
  const latest = useRef(toggle);
  useLayoutEffect(() => { latest.current = toggle; });
  useEffect(() => {
    if (enabled) return bindSpacePlayback(window, () => latest.current());
  }, [enabled]);
}
