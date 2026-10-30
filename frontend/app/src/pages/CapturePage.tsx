import { separationStatus, separationPhase } from '../features/local/separationStatus';
import ExtensionAudioSettings from './ExtensionAudioSettings';
import { capturePercentage } from '../features/local/capturePercentage';
import { startStagedProcessing } from '../features/local/spotify/stagedProcessing';
import { nextSeparationFraction } from '../features/local/rowProgress';
import type { SeparationProgress } from '../features/local/inference/types';
import { useEffect, useRef, useState } from 'react';
import { usePlaylist } from '../features/local/usePlaylist';
import { useHostedCapture } from '../features/local/useHostedCapture';
import OverlayIcon from './OverlayIcon';

/** Hosted inference uses extension staging; the frame owns no audio library or mixer. */
export default function CapturePage() {
  const spotify = usePlaylist();
  const [error, setError] = useState(''), [settings, setSettings] = useState(false);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const [processing, setProcessing] = useState<{ id: string; progress: SeparationProgress; fraction: number | null } | null>(null);
  const [processingEnabled, setProcessingEnabled] = useState(() => {
    try { return localStorage.getItem('ktv420:overlay-separation') !== 'paused'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('ktv420:overlay-separation', processingEnabled ? 'enabled' : 'paused'); } catch { /* Optional preference. */ }
  }, [processingEnabled]);
  useEffect(() => {
    if (!processingEnabled || !spotify.navigation.open) return;
    let disposed = false;
    const stop = startStagedProcessing((message, id) => {
      if (disposed) return;
      setError(message);
      if (id) setFailures(previous => ({ ...previous, [id]: message }));
    }, (id, progress) => { if (!disposed) setProcessing(previous => progress ? {
      id, progress, fraction: nextSeparationFraction(previous?.id === id ? previous.fraction : null, progress),
    } : null); });
    return () => { disposed = true; stop(); setProcessing(null); };
  }, [processingEnabled, spotify.navigation.open, retry]);
  const resume = () => { setError(''); setFailures({}); setProcessingEnabled(true); setRetry(value => value + 1); };
  const followed = useRef(-1);
  const saved = new Map(spotify.librarySummary.map(track => [track.id, track]));
  for (const id of spotify.savingTrackIds) {
    if (!saved.has(`spotify-${id}`)) saved.set(`spotify-${id}`, { id: `spotify-${id}`, status: 'captured' });
  }
  const capture = useHostedCapture({ spotify, tracks: [...saved.values()], libraryReady: spotify.summaryReady,
    required: [], replaying: false, onError: setError });
  const allCaptured = spotify.tracks.length > 0 && spotify.tracks.every(row => saved.has(`spotify-${row.trackId}`));
  const canStart = spotify.summaryReady && spotify.tracksComplete && spotify.tracks.length > 0;
  const open = (index: number | null) => { void spotify.openPlayer(index).catch(reason => setError(String(reason.message || reason))); };
  const volume = spotify.captureVolume;
  useEffect(() => {
    const n = spotify.navigation;
    if (!n.open || n.trackIndex === null || followed.current === n.revision || !spotify.tracksComplete) return;
    followed.current = n.revision;
    if (spotify.tracks.some(row => row.rowIndex + 1 === n.trackIndex))
      void spotify.openPlayer(n.trackIndex).catch(reason => setError(String(reason.message || reason)));
    spotify.setView(null, n.revision, true);
  }, [spotify]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); spotify.close(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [spotify]);
  const progress = spotify.captureProgress;
  const percentage = capturePercentage(spotify.tracks.map(row => row.trackId),
    new Set([...saved.keys()].map(id => id.replace(/^spotify-/, ''))), progress);
  useEffect(() => {
    if (capture.active && spotify.tracks.length)
      document.title = `${Math.min(99, percentage)}% · ktv420`;
    else if (allCaptured) document.title = 'ktv420';
  }, [capture.active, spotify.tracks.length, percentage, allCaptured]);
  const message = error || spotify.error || (!spotify.tracksComplete ? 'Loading playlist…' : '');
  return <main className="iframe-page iframe-page--overlay" aria-label="ktv420 capture playlist">
    <header className="iframe-overlay-header">
      <div className="iframe-status-slot">{message && <p className="iframe-status-message" data-kind={error || spotify.error ? 'error' : 'notice'} role="status"><OverlayIcon name={error || spotify.error ? 'alert' : 'music'} /><span>{message}</span>{Object.keys(failures).length > 0 && <button onClick={resume}>Retry separation</button>}</p>}</div>
      <div className="iframe-actions-shell"><div className="iframe-actions">
        <button className="iframe-close-button" aria-label="Close" onClick={spotify.close}><OverlayIcon name="close" /></button>
        <button className="iframe-logo-button" aria-label={capture.active ? 'Stop capture' : allCaptured ? 'Open first track in ktv420' : 'Start capture'}
          title={capture.active ? 'Stop capture' : allCaptured ? 'Open first track in ktv420' : 'Start capture'}
          disabled={!capture.active && !canStart} aria-pressed={capture.active}
          onClick={() => capture.active ? capture.cancel() : allCaptured ? open(1) : capture.toggle()}><img alt="" src={`${import.meta.env.BASE_URL}favicon.svg`} /></button>
        <button className="iframe-settings-button" aria-label="Toggle settings view" aria-pressed={settings} onClick={() => setSettings(!settings)}><OverlayIcon name="settings" /></button>
      </div><label className="iframe-master-volume"><span>Volume <output>{volume == null ? '—' : `${Math.round(volume * 100)}%`}</output></span>
        <input type="range" min="0" max="1" step="0.01" aria-label="Listening volume" value={volume ?? 0} disabled={volume == null}
          onChange={event => { const next = Number(event.target.value); spotify.transport({ action: 'volume', volume: next }); }} />
        <small>{capture.active ? 'Capture' : 'Muted'}</small>
      </label></div>
    </header>
    <div className="iframe-content">
      {settings ? <section className="iframe-settings-view" aria-label="Settings view"><section className="iframe-settings-source">
        <header className="iframe-settings-source-header"><h2>Capture</h2></header>
        <p className="iframe-settings-help">Volume changes what you hear, not the recording. Songs separate here as capture continues, then move into ktv420 when you open it.</p>
        <button onClick={() => { setError(''); if (processingEnabled) { setProcessing(null); setProcessingEnabled(false); } else resume(); }}>{processingEnabled ? 'Pause separation' : 'Resume separation'}</button>
        {Object.keys(failures).length > 0 && <button onClick={resume}>Retry separation</button>}
        <button onClick={() => open(null)}>Open playlist in ktv420</button>
      </section><ExtensionAudioSettings capturing={capture.active} /></section> : <ol className="iframe-track-list" aria-label="Playlist tracks">{spotify.tracks.map(row => {
        const separation = processingEnabled && processing?.id === row.trackId ? processing : null;
        const track = saved.get(`spotify-${row.trackId}`);
        const waiting = separationStatus(track, processingEnabled, failures[row.trackId]);
        const status = separation ? 'processing' : track?.status;
        const current = capture.active && progress?.trackId === row.trackId && !status ? progress : null;
        const label = current ? current.phase === 'saving' ? 'Saving…' : `Capturing${current.fraction === null ? '' : ` ${Math.floor(current.fraction * 100)}%`}`
          : separation ? `${separationPhase(separation.progress)}${separation.fraction === null ? '' : ` ~${Math.round(separation.fraction * 100)}%`}` : waiting.label;
        return <li key={`${row.trackId}-${row.rowIndex}`}><button className="iframe-track-row" data-state={status || 'missing'} data-progress={current ? 'capture' : separation ? 'separation' : undefined}
          disabled={!status} aria-label={`${row.trackName} — ${label}`} title={separation?.progress.message || waiting.detail || label} onClick={() => open(row.rowIndex + 1)}>
          {separation && <span className="iframe-track-fill" data-indeterminate={separation.fraction === null} style={{ width: separation.fraction === null ? '35%' : `${separation.fraction * 100}%` }} aria-hidden="true" />}
          {current && <span className="iframe-track-fill" data-indeterminate={current.fraction === null} style={{ width: current.fraction === null ? '35%' : `${current.fraction * 100}%` }} aria-hidden="true" />}
          <span className="iframe-track-state"><OverlayIcon name={status === 'ready' ? 'play' : current || separation || waiting.busy ? 'processing' : waiting.failed ? 'alert' : 'clock'} /></span>
          {row.trackArtworkSrc ? <img className="iframe-track-artwork" alt="" src={row.trackArtworkSrc} /> : <span className="iframe-track-artwork iframe-artwork-placeholder"><OverlayIcon name="music" /></span>}
          <span className="iframe-track-copy"><span className="iframe-track-name">{row.trackName}</span><span className="iframe-track-artist">{row.trackArtist}</span></span>
          <span className="iframe-track-status">{label}{separation && <small className="iframe-separation-detail">{separation.progress.message}</small>}</span>
        </button></li>;
      })}</ol>}
    </div>
  </main>;
}
