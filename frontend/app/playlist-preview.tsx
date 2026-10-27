// Development-only integration of the real standalone shell, broker and player.
import { createRoot } from 'react-dom/client';
import PlaylistPage from './src/pages/PlaylistPage';
import { saveInput, transaction } from './src/features/local/library';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import { rememberCollection, savedCollection } from './src/extension/collectionRegistry';
import './src/styles/theme.css';
import './src/index.css';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const path='album/7777777777777777777777';
const tracks=['First','Second','Missing'].map((name,index)=>({id:`standaloneFixture${index}`,title:`${name} song`}));
localStorage.setItem('ktv420-auto-processing','paused');
for(const track of tracks.slice(0,2)) {
  const samples=new Float32Array(44100*8);
  const blob=new Blob([encodeFloat32Wav({left:samples,right:samples,sampleRate:44100})],{type:'audio/wav'});
  const id=`spotify-${track.id}`;
  await saveInput({id,title:track.title,artist:'Local playlist check',createdAt:1,sampleRate:44100,frames:samples.length,status:'captured',source:'spotify',bytes:blob.size},blob);
  await transaction(['tracks','audio'],'readwrite',tx=>{
    const req=tx.objectStore('tracks').get(id);req.onsuccess=()=>tx.objectStore('tracks').put({...req.result,status:'ready'});
    for(const name of ['drums','bass','vocals','other']) tx.objectStore('audio').put({key:`${id}/${name}.wav`,trackId:id,name:`${name}.wav`,blob});
  });
}
await rememberCollection({path,title:'Standalone playlist check',artwork:'',trackIds:tracks.map(t=>t.id)},true);
Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{sendMessage(_id:string,message:{type:string;path:string},reply:(value:unknown)=>void){
  if(message.type==='ktv420:collection') void savedCollection(message.path).then(collection=>reply({ok:true,collection}));
}}}});
createRoot(document.getElementById('root')!).render(<PlaylistPage />);
