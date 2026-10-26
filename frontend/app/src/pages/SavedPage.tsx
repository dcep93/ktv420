import { useCallback, useEffect, useState } from 'react';
import { extensionMessage, STORE_URL } from '../features/local/extensionConnection';
import { collectionLink, type SavedCollectionSummary } from '../features/local/savedCollections';
import OverlayIcon from './OverlayIcon';
import './saved.css';

export default function SavedPage() {
  const [collections, setCollections] = useState<SavedCollectionSummary[] | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const response = await extensionMessage<{ok: boolean; collections: SavedCollectionSummary[]}>({type: 'ktv420:saved-collections'});
      setCollections(response.collections); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
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
      : <ol className="saved-collections">{collections.map(collection => <li key={collection.path}><a href={collectionLink(collection.path)}>
        {collection.artwork ? <img src={collection.artwork} alt="" /> : <span className="saved-artwork"><OverlayIcon name="music" /></span>}
        <span className="saved-copy"><strong>{collection.title || (collection.path.startsWith('album/') ? 'Saved album' : 'Saved playlist')}</strong>
          <span>{collection.captured} of {collection.total} captured · {collection.ready} ready</span></span>
        <span className="saved-arrow" aria-hidden="true">↗</span>
      </a></li>)}</ol>}
  </section></main>;
}
