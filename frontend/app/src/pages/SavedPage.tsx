import { localPlaylistLink } from '../features/local/playlistPage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { extensionMessage, STORE_URL } from '../features/local/extensionConnection';
import { collectionLink, type SavedCollectionSummary } from '../features/local/savedCollections';
import OverlayIcon from './OverlayIcon';
import './saved.css';

export default function SavedPage() {
  const [collections, setCollections] = useState<SavedCollectionSummary[] | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [deleting, setDeleting] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const refreshRevision = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    try {
      const response = await extensionMessage<{ok: boolean; collections: SavedCollectionSummary[]}>({type: 'ktv420:saved-collections'});
      if (revision === refreshRevision.current) { setCollections(response.collections); setError(''); }
    } catch (reason) { if (revision === refreshRevision.current) setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  const removeAudio = async (path: string) => {
    if (deleting) return;
    setDeleting(path); setDeleteError('');
    try {
      await extensionMessage({ type: 'ktv420:delete-collection-audio', path, confirmed: true });
      setConfirmDelete('');
      await refresh();
    } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(''); }
  };
  useEffect(() => {
    document.title = 'Catalog · ktv420';
    const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 2500);
    const timer = setTimeout(() => { void refresh(); }, 0);
    const visible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', visible);
    return () => { clearTimeout(timer); clearInterval(poll); window.removeEventListener('focus', visible); };
  }, [refresh]);
  return <main className="iframe-page saved-page"><section className="saved-content">
    <header><a className="app-title" href="/">ktv420</a><h1>Catalog</h1><p>Playlists and albums on this computer.</p></header>
    {error ? <div className="saved-empty"><p role="status">{error}</p><nav><a href={STORE_URL} target="_blank" rel="noreferrer">Install / update extension</a><button onClick={() => void refresh()}>Refresh</button></nav></div>
      : collections === null ? <p role="status">Loading…</p> : collections.length === 0 ? <div className="saved-empty"><p>Start capturing a playlist or album to add it here.</p><a href="https://open.spotify.com/">Open Spotify</a></div>
      : <ol className="saved-collections">{collections.map(collection => <li key={collection.path}><div className="saved-row"><a href={collectionLink(collection.path)}>
        {collection.artwork ? <img src={collection.artwork} alt="" /> : <span className="saved-artwork"><OverlayIcon name="music" /></span>}
        <span className="saved-copy"><strong>{collection.title || (collection.path.startsWith('album/') ? 'Saved album' : 'Saved playlist')}</strong>
          <span>{collection.captured} of {collection.total} captured · {collection.ready} ready</span></span>
        <span className="saved-arrow" aria-hidden="true">↗</span>
      </a><a className="saved-local-link" href={localPlaylistLink(collection.path, new URLSearchParams(location.search).get('extension'))} aria-label={`Open ${collection.title || 'collection'} in ktv420`}>ktv420</a><button className="saved-delete" aria-label={`Delete local audio for ${collection.title || 'this collection'}`} title="Delete local audio"
        disabled={!collection.captured || !!deleting} onClick={() => { setConfirmDelete(collection.path); setDeleteError(''); }}><OverlayIcon name="trash" /></button></div>
      {confirmDelete === collection.path && <div className="saved-confirm">
        <p>Delete this collection’s local originals and stems? Shared songs will also be unavailable in other playlists. The catalog link stays.</p>
        {deleteError && <p role="alert">{deleteError}</p>}
        <div><button className="saved-delete-confirm" disabled={!!deleting} onClick={() => void removeAudio(collection.path)}>{deleting === collection.path ? 'Deleting…' : 'Delete local audio'}</button>
          <button disabled={!!deleting} onClick={() => { setConfirmDelete(''); setDeleteError(''); }}>Cancel</button></div>
      </div>}
      </li>)}</ol>}
  </section></main>;
}
