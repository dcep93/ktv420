import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayerPreferences } from './playerPreferences';
import type { MixerSnapshot } from './recording';

export function usePlayerPreferences(persist = true, key?: string) {
  const [preferences] = useState(() => new PlayerPreferences(() => window.localStorage, {key}));
  const mixerSettings = useRef(preferences.current.mixer);
  const [combinedVisualizerExpanded, setExpanded] = useState(preferences.current.expanded);
  const rememberMixerSettings = useCallback((settings: MixerSnapshot) => {
    if (!persist) return;
    preferences.setMixer(settings); mixerSettings.current = preferences.current.mixer;
  }, [persist, preferences]);
  const setCombinedVisualizerExpanded = useCallback((expanded: boolean) => {
    setExpanded(expanded);
    if (persist) preferences.setExpanded(expanded);
  }, [persist, preferences]);
  useEffect(() => {
    const flush = () => preferences.flush();
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, [preferences]);
  return {mixerSettings,rememberMixerSettings,combinedVisualizerExpanded,setCombinedVisualizerExpanded};
}
