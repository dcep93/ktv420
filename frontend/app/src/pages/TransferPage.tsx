import { useEffect, useRef, useState } from 'react';
import { connectTransfer } from '../features/local/transfer/client';
import { exportPlaylist, importPlaylist, type Progress } from '../features/local/transfer/transfer';
import { openFolder, openZip, type PackageSource } from '../features/local/transfer/archive';
import { localCatalogLink, localPlaylistLink, playlistPath } from '../features/local/playlistPage';
import { requestPersistence } from '../features/local/libraryClient';
import type { Collection } from '../features/local/savedCollections';
import './saved.css';

type SavePicker = (options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<{createWritable:()=>Promise<FileSystemWritableFileStream>}>;
const size = (bytes:number) => bytes >= 1024**3 ? `${(bytes/1024**3).toFixed(2)} GiB` : `${(bytes/1024**2).toFixed(1)} MiB`;
export default function TransferPage() {
  const params=new URLSearchParams(location.search),id=params.get('export'),path=playlistPath(id),extension=params.get('extension');
  const catalog=localCatalogLink(extension);
  const client=useRef<ReturnType<typeof connectTransfer>|null>(null),controller=useRef<AbortController|null>(null),active=useRef(false);
  const [connected,setConnected]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState<Progress|null>(null),[result,setResult]=useState(''),[imported,setImported]=useState('');
  const [collection,setCollection]=useState<{collection:Collection;bytes:number}|null>(null);
  const zipInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    let disposed=false;
    document.title=`${id?'Export playlist':'Import playlist'} · ktv420`;
    void requestPersistence(); const bridge=connectTransfer();client.current=bridge;
    void bridge.connected.then(async()=>{
      if(disposed)return;
      if(id){if(!path)throw new Error('Invalid playlist link.');const detail=await bridge.request<{collection:Collection;bytes:number}>('exportCollection',[path]);if(!disposed)setCollection(detail);}
      if(!disposed)setConnected(true);
    }).catch(reason=>{if(!disposed)setError(String(reason instanceof Error?reason.message:reason));});
    const unload=(event:BeforeUnloadEvent)=>{if(active.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return ()=>{disposed=true;controller.current?.abort();bridge.dispose();client.current=null;window.removeEventListener('beforeunload',unload);};
  },[id,path]);
  const begin=()=>{if(active.current||!client.current||!connected)return null;active.current=true;setBusy(true);setError('');setResult('');setImported('');setProgress(null);const abort=new AbortController();controller.current=abort;return abort;};
  const finish=()=>{active.current=false;controller.current=null;setBusy(false);};
  const fail=(reason:unknown,signal:AbortSignal)=>{
    if(signal.aborted || reason instanceof DOMException && reason.name==='AbortError')setResult(id?'Export cancelled.':'Import cancelled. Completed songs are kept; select the same package to continue.');
    else setError(reason instanceof Error?reason.message:String(reason));
  };
  const exportZip=async()=>{
    const abort=begin();if(!abort||!path)return;
    let output:FileSystemWritableFileStream|undefined;
    try {
      const picker=(window as unknown as {showSaveFilePicker?:SavePicker}).showSaveFilePicker;
      if(!picker)throw new Error('Use desktop Chrome to save a large playlist ZIP directly to disk.');
      const handle=await picker.call(window,{suggestedName:`${(collection?.collection.title || 'ktv420-playlist').replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,100)}.zip`,types:[{description:'ktv420 playlist ZIP',accept:{'application/zip':['.zip']}}]});
      abort.signal.throwIfAborted();output=await handle.createWritable();
      const done=await exportPlaylist(client.current!,path,new WritableStream<Uint8Array>({
        write: chunk => output!.write(chunk as Uint8Array<ArrayBuffer>),
        close: () => output!.close(),
        abort: reason => output!.abort(reason),
      }),abort.signal,setProgress);
      setResult(`ZIP saved.${done.missingArtwork?' Some covers could not be downloaded; their online links are included.':''}`);
    }catch(reason){if(output)await output.abort().catch(()=>{});fail(reason,abort.signal);}finally{finish();}
  };
  const importFiles=async(files:File[],folder:boolean)=>{
    const abort=begin();if(!abort)return;let source:PackageSource|undefined;
    try {
      source=folder?await openFolder(files,abort.signal):await openZip(files[0],abort.signal);
      const done=await importPlaylist(client.current!,source,abort.signal,setProgress);
      setResult(`${done.saved} songs imported${done.skipped?` · ${done.skipped} already ready`:''}.`);setImported(done.path);
    }catch(reason){fail(reason,abort.signal);}finally{try{await source?.close();}finally{finish();}}
  };
  return <main className="iframe-page saved-page"><section className="saved-content transfer-page">
    <header><a className="app-title" href={catalog}>ktv420</a><h1>{id?'Export playlist':'Import playlist'}</h1><p>{id?'Original + four stems. Same MP3s, no recompression.':'Choose a ktv420 ZIP or its extracted folder. Already-ready songs stay as they are.'}</p></header>
    {collection&&<p><strong>{collection.collection.title}</strong> · {collection.collection.trackIds.length} songs · about {size(collection.bytes)}</p>}
    <div className="transfer-actions">
      {id?<button disabled={!connected||busy} onClick={()=>void exportZip()}>Save ZIP</button>:<>
        <button disabled={!connected||busy} onClick={()=>zipInput.current?.click()}>Import ZIP</button>
        <button disabled={!connected||busy} onClick={()=>folderInput.current?.click()}>Import folder</button>
        <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';if(files.length)void importFiles(files,false);}} />
        <input ref={folderInput} type="file" multiple {...{webkitdirectory:''}} hidden onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';if(files.length)void importFiles(files,true);}} />
      </>}
      {busy&&<button onClick={()=>{controller.current?.abort();setResult('Stopping after the current storage operation…');}}>Cancel</button>}
    </div>
    {!connected&&!error&&<p role="status">Opening local library…</p>}
    {progress&&<div className="transfer-progress" aria-live="polite"><progress aria-label="Transfer progress" max={Math.max(1,progress.total)} value={Math.min(progress.bytes,progress.total)} /><p>{progress.label}</p><p>{progress.song} / {progress.songs} songs · {size(progress.bytes)} / {size(progress.total)}</p></div>}
    {result&&<p role="status">{result}</p>}{error&&<p role="alert">{error}</p>}
    <nav className="transfer-actions">{imported&&<a href={localPlaylistLink(imported,extension)}>Open playlist</a>}<a href={catalog}>Catalog</a></nav>
    {!id&&<p className="transfer-note">Keep this tab open while importing. If interrupted, select the same package to continue.</p>}
  </section></main>;
}
