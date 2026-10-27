import { useEffect, useRef, useState } from 'react';
import { extensionId, extensionMessage, STORE_URL } from '../features/local/extensionConnection';
import { localCatalogLink, playlistIndex, playlistPath, playlistViewUrl, type PlaylistDetail } from '../features/local/playlistPage';
import { collectionLink } from '../features/local/savedCollections';
import './saved.css';

export default function PlaylistPage() {
  const path = playlistPath(new URLSearchParams(location.search).get('id'));
  const id = extensionId(), origin = import.meta.env.DEV ? location.origin : `chrome-extension://${id}`;
  const frame = useRef<HTMLIFrameElement>(null);
  const [collection, setCollection] = useState<PlaylistDetail | null>(null);
  const latest = useRef<PlaylistDetail | null>(null);
  const [error, setError] = useState(path ? '' : 'Invalid playlist link.');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const catalog = localCatalogLink(new URLSearchParams(location.search).get('extension'));
  useEffect(() => {
    if (!path) return;
    let disposed = false, connected = false, rendered = false, revision = 0;
    let trackIndex = playlistIndex(location.search);
    const post = () => {
      if (!connected || !latest.current) return;
      frame.current?.contentWindow?.postMessage({source:'ktv420-parent',version:2,type:'state',
        spotifyPath:path, navigation:{open:true,trackIndex,revision}, tracks:latest.current.tracks,
        active:false,starting:false,supported:true,notice:'',error:''},origin);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin || event.data?.source !== 'ktv420-overlay' || event.data.version !== 2) return;
      const data = event.data;
      if (data.type === 'ready') { connected = true; post(); }
      else if (data.type === 'view-ready' && data.revision === revision && data.spotifyPath === path) {
        rendered = true; setReady(true); setError('');
      } else if (data.type === 'close') location.assign(catalog);
      else if (data.type === 'view' && data.revision === revision && (data.trackIndex === null ||
        Number.isSafeInteger(data.trackIndex) && latest.current?.tracks.some(row => row.rowIndex + 1 === data.trackIndex))) {
        trackIndex = data.trackIndex;
        const href = playlistViewUrl(location.href, trackIndex);
        if (href !== location.href) history[data.replace === true ? 'replaceState' : 'pushState'](history.state, '', href);
        // Keep the revision: this is the player's own transition, not a Back/Forward entry.
        post();
      }
    };
    const pop = () => { revision++; trackIndex = playlistIndex(location.search); post(); };
    window.addEventListener('message', receive);
    window.addEventListener('popstate', pop);
    void extensionMessage<{ok:boolean;collection:PlaylistDetail}>({type:'ktv420:collection',path}).then(result => {
      if (disposed) return;
      latest.current = result.collection; setCollection(result.collection);
      document.title = `${result.collection.title || 'Playlist'} · ktv420`;
      post();
    }).catch(reason => { if (!disposed) setError(String(reason instanceof Error ? reason.message : reason)); });
    const timeout = setTimeout(() => { if (!rendered) setError(previous => previous || 'The player did not connect. Update the extension, then retry.'); }, 15000);
    return () => { disposed = true; clearTimeout(timeout); window.removeEventListener('message', receive); window.removeEventListener('popstate', pop); };
  }, [path, origin, attempt, catalog]);
  return <main>
    {collection && <iframe key={attempt} ref={frame} className="playlist-host" title="ktv420 playlist player"
      src={import.meta.env.DEV ? `/broker.html?standalone=1` : `${origin}/build/index.html?standalone=1`} allow="autoplay" />}
    {(!ready || error) && <section className="playlist-loading" aria-label="Playlist connection">
      <h1 className="app-title">{collection?.title || 'ktv420'}</h1>
      <p role="status">{error || 'Loading playlist…'}</p>
      <nav><a href={catalog}>Catalog</a>{path && <a href={collectionLink(path)}>Spotify</a>}
        {error && <><a href={STORE_URL} target="_blank" rel="noreferrer">Install / update extension</a><button onClick={() => { setReady(false); setError(''); setAttempt(value => value + 1); }}>Retry</button></>}
      </nav>
    </section>}
  </main>;
}
