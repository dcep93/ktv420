import { useEffect, useState } from 'react';
import { listTracks, deleteTracks } from '../features/local/library';
import { SEPARATION_LOCK } from '../features/local/libraryClient';
import { libraryChanges } from '../features/local/libraryChanges';
import { spotifyRequest } from '../features/local/spotify/client';
import type { StagedAudio } from '../shared/stagedLibrary';
import OverlayIcon from './OverlayIcon';

type Row = { id: string; title: string; bytes: number; ready: boolean; busy: boolean; staged: string[] };
const size = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
async function audioRows(): Promise<Row[]> {
  const [local, staged] = await Promise.all([listTracks(), spotifyRequest<StagedAudio[]>('staging-list')]);
  const rows = new Map(local.map(t => [t.id, { id: t.id, title: t.title, bytes: t.bytes, ready: t.status === 'ready', busy: false, staged: [] as string[] }]));
  for (const t of staged) {
    const id = t.trackId || t.id, row = rows.get(id);
    if (row) { row.busy ||= t.busy; row.staged.push(t.id); }
    else rows.set(id, { ...t, id, staged: [t.id] });
  }
  return [...rows.values()];
}
export default function SharedAudioSettings({ capturing }: { capturing: boolean }) {
  const [rows, setRows] = useState<Row[]>([]), [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Row[] | null>(null), [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let disposed = false, busy = false;
    const refresh = async () => {
      if (busy) return; busy = true;
      try { const next = await audioRows(); if (!disposed) { setRows(next); setError(''); } }
      catch (reason) { if (!disposed) setError(String(reason)); }
      finally { busy = false; }
    };
    const update = () => { void refresh(); };
    update(); const timer = setInterval(update, 1500); libraryChanges.addEventListener('change', update);
    return () => { disposed = true; clearInterval(timer); libraryChanges.removeEventListener('change', update); };
  }, []);
  const remove = async () => {
    if (!confirmation || deleting) return;
    setDeleting(true); setError('');
    try {
      await navigator.locks.request(SEPARATION_LOCK, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Pause separation before deleting audio.');
        const staged = confirmation.flatMap(row => row.staged);
        if (staged.length) await spotifyRequest('staging-delete', { ids: staged });
        await deleteTracks(confirmation.map(row => row.id));
      });
      setConfirmation(null); setRows(await audioRows());
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(false); }
  };
  const locked = capturing || deleting || rows.some(row => row.busy);
  return <section className="iframe-settings-source" aria-label="Local audio">
    <header className="iframe-settings-source-header"><h2><a href="/catalog" target="_blank" rel="noreferrer">Local audio</a></h2><span>{size(rows.reduce((sum, row) => sum + row.bytes, 0))}</span></header>
    <div className="iframe-audio-cleanup">{confirmation ? <>
      <span>Delete {confirmation.length === 1 ? `“${confirmation[0].title}”` : 'all saved audio'}? This can’t be undone.</span>
      <button className="iframe-delete-all" disabled={locked} onClick={() => void remove()}>{deleting ? 'Deleting…' : 'Delete'}</button>
      <button disabled={deleting} onClick={() => setConfirmation(null)}>Cancel</button>
    </> : <button className="iframe-delete-all" disabled={locked || !rows.length} onClick={() => setConfirmation(rows)}>Delete all audio</button>}</div>
    {(capturing || rows.some(row => row.busy)) && <p className="iframe-settings-help">Stop capture and pause separation before deleting audio.</p>}
    {error && <p className="iframe-settings-help" role="status">{error}</p>}
    <ol className="iframe-settings-list">{rows.map(row => <li key={row.id}><div className="iframe-settings-row">
      <span className="iframe-settings-kind" data-ready={row.ready} role="img" aria-label={row.ready ? 'Original + 4 stems' : 'Original only'}><OverlayIcon name="music" /></span>
      <span className="iframe-settings-path">{row.title}</span><span className="iframe-settings-size">{size(row.bytes)}</span>
      <span className="iframe-settings-row-actions"><button className="iframe-settings-icon-button" disabled={locked} aria-label={`Delete ${row.title}`} onClick={() => setConfirmation([row])}><OverlayIcon name="trash" /></button></span>
    </div></li>)}</ol>
  </section>;
}
