// Dev-only fixture: real transfer page and broker, synthetic file inputs and disk sink.
import {createRoot} from 'react-dom/client';
import TransferPage from './src/pages/TransferPage';
import PlaylistPage from './src/pages/PlaylistPage';
import SavedPage from './src/pages/SavedPage';
import {savedCollection,savedCollections} from './src/extension/collectionRegistry';
import './src/styles/theme.css';import './src/index.css';
if(!import.meta.env.DEV)throw new Error('Development fixture only');
Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{sendMessage(_id:string,message:{type:string;path:string},reply:(v:unknown)=>void){
 if(message.type==='ktv420:collection')void savedCollection(message.path).then(collection=>reply({ok:true,collection}));
 else if(message.type==='ktv420:saved-collections')void savedCollections().then(collections=>reply({ok:true,collections}));
}}}});
// Small fixture export verifies the real ZIP stream without a native Save As dialog.
Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async()=>({createWritable:async()=>{
 const chunks:Uint8Array<ArrayBuffer>[]=[];
 return {write(chunk:Uint8Array){chunks.push(Uint8Array.from(chunk));},abort(){chunks.length=0;},close(){const a=document.createElement('a');a.textContent='Download verified fixture ZIP';a.href=URL.createObjectURL(new Blob(chunks,{type:'application/zip'}));a.download='verified-fixture.zip';document.body.append(a);}};
}})});
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('view') === 'playlist' ? <PlaylistPage /> : new URLSearchParams(location.search).get('view') === 'catalog' ? <SavedPage /> : <TransferPage />);
