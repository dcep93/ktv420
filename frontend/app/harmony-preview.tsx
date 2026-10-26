import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles/theme.css';
import './src/index.css';
import Player from './src/features/stems/player/Player';
import { analyzeChordTimeline, CHORD_ANALYZER_VERSION, chordAtTime } from './src/features/stems/player/chordAnalyzer';
import { cacheChordTimeline } from './src/features/stems/services/indexedDbClient';
import { encodeFloat32Wav } from './src/features/local/audio/wav';

const rate = 44100;
const chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50], [48, 52, 55, 59], [48, 50, 52, 55]];
const labels = ['C', 'Am', 'F', 'G', 'Cmaj7', 'Cadd9'];
function buffer(seconds = 12) {
  const result = new AudioBuffer({ numberOfChannels: 2, sampleRate: rate, length: Math.round(seconds * rate) });
  const cycle = Float32Array.from({ length: rate * 12 }, (_, i) => chords[Math.floor(i / rate / 2)].reduce((sum, midi) => {
    for (let h = 1; h <= 5; h++) sum += .07 / h * Math.sin(2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * h * i / rate);
    return sum;
  }, 0));
  const left = result.getChannelData(0), right = result.getChannelData(1);
  for (let i = 0; i < left.length; i++) { left[i] = cycle[i % cycle.length]; right[i] = -left[i]; }
  return result;
}
const source = buffer(), blob = new Blob([encodeFloat32Wav({ left: source.getChannelData(0), right: source.getChannelData(1), sampleRate: rate })], { type: 'audio/wav' });
const record = (id: string) => ({ md5: id, files: [{ name: 'input.mp3', path: `${id}/input/input.mp3`, blob }] });
const records = [record('harmony-preview-a'), record('harmony-preview-b')];

export function HarmonyPreview() {
  const [index, setIndex] = useState(0), [expanded, setExpanded] = useState(false), [report, setReport] = useState('Ready');
  const run = async () => {
    setReport('Running worker checks…');
    try {
      const results: string[] = [], progress: number[] = [];
      const started = performance.now();
      const timeline = await analyzeChordTimeline(source, { onProgress: value => progress.push(value) });
      const elapsedMs = performance.now() - started;
      labels.forEach((label, i) => { if (chordAtTime(timeline, i * 2 + 1)?.chord !== label) throw new Error(`Wrong chord at ${i * 2 + 1}`); });
      results.push('All six rich stereo chords recognized, despite opposite channel polarity');
      if (progress[0] !== 0 || progress.at(-1) !== 1 || progress.some((p, i) => i > 0 && p < progress[i - 1])) throw new Error('Progress is not monotonic');
      results.push('Progress reaches completion monotonically');
      const controller = new AbortController(); let canceled = false;
      try { await analyzeChordTimeline(source, { signal: controller.signal, onProgress: value => { if (value > .2) controller.abort(); } }); }
      catch (error) { canceled = (error as Error).name === 'AbortError'; }
      if (!canceled) throw new Error('Cancellation did not stop the worker');
      results.push('Cancel terminates the active worker');
      const repeated = await analyzeChordTimeline(source);
      if (JSON.stringify(repeated) !== JSON.stringify(timeline)) throw new Error('A fresh scan changed the result');
      results.push('A new scan succeeds after cancellation with identical results');
      if (source.getChannelData(0).length !== rate * 12 || source.getChannelData(0)[1000] === 0) throw new Error('Playback audio was detached');
      results.push('Playback buffers remain intact');
      setReport(JSON.stringify({ passed: true, elapsedMs, results, timeline }, null, 2));
    } catch (error) { setReport(JSON.stringify({ passed: false, error: String(error) })); }
  };
  const benchmark = async () => {
    setReport('Preparing five-minute stereo fixture…');
    const long = buffer(300), channel = new MessageChannel(); let beats = 0, maxGap = 0, last = performance.now();
    channel.port1.onmessage = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; beats++; channel.port2.postMessage(0); };
    channel.port2.postMessage(0);
    const started = performance.now();
    try {
      await analyzeChordTimeline(long, { onProgress: p => setReport(`Benchmark ${Math.round(p * 100)}%`) });
      setReport(JSON.stringify({ audioSeconds: 300, elapsedMs: performance.now() - started, mainThreadHeartbeats: beats, maxMainThreadGapMs: maxGap }, null, 2));
    } catch (error) { setReport(String(error)); }
    finally { channel.port1.close(); channel.port2.close(); }
  };
  return <main style={{ maxWidth: 1100, margin: '24px auto', padding: 24 }}>
    <h1>Harmony checks</h1>
    <p>Synthetic source: C → Am → F → G → Cmaj7 → Cadd9. No Spotify playback.</p>
    <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={() => void run()}>Check worker</button>
      <button onClick={() => void benchmark()}>Benchmark five minutes</button>
      <button onClick={() => { void cacheChordTimeline(records[index].md5, [{ time: 0, chord: 'Cache sentinel', confidence: 1 }], CHORD_ANALYZER_VERSION).then(() => setReport('Seeded current cache')); }}>Seed current cache</button>
      <button onClick={() => setIndex(1 - index)}>Switch track</button>
    </nav>
    <pre id="report" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{report}</pre>
    <Player record={records[index]} title={`Harmony fixture ${index + 1}`} combinedVisualizerExpanded={expanded} onCombinedVisualizerExpandedChange={setExpanded} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<HarmonyPreview />);
