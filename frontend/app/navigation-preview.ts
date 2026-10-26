// Dev-only integration fixture. Exercises the real broker, LibraryPage and Player.
import { saveInput, transaction } from './src/features/local/library';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import { rememberCollection } from './src/extension/collectionRegistry';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const tracks = ['First', 'Second', 'Third', 'Missing'].map((name, rowIndex) => ({trackId:`navigationFixture${rowIndex}`,trackName:`${name} song`,trackArtist:'Navigation preview',trackArtworkSrc:'',rowIndex}));
if (new URLSearchParams(location.search).has('duplicates')) tracks[2] = {...tracks[1], rowIndex: 2};
localStorage.setItem('ktv420-auto-processing','paused');
for (const track of tracks.slice(0,3)) {
  const samples = new Float32Array(44100 * 8);
  const blob = new Blob([encodeFloat32Wav({left:samples,right:samples,sampleRate:44100})],{type:'audio/wav'});
  const id=`spotify-${track.trackId}`;
  await saveInput({id,title:track.trackName,artist:track.trackArtist,createdAt:1,sampleRate:44100,frames:samples.length,status:'captured',source:'spotify',bytes:blob.size},blob);
  await transaction(['tracks','audio'],'readwrite',tx=>{
    const request=tx.objectStore('tracks').get(id);
    request.onsuccess=()=>tx.objectStore('tracks').put({...request.result,status:'ready'});
    for(const name of ['drums','bass','other','vocals']) tx.objectStore('audio').put({key:`${id}/${name}.wav`,trackId:id,name:`${name}.wav`,blob});
  });
}
const spotifyPath='album/1111111111111111111111';
await rememberCollection({path:spotifyPath,title:'Navigation preview',artwork:'',trackIds:tracks.map(t=>t.trackId)});
const frame=document.querySelector('iframe')!;
const waitForTracks = new URLSearchParams(location.search).has('wait');
let tracksLoaded = !waitForTracks;
if (waitForTracks) frame.style.visibility='hidden';
let navigation={revision:1,open:true,trackIndex:Number(new URLSearchParams(location.search).get('ktv420')) || null as number|null};
let trackId=tracks[0].trackId,playing=true,position=2,pausedAt=0;
const url=document.getElementById('url')!;
function post(){
  if(pausedAt && Date.now()-pausedAt>1000) playing=false;
  url.textContent=`${!tracksLoaded ? 'Waiting for Spotify · ' : frame.style.visibility === 'hidden' ? 'Waiting for render · ' : 'Ready · '}?ktv420${navigation.trackIndex ? `=${navigation.trackIndex}` : ''}`;
  frame.contentWindow!.postMessage({source:'ktv420-parent',version:2,type:'state',spotifyPath,navigation,tracks:tracksLoaded ? tracks : [],active:false,starting:false,supported:true,
    listening:{capability:1,trackId,position,duration:8,playing,local:true,output:'stems',volume:0,observedAt:Date.now(),generation:1,error:''}},location.origin);
}
window.addEventListener('message',event=>{
  if(event.source!==frame.contentWindow || event.origin!==location.origin || event.data?.source!=='ktv420-overlay')return;
  if(event.data.type==='ready')post();
  if(event.data.type==='view-ready' && tracksLoaded && event.data.spotifyPath===spotifyPath && event.data.revision===navigation.revision) frame.style.visibility='visible';
  if(event.data.type==='view') {navigation={...navigation,trackIndex:event.data.trackIndex};history[event.data.replace?'replaceState':'pushState']({},'',`?ktv420${navigation.trackIndex ? `=${navigation.trackIndex}` : ''}`);post();}
  if(event.data.type==='transport') {
    const command=event.data.command;
    if(command.action==='pause') pausedAt=Date.now();
    if(command.action==='select') {trackId=command.trackId;playing=true;pausedAt=0;position=0;}
    if(command.action==='seek')position=command.position;
  }
});
const navigate=(index:number|null)=>{navigation={revision:navigation.revision+1,open:true,trackIndex:index};history.pushState({},'',`?ktv420${index ? `=${index}` : ''}`);post();};
document.getElementById('collection')!.onclick=()=>navigate(null);
document.getElementById('second')!.onclick=()=>navigate(2);
document.getElementById('missing')!.onclick=()=>navigate(4);
window.addEventListener('popstate',()=>{navigation={revision:navigation.revision+1,open:true,trackIndex:Number(new URLSearchParams(location.search).get('ktv420')) || null};post();});
if (waitForTracks) setTimeout(()=>{tracksLoaded=true;post();},2500);
setInterval(post,250);
frame.src='/broker.html';
