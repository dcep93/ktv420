import {loadPerformance,savePerformance} from './src/features/local/performanceFiles.ts';
import hookUrl from '../../extension/src/page/spotifyHooks.js?url';
import workletUrl from '../../extension/src/page/pcmWorklet.js?url';
import { createListeningController } from '../../extension/src/content/listening.js';
import { createPageBridge } from '../../extension/src/content/pageBridge.js';
import { beginCapture, appendCapture, finishCapture } from './src/extension/capture.ts';
import { saveInput, listTracks, getInput, transaction, deleteTrack } from './src/features/local/library.ts';
import { encodeFloat32Wav, decodeWav } from './src/features/local/audio/wav.ts';
if (!import.meta.env.DEV) throw new Error('Development only');
localStorage.setItem('ktv420-auto-processing','paused');
const ids=['1111111111111111111111','2222222222222222222222','3333333333333333333333'];
let index=0, listening, sourceCounter=0, suppressHeartbeat=false;
const frame=document.querySelector('iframe'), report=document.querySelector('#report');
const metadata=ids.map((trackId,i)=>({trackId,trackName:`DOM song ${i+1}`,trackArtist:'Test artist',trackArtworkSrc:'',rowIndex:i}));
window.chrome={runtime:{getURL:path=>new URL(path.endsWith('spotifyHooks.js')?hookUrl:path.endsWith('pcmWorklet.js')?workletUrl:`/${path}`,location.origin).href,
 async sendMessage(message){try{let result;
 if(message.type==='ktv420:listening-claim')result=true;
 else if(message.type==='ktv420:library-status')result=(await listTracks()).map(t=>({trackId:t.metadata?.trackId,status:t.status}));
 else if(message.type==='ktv420:capture-begin')result=await beginCapture(777,message.metadata,message.bytes);
 else if(message.type==='ktv420:capture-chunk')result=await appendCapture(777,message.id,message.index,message.base64);
 else if(message.type==='ktv420:capture-finish')result=await finishCapture(777,message.id);
 else throw new Error(message.type);
 return {ok:true,result};}catch(e){return{ok:false,error:String(e)}}}
}};
const bridge=createPageBridge();await bridge.inject();
const audio=new Audio(); // Deliberately detached: Spotify creates detached media too.
function wav(hz){const samples=new Float32Array(44100*8);for(let i=0;i<samples.length;i++)samples[i]=.08*Math.sin(2*Math.PI*hz*i/44100);return new Blob([encodeFloat32Wav({left:samples,right:samples,sampleRate:44100})],{type:'audio/wav'});}
const blobs=ids.map((_,i)=>wav(220+i*110));
function select(i,play=true){index=(i+ids.length)%ids.length;document.querySelector('[data-testid="context-item-info-title"]').href=`/track/${ids[index]}`;document.querySelector('[data-testid="context-item-info-title"]').textContent=`DOM song ${index+1}`;audio.src=URL.createObjectURL(blobs[index]);sourceCounter++;if(play)void audio.play();}
const play=document.querySelector('[data-testid="control-button-playpause"]'), seek=document.querySelector('input[max="8000"]'), volume=document.querySelector('input[max="1"]');
play.onclick=()=>{if(audio.paused)void audio.play();else audio.pause();};
document.querySelector('[data-testid="control-button-skip-forward"]').onclick=()=>select(index+1);
document.querySelector('[data-testid="control-button-skip-back"]').onclick=()=>audio.currentTime>3?audio.currentTime=0:select(index-1);
seek.onchange=()=>{audio.currentTime=Number(seek.value)/1000;};volume.onchange=()=>{audio.volume=Number(volume.value);};
audio.onended=()=>select(index+1);
setInterval(()=>{play.textContent=audio.paused?'Play':'Pause';play.setAttribute('aria-label',play.textContent);seek.value=String(audio.currentTime*1000);seek.setAttribute('aria-valuetext',`0:${String(Math.floor(audio.currentTime)).padStart(2,'0')}/0:08`);},50);
const post=()=>{frame.contentWindow.postMessage({source:'ktv420-parent',version:2,type:'state',spotifyPath:`playlist/${ids[0]}`,tracks:metadata,active:!!listening?.capturing,starting:false,supported:true,error:'',notice:'',listening,captureProgress:listening?.captureProgress||null},location.origin);};
const controller=createListeningController({bridge,emit:state=>{listening=state;post();},ensurePlayer:()=>{},getRunner:()=>null});
window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;const d=event.data;if(d?.source!=='ktv420-overlay')return;if(d.type==='listening-heartbeat'&&!suppressHeartbeat)controller.heartbeat();if(d.type==='transport')void controller.command(d.command);if(d.type==='ready')post();});
document.querySelector('#seed').onclick=async()=>{for(const i of [0,2]){const id=`spotify-${ids[i]}`;const track={id,title:`DOM song ${i+1}`,artist:'Test artist',source:'spotify',createdAt:Date.now(),status:'ready',sampleRate:44100,frames:44100*8,bytes:blobs[i].size*5,metadata:metadata[i]};await saveInput(track,blobs[i]);await transaction(['tracks','audio'],'readwrite',tx=>{tx.objectStore('tracks').put(track);for(const stem of ['drums','bass','vocals','other'])tx.objectStore('audio').put({key:`${id}/${stem}.wav`,trackId:id,name:`${stem}.wav`,blob:blobs[i]});});}report.textContent='Saved stems prepared for songs 1 and 3.';};
document.querySelector('#check').onclick=async()=>{const saved=await listTracks();let peak=null;try{const decoded=decodeWav(await(await getInput(`spotify-${ids[1]}`)).arrayBuffer());peak=Math.max(...decoded.left.slice(4410,8820).map(Math.abs));}catch{}report.textContent=JSON.stringify({saved:saved.map(t=>({id:t.id,status:t.status,frames:t.frames})),peak,listening},null,2);};
document.querySelector('#snapshot').onclick=async()=>{report.textContent=JSON.stringify({listening,page:await bridge.command('listening-state'),sourceCounter},null,2);};
document.querySelector('#lose').onclick=()=>{audio.pause();audio.removeAttribute('src');audio.load();};
select(0,false);

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(predicate,description,timeout=5000)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw Error(description);await sleep(50);}};
const results=[];
function assert(value,message){if(!value)throw Error(message);results.push(message);report.textContent=JSON.stringify({running:true,results},null,2);}
document.querySelector('#suite').onclick=async()=>{try{
 audio.pause(); for(const id of ids)await deleteTrack(`spotify-${id}`); await document.querySelector('#seed').onclick();
 select(0,false);await sleep(2200);await audio.play();
 await until(()=>listening?.output==='stems','saved stems not selected');
 assert((await bridge.command('listening-state')).monitorGain===0,'Spotify output muted while stems play');
 await controller.command({action:'pause'});await until(()=>!listening.playing,'pause not reflected');assert(audio.paused,'App pause controls Spotify DOM');
 await controller.command({action:'seek',position:3,trackId:ids[0]});assert(Math.abs(audio.currentTime-3)<.2,'App seek controls Spotify DOM');
 await controller.command({action:'play'});await until(()=>listening.playing,'resume not reflected');assert(!audio.paused,'App play resumes Spotify DOM');
 suppressHeartbeat=true;await sleep(2200);
 await controller.command({action:'next'});await until(()=>listening?.trackId===ids[1]&&listening.capturing,'cold player did not begin capture');
 assert(listening.output==='muted','Cold player captures immediately but stays silent until ready');suppressHeartbeat=false;
 await until(()=>listening?.trackId===ids[1]&&listening.output==='capture','unsaved capture not selected');
 await controller.command({action:'volume',volume:.37});assert(Math.abs(audio.volume-.37)<.001,'Listening volume preserves precise values on Spotify stepped sliders');
 await controller.command({action:'volume',volume:0});await until(()=>listening.volume===0,'volume not set');assert((await bridge.command('listening-state')).monitorGain===0,'Zero listening volume silences capture monitoring');
 await sleep(400);audio.pause();await sleep(1800);assert(!listening.playing&&listening.output==='muted','Remote DOM pause holds capture without adding silence');await audio.play();
 await until(()=>listening.trackId===ids[2], 'song did not finish',12000);await sleep(1500);
 const captured=(await listTracks()).find(t=>t.id===`spotify-${ids[1]}`);assert(captured?.status==='captured','Complete paused/resumed capture saved');
 const decoded=decodeWav(await(await getInput(captured.id)).arrayBuffer());const peak=Math.max(...decoded.left.slice(4410,8820).map(Math.abs));assert(peak>.079&&peak<.081,'Muted capture retains original PCM amplitude');assert(Math.abs(decoded.left.length/decoded.sampleRate-8)<.4,'Pause adds no recording silence');
 assert((await listTracks()).find(t=>t.id===`spotify-${ids[0]}`).status==='ready','Existing ready stems never overwritten');
 await controller.command({action:'pause'});select(1,false);await deleteTrack(`spotify-${ids[1]}`);await sleep(2200);await audio.play();await sleep(700);audio.currentTime=5;await sleep(400);select(2);await sleep(1300);
 assert(!(await listTracks()).some(t=>t.id===`spotify-${ids[1]}`),'Seeked/skipped partial recording rejected');
 audio.pause();audio.removeAttribute('src');audio.load();await until(()=>!listening.local,'local ownership not lost');assert(listening.output==='muted','Losing local media silences output');
 report.textContent=JSON.stringify({passed:true,results},null,2);
 }catch(error){audio.pause();report.textContent=JSON.stringify({passed:false,error:String(error),results,listening},null,2);}};

document.querySelector('#range-test').onclick = () => {
  const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '.1';
  input.value = '.37'; const stepped = input.value;
  input.step = 'any'; input.value = '.37'; const exact = input.value;
  input.step = '.1'; const restored = input.value;
  document.querySelector('#range-result').textContent = JSON.stringify({stepped, exact, restored});
};


// Exercise the shipped React recorder, broker and replay coordinator with synthetic audio.
const tracklist=document.createElement('div');tracklist.dataset.testid='playlist-tracklist';
for(const [i,item] of metadata.entries()) {
 const row=document.createElement('div');row.dataset.testid='tracklist-row';
 const anchor=document.createElement('a');anchor.href=`/track/${item.trackId}`;anchor.textContent=item.trackName;
 row.append(anchor);row.ondblclick=()=>select(i);tracklist.append(row);
}
document.body.append(tracklist);
document.querySelector('#record-replay-suite').onclick=async()=>{try{
 results.length=0;
 await document.querySelector('#seed').onclick();select(0);await sleep(2800);
 const playerWindow=()=>frame.contentDocument.querySelector('iframe').contentWindow;
 const playerDoc=()=>playerWindow().document;
 const button=label=>playerDoc().querySelector(`button[aria-label="${label}"]`);
 const textButton=text=>[...playerDoc().querySelectorAll('button')].find(b=>b.textContent===text);
 await until(()=>button('Pause')&&!button('Pause').disabled,'mixer not ready',12000);
 button('Pause').click();await until(()=>button('Start recording')&&!button('Start recording').disabled,'record unavailable');
 // Avoid producing fixture downloads on the user's computer.
 playerWindow().HTMLAnchorElement.prototype.click=function(){};
 await savePerformance('last',null);await savePerformance('draft',null);
 button('Start recording').click();await until(()=>listening?.playing,'record did not start Spotify');
 await sleep(300);
 const volumeInput=playerDoc().querySelector('.player-track-row input[type="range"][max="2"]');
 if(!volumeInput)throw Error('mixer volume not found');
 const setter=Object.getOwnPropertyDescriptor(playerWindow().HTMLInputElement.prototype,'value').set;
 for(const value of [.9,.7,.5]) {setter.call(volumeInput,String(value));volumeInput.dispatchEvent(new (playerWindow().Event)('input',{bubbles:true}));await sleep(70);}
 await controller.command({action:'pause'});await sleep(350);
 await controller.command({action:'seek',trackId:ids[0],position:1});await controller.command({action:'play'});await sleep(350);
 select(2);await until(()=>playerDoc().querySelector('h3')?.textContent==='DOM song 3' && button('Stop and save recording')&&!button('Stop and save recording').disabled,'recording did not follow next song');
 await sleep(1800);
 button('Stop and save recording').click();await sleep(500);
 const recording=await loadPerformance('last');if(!recording)throw Error('recording did not save');
 assert(recording.version===2&&recording.spotifyPath===`playlist/${ids[0]}`,'record includes versioned Spotify context');
 const values=recording.events.filter(e=>e.type==='mix').flatMap(e=>e.snapshot.stems.map(s=>s.volume));
 assert([.9,.7,.5].every(v=>values.includes(v)),'continuous fader samples retained');
 assert(recording.events.some(e=>e.type==='pause')&&recording.events.filter(e=>e.type==='play').length>=2,'remote pause and resume recorded');
 assert(recording.events.some(e=>e.type==='seek'),'remote seek recorded');
 assert(recording.tracks.length===2 && recording.events.filter(e=>e.type==='track').length===2,'recording spans songs without ending');
 frame.contentWindow.postMessage({source:'ktv420-parent',version:2,type:'replay',recording},location.origin);
 await until(()=>textButton('Play recording')&&!textButton('Play recording').disabled,'replay did not become ready');
 textButton('Play recording').click();
 await until(()=>textButton('Stop replay'),'replay did not start');
 await until(()=>textButton('Pause recording')&&!textButton('Pause recording').disabled && listening?.playing,'replay did not begin playing');
 textButton('Pause recording').click();await sleep(500);
 assert(audio.paused,'user can pause the entire replay');
 textButton('Resume recording').click();
 await until(()=>textButton('Play recording')&&!textButton('Stop replay'),'replay did not finish',20000);
 const alert=playerDoc().querySelector('[role="alert"]');
 assert(!alert,'replay completes without synchronization errors: '+(alert?.textContent||''));
 assert((await bridge.command('listening-state')).monitorGain===0,'Spotify remains silent during replay');
 assert(audio.paused,'recording stop pauses Spotify companion');
 report.textContent=JSON.stringify({ok:true,results,eventTypes:recording.events.map(e=>e.type)},null,2);
 }catch(error){report.textContent=JSON.stringify({ok:false,error:String(error),results},null,2);audio.pause();}};
