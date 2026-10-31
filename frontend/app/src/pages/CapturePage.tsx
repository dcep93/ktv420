import SharedAudioSettings from './SharedAudioSettings';
import { separationStatus, separationProgressLabel } from '../features/local/separationStatus';
import { useSpacePlayback } from '../features/local/useSpacePlayback';
import SeparationSettings from './SeparationSettings';
import ExtensionAudioSettings from './ExtensionAudioSettings';
import { capturePercentage } from '../features/local/capturePercentage';
import { startStagedProcessing } from '../features/local/spotify/stagedProcessing';
import { nextSeparationFraction } from '../features/local/rowProgress';
import type { SeparationProgress } from '../features/local/inference/types';
import { useEffect, useRef, useState } from 'react';
import { usePlaylist } from '../features/local/usePlaylist';
import { useHostedCapture } from '../features/local/useHostedCapture';
import OverlayIcon from './OverlayIcon';

/** Capture controls over Spotify; shared audio and playback live on the website origin. */
export default function CapturePage() {
  const spotify = usePlaylist();
  // Capture has no local player; Space must never activate focused controls.
  useSpacePlayback(() => {});
  const [error, setError] = useState(''), [settings, setSettings] = useState(false);
  const [startup, setStartup] = useState('');
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const [processing, setProcessing] = useState<{ id: string; progress: SeparationProgress; fraction: number | null } | null>(null);
  const processingEnabled = spotify.queueEnabled !== false;
  useEffect(() => {
    if (!processingEnabled || !spotify.navigation.open) return;
    let disposed = false;
    const stop = startStagedProcessing((message, id) => {
      if (disposed) return;
      setError(message);
      if (id) setFailures(previous => ({ ...previous, [id]: message }));
    }, (id, progress) => { if (!disposed) setProcessing(previous => progress ? {
      id, progress, fraction: nextSeparationFraction(previous?.id === id ? previous.fraction : null, progress),
    } : null); }, {}, message => { if (!disposed) setStartup(message); });
    return () => { disposed = true; stop(); setProcessing(null); setStartup(''); };
  }, [processingEnabled, spotify.navigation.open, retry]);
  const resume = () => { void spotify.configureQueue(true, true).then(() => { setError(''); setFailures({}); setRetry(value => value + 1); }).catch(reason => setError(String(reason))); };
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
    else document.title = 'ktv420';
  }, [capture.active, spotify.tracks.length, percentage, allCaptured]);
  const message = error || spotify.error || (!spotify.tracksComplete ? 'Loading playlist…' : startup);
  return <main className="iframe-page iframe-page--overlay" aria-label="ktv420 capture playlist">
    <header className="iframe-overlay-header">
      <div className="iframe-status-slot">{message && <p className="iframe-status-message" data-kind={error || spotify.error ? 'error' : 'notice'} role="status"><OverlayIcon name={error || spotify.error ? 'alert' : 'music'} /><span>{message}</span>{(Object.keys(failures).length > 0 || spotify.librarySummary.some(track => track.status === 'error' && track.location !== 'website')) && <button onClick={resume}>Retry separation</button>}</p>}</div>
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
      {settings ? <section className="iframe-settings-view" aria-label="Settings view">
        <SeparationSettings enabled={processingEnabled} backend={spotify.queueBackend || 'auto'}
          busy={spotify.librarySummary.some(track => track.status === 'processing' && track.location !== 'website')}
          failed={spotify.librarySummary.some(track => track.status === 'error' && track.location !== 'website')}
          configure={spotify.configureQueue} onError={setError} />
        {spotify.sharedLibrary ? <SharedAudioSettings capturing={capture.active} /> : <ExtensionAudioSettings capturing={capture.active} />}
      </section> : <ol className="iframe-track-list" aria-label="Playlist tracks">{spotify.tracks.map(row => {
        const separation = processingEnabled && processing?.id === row.trackId ? processing : null;
        const track = saved.get(`spotify-${row.trackId}`);
        const waiting = separationStatus(track, processingEnabled, failures[row.trackId]);
        const status = separation ? 'processing' : track?.status;
        const separating = !!separation || waiting.busy;
        const fraction = separation ? separation.fraction : track?.progress?.fraction ?? null;
        const current = capture.active && progress?.trackId === row.trackId && !status ? progress : null;
        const label = current ? current.phase === 'saving' ? 'Saving…' : `Capturing${current.fraction === null ? '' : ` ${Math.floor(current.fraction * 100)}%`}`
          : separation ? separationProgressLabel(separation.progress.message, separation.fraction) : waiting.label;
        return <li key={`${row.trackId}-${row.rowIndex}`}><button className="iframe-track-row" data-state={status || 'missing'} data-progress={current ? 'capture' : separating ? 'separation' : undefined}
          disabled={!status} aria-label={`${row.trackName} — ${waiting.failed ? 'Retry separation' : label}`} title={separation?.progress.message || waiting.detail || label} onClick={() => waiting.failed ? resume() : open(row.rowIndex + 1)}>
          {separating && <span className="iframe-track-fill" data-indeterminate={fraction === null} style={{ width: fraction === null ? '35%' : `${fraction * 100}%` }} aria-hidden="true" />}
          {current && <span className="iframe-track-fill" data-indeterminate={current.fraction === null} style={{ width: current.fraction === null ? '35%' : `${current.fraction * 100}%` }} aria-hidden="true" />}
          <span className="iframe-track-state"><OverlayIcon name={status === 'ready' ? 'play' : current || separation || waiting.busy ? 'processing' : waiting.failed ? 'alert' : 'clock'} /></span>
          {row.trackArtworkSrc ? <img className="iframe-track-artwork" alt="" src={row.trackArtworkSrc} /> : <span className="iframe-track-artwork iframe-artwork-placeholder"><OverlayIcon name="music" /></span>}
          <span className="iframe-track-copy"><span className="iframe-track-name">{row.trackName}</span><span className="iframe-track-artist">{row.trackArtist}</span></span>
          <span className="iframe-track-status">{waiting.failed ? 'Retry separation' : label}</span>
        </button></li>;
      })}</ol>}
    </div>
  </main>;
}
