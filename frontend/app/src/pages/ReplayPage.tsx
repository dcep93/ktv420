import { loadPerformance, savePerformance } from '../features/local/performanceFiles';
import { useEffect, useState } from 'react';
import { MAX_RECORDING_BYTES, parseRecordingText, type PerformanceRecording } from '../features/local/recording';
import { localPlaylistLink } from '../features/local/playlistPage';
export default function ReplayPage() {
  const [recording,setRecording] = useState<PerformanceRecording | null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    void loadPerformance('import').then(setRecording).catch(() => setError('Could not restore the file. Choose your recording again.'));
  }, []);
  function open(value:PerformanceRecording) { location.assign(`${localPlaylistLink(value.spotifyPath)}&replay=1`); }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);setError('');
    try {
      if (file.size > MAX_RECORDING_BYTES) throw new Error('Choose a recording smaller than 4 MB.');
      const value = parseRecordingText(await file.text());
      await savePerformance('import',value);setRecording(value);
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally {setBusy(false);}
  }
  return <main className="iframe-page"><section className="direct-player-guide replay-import" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void importFile(e.dataTransfer.files[0]); }}>
    <h1 className="app-title">ktv420</h1><h2>Play a recording</h2>
    <p>Drop your friend’s JSON here.</p>
    <label className="primary-button">Choose recording<input type="file" accept=".json,application/json" onChange={e => void importFile(e.target.files?.[0])} /></label>
    {recording && <p>{recording.name} · {recording.tracks.length} songs</p>}
    {recording && <button disabled={busy} onClick={()=>open(recording)}>Open recording</button>}
    <nav><a href="/transfer">Import playlist audio</a><a href="/catalog">Catalog</a></nav>
    {error && <p role="alert">{error}</p>}
    <small>Audio and recording instructions stay on your computer.</small>
  </section></main>;
}
