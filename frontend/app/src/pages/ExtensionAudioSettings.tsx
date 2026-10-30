import { useEffect, useRef, useState } from 'react';
import { spotifyRequest } from '../features/local/spotify/client';
import type { StagedAudio } from '../shared/stagedLibrary';
import OverlayIcon from './OverlayIcon';

const size = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
export default function ExtensionAudioSettings({ capturing }: { capturing: boolean }) {
  const revision = useRef(0);
  const [tracks, setTracks] = useState<StagedAudio[]>([]);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ ids: string[]; title: string } | null>(null);
  useEffect(() => {
    let disposed = false, busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      const current = revision.current;
      try {
        const hello = await spotifyRequest<{ stagedAudioControls?: boolean }>('hello');
        if (!hello.stagedAudioControls) throw new Error('Reload the updated ktv420 extension to manage extension audio.');
        const rows = await spotifyRequest<StagedAudio[]>('staging-list');
        if (!disposed && current === revision.current) { setTracks(rows); setLoaded(true); setError(''); }
      } catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { busy = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  const remove = async () => {
    if (!confirmation || deleting) return;
    revision.current++;
    setDeleting(true); setError('');
    try {
      await spotifyRequest('staging-delete', { ids: confirmation.ids });
      revision.current++;
      setConfirmation(null);
      setTracks(await spotifyRequest<StagedAudio[]>('staging-list'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(false); }
  };
  const locked = capturing || deleting;
  const confirmationBusy = confirmation?.ids.some(id => tracks.some(t => t.id === id && t.busy));
  return <section className="iframe-settings-source" aria-label="Extension audio">
    <header className="iframe-settings-source-header"><h2>Extension audio</h2><span>{loaded ? size(tracks.reduce((sum, t) => sum + t.bytes, 0)) : '—'}</span></header>
    <p className="iframe-settings-help">Recordings waiting to move into ktv420. Deleting here leaves imported website audio untouched.</p>
    <div className="iframe-audio-cleanup">
      {confirmation ? <>
        <span>Delete {confirmation.title} from the extension? This can’t be undone.</span>
        <button className="iframe-delete-all" disabled={locked || confirmationBusy} onClick={() => void remove()}>{deleting ? 'Deleting…' : 'Delete'}</button>
        <button disabled={deleting} onClick={() => setConfirmation(null)}>Cancel</button>
      </> : <button className="iframe-delete-all" disabled={!loaded || !tracks.length || locked || tracks.some(t => t.busy)}
        onClick={() => setConfirmation({ ids: tracks.map(t => t.id), title: 'all extension audio' })}>Delete all audio</button>}
    </div>
    {(capturing || tracks.some(t => t.busy)) && <p className="iframe-settings-help">Stop capture and pause separation before deleting. Active transfers must finish first.</p>}
    {error && <p className="iframe-settings-help" role="status">{error}</p>}
    {loaded && !tracks.length && <p className="iframe-settings-help">No audio stored in the extension.</p>}
    <ol className="iframe-settings-list">{tracks.map(track => <li key={track.id}>
      <div className="iframe-settings-row">
        <span className="iframe-settings-kind" data-ready={track.ready} role="img" aria-label={track.ready ? 'Original + 4 stems' : 'Original only'} title={track.ready ? 'Original + 4 stems' : 'Original only'}><OverlayIcon name="music" /></span>
        <span className="iframe-settings-path">{track.title}</span><span className="iframe-settings-size">{size(track.bytes)}</span>
        <span className="iframe-settings-row-actions"><button className="iframe-settings-icon-button" disabled={locked || track.busy}
          title={track.busy ? 'Processing or transferring' : 'Delete extension audio'} aria-label={`Delete ${track.title}`}
          onClick={() => setConfirmation({ ids: [track.id], title: `“${track.title}”` })}><OverlayIcon name="trash" /></button></span>
      </div>
    </li>)}</ol>
  </section>;
}
