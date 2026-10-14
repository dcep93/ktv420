import { loadPerformance, savePerformance } from '../features/local/performanceFiles';
import { useEffect, useState } from 'react';
import { MAX_RECORDING_BYTES, parseRecordingText, type PerformanceRecording } from '../features/local/recording';
const STORE_ID = 'kmkbecinmhkfihahalgclomhcicmoiia';
// Optional explicit ID supports an unpacked development install; shared links use the store ID.
const requestedId = new URLSearchParams(location.search).get('extension');
const extensionId = requestedId && /^[a-p]{32}$/.test(requestedId) ? requestedId : STORE_ID;
function extensionMessage(message: unknown): Promise<{ ok: boolean; error?: string; version?: string }> {
  return new Promise((resolve,reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) { reject(new Error('Install the extension, then refresh this page.')); return; }
    chrome.runtime.sendMessage(extensionId, message, response => {
      const error = chrome.runtime.lastError;
      if (error || !response) reject(new Error('Install or update the extension, then refresh this page.'));
      else if (!response.ok) reject(new Error(response.error || 'Update the extension, then refresh.'));
      else resolve(response);
    });
  });
}
export default function ReplayPage() {
  const [recording,setRecording] = useState<PerformanceRecording | null>(null);
  const [error,setError] = useState('');
  const [installed,setInstalled] = useState<boolean | null>(null);
  const [busy,setBusy] = useState(false);
  const [opened,setOpened] = useState(false);
  useEffect(() => {
    void loadPerformance('import').then(setRecording).catch(() => setError('Could not restore the file. Choose your recording again.'));
    void extensionMessage({type:'ktv420:replay-ping'}).then(() => setInstalled(true)).catch(() => setInstalled(false));
  }, []);
  async function open(value: PerformanceRecording) {
    setBusy(true); setError('');
    try {
      const peer = await extensionMessage({type:'ktv420:replay-ping'});
      const [major, minor] = (peer.version || '0.0').split('.').map(Number);
      if (value.version === 3 && !(major > 6 || (major === 6 && minor >= 3))) { setInstalled(false); throw new Error('This recording needs ktv420 6.3 or later. Update the extension, then refresh.'); }
      await extensionMessage({type:'ktv420:open-replay', recording:value}); setOpened(true); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  // Refresh after installation completes the same handoff without reimporting.
  useEffect(() => { if (installed && recording && !opened && !busy && !error) void open(recording); }, [installed,recording,opened,busy,error]);
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);setError('');
    try {
      if (file.size > MAX_RECORDING_BYTES) throw new Error('Choose a recording smaller than 4 MB.');
      const value = parseRecordingText(await file.text());
      await savePerformance('import',value);setRecording(value);setOpened(false);
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally {setBusy(false);}
  }
  return <main className="iframe-page"><section className="direct-player-guide replay-import" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void importFile(e.dataTransfer.files[0]); }}>
    <h1 className="app-title">ktv420</h1><h2>Play a recording</h2>
    <p>Drop your friend’s JSON here.</p>
    <label className="primary-button">Choose recording<input type="file" accept=".json,application/json" onChange={e => void importFile(e.target.files?.[0])} /></label>
    {recording && <p>{recording.name} · {recording.tracks.length} songs</p>}
    {installed===false && <><p>Install ktv420 in desktop Chrome, then come back here.</p><nav><a className="primary-button" target="_blank" rel="noreferrer" href={`https://chromewebstore.google.com/detail/ktv420/${STORE_ID}`}>Install / update extension</a><button onClick={() => location.reload()}>Refresh to continue</button></nav></>}
    {installed && recording && <button disabled={busy} onClick={() => void open(recording)}>{busy ? 'Opening Spotify…' : opened ? 'Open again in Spotify' : 'Open in Spotify'}</button>}
    {opened && <p>Continue in Spotify. Capture missing songs, then press Play recording.</p>}
    {error && <p role="alert">{error}</p>}
    <small>Audio and recording instructions stay on your computer.</small>
  </section></main>;
}
