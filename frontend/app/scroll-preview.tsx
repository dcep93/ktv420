// Development-only regression fixture: real Player endings, keyed remounts and delayed loading.
import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles/theme.css';
import './src/index.css';
import Player from './src/features/stems/player/Player';
import PlayerViewport from './src/pages/PlayerViewport';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import type { MixerControl, MixerSnapshot } from './src/features/local/recording';

const samples = new Float32Array(44100 * 2);
const blob = new Blob([encodeFloat32Wav({ left: samples, right: samples, sampleRate: 44100 })], { type: 'audio/wav' });
const names = ['input', 'drums', 'bass', 'vocals', 'other'];
const records = [0, 1, 2].map(index => ({ md5: `scroll-check-${index}`, files: names.map(name => ({
  name: `${name}.mp3`, path: `scroll-check-${index}/${name === 'input' ? 'input' : 'output'}/${name}.mp3`, blob,
})) }));
const settings: MixerSnapshot = { visualizer: 'highway', spotlight: null, stems: names.map(name => ({
  name: `${name}.mp3`, input: name === 'input', volume: 1, mute: false, deafen: false, effect: 'wah', value: .5,
})) };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export function ScrollPreview() {
  const [index, setIndex] = useState(0), [loading, setLoading] = useState(false), [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState('Ready'), [busy, setBusy] = useState(false);
  const page = useRef<HTMLElement>(null), mixer = useRef<MixerControl | null>(null), currentIndex = useRef(0);
  const onControls = useCallback((control: MixerControl | null) => { mixer.current = control; }, []);
  const next = () => {
    setLoading(true);
    setTimeout(() => { currentIndex.current = index + 1; setIndex(index + 1); setLoading(false); }, 700);
  };
  const run = async (full: boolean) => {
    if (busy) return;
    setBusy(true); setReport('Checking automatic track changes…');
    mixer.current?.pause(); currentIndex.current = 0; setIndex(0); setExpanded(full);
    await frame();
    const deadline = performance.now() + 20000;
    while (!mixer.current?.ready || mixer.current.trackId !== records[0].md5) {
      if (performance.now() > deadline) { setReport('Failed: player never became ready'); setBusy(false); return; }
      await frame();
    }
    await frame(); await frame();
    page.current!.scrollTop = full ? 1050 : 500;
    await frame();
    const expected = page.current!.scrollTop;
    let minimum = expected, maximum = expected;
    await mixer.current.play();
    while (currentIndex.current < 2 || !mixer.current?.ready || mixer.current.trackId !== records[2].md5) {
      await frame();
      minimum = Math.min(minimum, page.current!.scrollTop); maximum = Math.max(maximum, page.current!.scrollTop);
      if (performance.now() > deadline) break;
    }
    await frame(); await frame();
    mixer.current?.pause();
    minimum = Math.min(minimum, page.current!.scrollTop); maximum = Math.max(maximum, page.current!.scrollTop);
    setReport(JSON.stringify({ passed: currentIndex.current === 2 && minimum === expected && maximum === expected,
      expanded: full, automaticTransitions: currentIndex.current, expected, minimum, maximum }, null, 2));
    setBusy(false);
  };
  return <main ref={page} className="iframe-page iframe-page--overlay iframe-page--player">
    <header className="iframe-overlay-header"><div className="iframe-status-slot">Synthetic silent playback</div>
      <div><button disabled={busy} onClick={() => void run(false)}>Check compact</button><button disabled={busy} onClick={() => void run(true)}>Check expanded</button></div>
    </header>
    <div className="iframe-content">
      <PlayerViewport hidden={false} contentKey={loading ? null : records[index].md5}>
        {!loading && <Player key={records[index].md5} record={records[index]} title={`Song ${index + 1}`} initialSettings={settings}
          combinedVisualizerExpanded={expanded} onCombinedVisualizerExpandedChange={setExpanded} masterVolume={0}
          onControls={onControls} hasNextTrack={index < 2} onTrackEnd={next} autoPlayOnReady={index > 0 && busy} />}
      </PlayerViewport>
    </div>
    <pre id="report" style={{ position: 'fixed', bottom: 0, right: 12, padding: 12, background: '#151015', pointerEvents: 'none', zIndex: 20 }}>{report}</pre>
  </main>;
}
createRoot(document.getElementById('root')!).render(<ScrollPreview />);
