import {createStereoTap,waveform,signalRms} from './src/features/stems/player/visuals/analysis.ts';
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
window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;const d=event.data;if(d?.source!=='ktv420-overlay')return;if(d.type==='listening-heartbeat'&&!suppressHeartbeat)controller.heartbeat();if(d.type==='transport')void controller.command(d.command);if(d.type==='ready')post();if(d.type==='close'){frame.hidden=true;void controller.command({action:'pause'});frame.contentWindow.postMessage({source:'ktv420-parent',version:2,type:'closed'},location.origin);}});
document.querySelector('#seed').onclick=async()=>{for(const i of [0,2]){const id=`spotify-${ids[i]}`;const track={id,title:`DOM song ${i+1}`,artist:'Test artist',source:'spotify',createdAt:Date.now(),status:'ready',sampleRate:44100,frames:44100*8,bytes:blobs[i].size*5,metadata:metadata[i]};await saveInput(track,blobs[i]);await transaction(['tracks','audio'],'readwrite',tx=>{tx.objectStore('tracks').put(track);for(const stem of ['drums','bass','vocals','other'])tx.objectStore('audio').put({key:`${id}/${stem}.wav`,trackId:id,name:`${stem}.wav`,blob:blobs[i]});});}report.textContent='Saved stems prepared for songs 1 and 3.';};
document.querySelector('#check').onclick=async()=>{const saved=await listTracks();let peak=null;try{const decoded=decodeWav(await(await getInput(`spotify-${ids[1]}`)).arrayBuffer());peak=Math.max(...decoded.left.slice(4410,8820).map(Math.abs));}catch{}report.textContent=JSON.stringify({saved:saved.map(t=>({id:t.id,status:t.status,frames:t.frames})),peak,listening},null,2);};
document.querySelector('#snapshot').onclick=async()=>{report.textContent=JSON.stringify({listening,page:await bridge.command('listening-state'),sourceCounter},null,2);};
document.querySelector('#lose').onclick=()=>{audio.pause();audio.removeAttribute('src');audio.load();};
select(0,false);

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(predicate,description,timeout=5000)=>{const start=Date.now();while(!await predicate()){if(Date.now()-start>timeout)throw Error(description);await sleep(50);}};
const results=[];
function assert(value,message){if(!value)throw Error(message);results.push(message);report.textContent=JSON.stringify({running:true,results},null,2);}
document.querySelector('#suite').onclick=async()=>{try{
 results.length=0;
 audio.pause(); for(const id of ids)await deleteTrack(`spotify-${id}`); await document.querySelector('#seed').onclick();
 select(0,false);await sleep(2200);await audio.play();
 await until(()=>listening?.output==='stems','saved stems not selected');
 assert((await bridge.command('listening-state')).monitorGain===0,'Spotify output muted while stems play');
 await controller.command({action:'pause'});await until(()=>!listening.playing,'pause not reflected');assert(audio.paused,'App pause controls Spotify DOM');
 await controller.command({action:'seek',position:3,trackId:ids[0]});assert(Math.abs(audio.currentTime-3)<.2,'App seek controls Spotify DOM');
 await controller.command({action:'play'});await until(()=>listening.playing,'resume not reflected');assert(!audio.paused,'App play resumes Spotify DOM');
 await controller.command({action:'rate',trackId:ids[0],rate:1.5});
 assert(audio.playbackRate===1.5,'Prepared playback accepts tempo');
 suppressHeartbeat=true;await sleep(2200);assert(audio.playbackRate===1,'Heartbeat loss restores normal speed');
 await controller.command({action:'next'});await until(()=>listening?.trackId===ids[1]&&listening.capturing,'cold player did not begin capture');
 assert(audio.playbackRate===1,'Next uncaptured song uses original speed');
 assert(listening.output==='muted','Cold player captures immediately but stays silent until ready');suppressHeartbeat=false;
 await until(()=>listening?.trackId===ids[1]&&listening.output==='capture','unsaved capture not selected');
 await controller.command({action:'volume',volume:.37});assert(Math.abs(audio.volume-.37)<.001,'Listening volume preserves precise values on Spotify stepped sliders');
 await controller.command({action:'volume',volume:0});await until(()=>listening.volume===0,'volume not set');await until(async()=>(await bridge.command('listening-state')).monitorGain===0,'Zero volume did not silence monitoring');assert(true,'Zero listening volume silences capture monitoring');
 await sleep(400);audio.pause();await sleep(1800);assert(!listening.playing&&listening.output==='muted','Remote DOM pause holds capture without adding silence');await audio.play();
 await until(()=>listening.trackId===ids[2], 'song did not finish',12000);await sleep(1500);
 const captured=(await listTracks()).find(t=>t.id===`spotify-${ids[1]}`);assert(captured?.status==='captured','Complete paused/resumed capture saved');
 const decoded=decodeWav(await(await getInput(captured.id)).arrayBuffer());const peak=Math.max(...decoded.left.slice(4410,8820).map(Math.abs));assert(peak>.079&&peak<.081,'Muted capture retains original PCM amplitude');assert(Math.abs(decoded.left.length/decoded.sampleRate-8)<.4,'Pause adds no recording silence');
 assert((await listTracks()).find(t=>t.id===`spotify-${ids[0]}`).status==='ready','Existing ready stems never overwritten');
 await controller.command({action:'pause'});select(1,false);await deleteTrack(`spotify-${ids[1]}`);await sleep(2200);await audio.play();await sleep(700);audio.currentTime=5;await sleep(400);select(2);await sleep(1300);
 assert(!(await listTracks()).some(t=>t.id===`spotify-${ids[1]}`),'Seeked/skipped partial recording rejected');
 await controller.command({action:'rate',trackId:ids[2],rate:1.25});audio.playbackRate=1;
 await until(()=>audio.paused&&!!listening.error,'Unexpected tempo reset was not detected');
 assert(!!listening.error,'Rejected/reset tempo stops synchronized playback explicitly');
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
 const tempoInput=playerDoc().querySelector('input[aria-label="Tempo"]'),pitchInput=playerDoc().querySelector('input[aria-label="Pitch"]');
 setter.call(tempoInput,'1.25');tempoInput.dispatchEvent(new (playerWindow().Event)('input',{bubbles:true}));
 await until(()=>listening?.playbackRate===1.25,'tempo did not reach Spotify');await sleep(250);
 setter.call(pitchInput,'3');pitchInput.dispatchEvent(new (playerWindow().Event)('input',{bubbles:true}));await sleep(250);
 assert(Math.abs(audio.playbackRate-1.25)<.001,'Spotify companion follows DJ tempo');
 await controller.command({action:'pause'});await sleep(350);
 await controller.command({action:'seek',trackId:ids[0],position:1});await controller.command({action:'play'});await sleep(350);
 select(2);await until(()=>playerDoc().querySelector('h3')?.textContent==='DOM song 3' && button('Stop and save recording')&&!button('Stop and save recording').disabled,'recording did not follow next song');
 await sleep(1800);
 button('Stop and save recording').click();await sleep(500);
 const recording=await loadPerformance('last');if(!recording)throw Error('recording did not save');
 assert(recording.version===3&&recording.spotifyPath===`playlist/${ids[0]}`,'record includes versioned Spotify context');
 const values=recording.events.filter(e=>e.type==='mix').flatMap(e=>e.snapshot.stems.map(s=>s.volume));
 assert(recording.events.some(e=>e.snapshot?.tempo===1.25)&&recording.events.some(e=>e.snapshot?.pitch===3),'tempo and independent pitch recorded');
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
 textButton('Play recording').click();
 await until(()=>textButton('Pause recording')&&!textButton('Pause recording').disabled && listening?.playing,'replay restart did not play');
 playerWindow().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 await until(()=>frame.hidden && audio.paused && !textButton('Stop replay'),'Escape did not close and pause');
 await sleep(2000);
 assert(audio.paused && !textButton('Stop replay'),'Escape closes overlay and leaves replay and Spotify paused');
 frame.hidden=false;
 textButton('Play recording').click();
 await until(()=>textButton('Stop replay'),'replay preparation did not begin');
 playerWindow().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 await sleep(2000);
 assert(frame.hidden && audio.paused && !textButton('Stop replay'),'Escape during preparation cancels pending replay actions');
 report.textContent=JSON.stringify({ok:true,results,eventTypes:recording.events.map(e=>e.type)},null,2);
 }catch(error){report.textContent=JSON.stringify({ok:false,error:String(error),results},null,2);audio.pause();}};

// Compare the actual visualizer/mixer renderer at neutral and worst-range settings.
document.querySelector('#tempo-performance').onclick=async()=>{const rows=[];try{
 await document.querySelector('#seed').onclick();select(0);await sleep(2600);
 const win=()=>frame.contentDocument.querySelector('iframe').contentWindow,doc=()=>win().document;
 const leave=[...doc().querySelectorAll('button')].find(b=>b.textContent==='Leave recording');if(leave)leave.click();
 await until(()=>doc().querySelector('input[aria-label="Tempo"]'),'player not ready',12000);
 await controller.command({action:'volume',volume:0});
 const setter=Object.getOwnPropertyDescriptor(win().HTMLInputElement.prototype,'value').set;
 for(const [rate,pitch] of [[1,0],[1.5,12],[.5,-12]]) {
  await controller.command({action:'pause'});await controller.command({action:'seek',trackId:ids[0],position:.5});
  await controller.command({action:'rate',trackId:ids[0],rate});
  const input=doc().querySelector('input[aria-label="Pitch"]');setter.call(input,String(pitch));input.dispatchEvent(new (win().Event)('input',{bubbles:true}));
  await controller.command({action:'play'});await sleep(450);
  const gaps=[];let previous=performance.now(),last=previous;
  await new Promise(resolve=>{const start=performance.now();const tick=()=>{const now=performance.now();gaps.push(now-previous);previous=now;last=now;if(now-start>=3000)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  gaps.sort((a,b)=>a-b);
  const displayed=Number(doc().querySelector('input[aria-label="Playback position"]').value);
  rows.push({rate,pitch,fps:Math.round(1000*gaps.length/gaps.reduce((a,b)=>a+b,0)),p95FrameMs:gaps[Math.floor(gaps.length*.95)],maxFrameMs:gaps.at(-1),driftSeconds:Math.abs(displayed-audio.currentTime),finishedAt:last});
  report.textContent=JSON.stringify({running:true,rows},null,2);
 }
 await controller.command({action:'pause'});await controller.command({action:'rate',rate:1,trackId:ids[0]});
 const passed=rows.every(row=>row.fps>=rows[0].fps*.9&&row.maxFrameMs<150&&row.driftSeconds<.5);
 report.textContent=JSON.stringify({passed,rows},null,2);
}catch(error){audio.pause();report.textContent=JSON.stringify({passed:false,error:String(error),rows,listening},null,2);}};

// Exercise production React controls, real audio nodes and mode selection at Retina density.
document.querySelector('#visual-suite').onclick=async()=>{const rows=[];try{
 results.length=0;
 const offline=new OfflineAudioContext(2,4410,44100),buffer=offline.createBuffer(2,4410,44100);
 for(let i=0;i<4410;i++){buffer.getChannelData(0)[i]=.2*Math.sin(i*2*Math.PI*440/44100);buffer.getChannelData(1)[i]=.1*Math.sin(i*2*Math.PI*660/44100);}
 const source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);const tap=createStereoTap(source);
 const suspended=offline.suspend(.05);source.start();const rendered=offline.startRendering();await suspended;
 const left=waveform(tap.left),right=waveform(tap.right);
 assert(Math.abs(signalRms(left)/signalRms(right)-2)<.08,'Stereo taps preserve independent left/right levels');
 await offline.resume();const output=await rendered;let error=0;
 for(let c=0;c<2;c++)for(let i=0;i<4410;i++)error=Math.max(error,Math.abs(output.getChannelData(c)[i]-buffer.getChannelData(c)[i]));
 assert(error<1e-7,'Stereo analysis adds no audio to the output');tap.dispose();
 await document.querySelector('#seed').onclick();select(0);await sleep(2600);
 const win=()=>frame.contentDocument.querySelector('iframe').contentWindow,doc=()=>win().document;
 const leave=[...doc().querySelectorAll('button')].find(b=>b.textContent==='Leave recording');if(leave)leave.click();
 await until(()=>doc().querySelector('input[aria-label="Tempo"]'),'player not ready',12000);
 await controller.command({action:'volume',volume:0});
 const textButton=label=>[...doc().querySelectorAll('button')].find(b=>b.textContent.trim()===label);
 const setter=Object.getOwnPropertyDescriptor(win().HTMLInputElement.prototype,'value').set;
 const playerContent=()=>doc().querySelector('.iframe-content');
 frame.scrollIntoView({block:'start'});
 const paintCount={count:0};const proto=win().CanvasRenderingContext2D.prototype,fill=proto.fillRect;
 proto.fillRect=function(...args){paintCount.count++;return fill.apply(this,args);};
 try {
 for(const name of ['Time Ribbon','Stem Weather','Spectrogram','Stereo Bloom']) {
  await controller.command({action:'pause'});await controller.command({action:'seek',trackId:ids[0],position:.3});
  await controller.command({action:'rate',trackId:ids[0],rate:1.5});
  const input=doc().querySelector('input[aria-label="Pitch"]');setter.call(input,'12');input.dispatchEvent(new (win().Event)('input',{bubbles:true}));
  textButton(name).click();playerContent().scrollTop=0;await controller.command({action:'play'});await sleep(250);
  const canvases=[...doc().querySelectorAll('canvas')];
  assert(canvases.length===(name==='Stem Weather'?1:5),name+' uses the intended canvas count');
  assert(canvases.every(c=>c.width*c.height<=1505000&&c.width>=c.clientWidth),name+' has bounded Retina resolution');
  const paintedBefore=paintCount.count;
  const gaps=[];let previous=performance.now();const start=previous;
  await new Promise(resolve=>{const tick=()=>{const now=performance.now();gaps.push(now-previous);previous=now;if(now-start>=2200)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  gaps.sort((a,b)=>a-b);rows.push({name,fps:Math.round(1000*gaps.length/gaps.reduce((a,b)=>a+b,0)),p95FrameMs:gaps[Math.floor(gaps.length*.95)],maxFrameMs:gaps.at(-1)});
  assert(paintCount.count>paintedBefore,name+' actually paints visible canvases');
  assert(!doc().querySelector('[role="alert"]'),name+' keeps playback healthy');
  if(name==='Spectrogram') {
   await controller.command({action:'pause'});await sleep(150);
   const canvas=canvases[0],before=canvas.toDataURL();
   const pixels=canvas.getContext('2d').getImageData(Math.round(canvas.width*.6),20,Math.round(canvas.width*.3),canvas.height-40).data;
   assert(pixels.some((v,i)=>i%4===0&&v>120),'Paused spectrogram retains captured frequencies');await sleep(250);
   assert(canvas.toDataURL()===before,'Spectrogram history freezes while paused');
   const seekInput=doc().querySelector('input[aria-label="Playback position"]');setter.call(seekInput,'1');seekInput.dispatchEvent(new (win().Event)('input',{bubbles:true}));await sleep(250);
   assert(canvas.toDataURL()!==before,'Seeking clears stale spectrogram history');
  }

 }
 const playerView=doc().querySelector('.iframe-player-view');playerView.hidden=true;await sleep(150);const hiddenPaint=paintCount.count;await sleep(300);
 assert(paintCount.count===hiddenPaint,'Hidden canvases skip painting during playback');playerView.hidden=false;
 await controller.command({action:'pause'});await sleep(1900);const stopped=paintCount.count;await sleep(400);
 assert(paintCount.count===stopped,'Paused canvases stop redundant painting');
 textButton('Stem Weather').click();playerContent().scrollTop=0;await sleep(150);
 const muteButtons=[...doc().querySelectorAll('.player-track-row button[aria-label="Mute"]')];muteButtons.forEach(button=>button.click());
 await sleep(200);const canvas=doc().querySelector('.stem-weather canvas'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
 let uniform=true;for(let i=4;i<pixels.length;i+=4)if(pixels[i]!==pixels[0]||pixels[i+1]!==pixels[1]||pixels[i+2]!==pixels[2]){uniform=false;break;}
 assert(uniform,'All muted stems leave no Weather contribution');
 // Select a new mode while recording, then ensure its snapshot can be replayed.
 const recordButton=doc().querySelector('button[aria-label="Start recording"]');recordButton.click();await sleep(250);
 textButton('Stereo Bloom').click();await sleep(100);textButton('Spectrogram').click();await sleep(100);textButton('Stem Weather').click();await sleep(100);
 win().HTMLAnchorElement.prototype.click=function(){};
 doc().querySelector('button[aria-label="Stop and save recording"]').click();await sleep(400);
 const recording=await loadPerformance('last');
 assert(['stem-weather','spectrogram','stereo-bloom'].every(mode=>recording.events.some(e=>e.snapshot?.visualizer===mode)),'Recording retains all new visualizer selections');
 frame.contentWindow.postMessage({source:'ktv420-parent',version:2,type:'replay',recording},location.origin);
 await until(()=>textButton('Play recording')&&!textButton('Play recording').disabled,'replay not ready');textButton('Play recording').click();
 await until(()=>textButton('Stop replay'),'replay did not start');await until(()=>textButton('Play recording')&&!textButton('Stop replay'),'replay did not finish');
 assert(!doc().querySelector('[role="alert"]'),'New visualizer snapshots replay successfully');
 textButton('Leave recording').click();
 }finally{proto.fillRect=fill;}
 await controller.command({action:'pause'});await controller.command({action:'rate',rate:1,trackId:ids[0]});
 report.textContent=JSON.stringify({passed:rows.every(row=>row.fps>=rows[0].fps*.9&&row.maxFrameMs<150),results,rows},null,2);
 }catch(error){audio.pause();report.textContent=JSON.stringify({passed:false,error:String(error),results,rows},null,2);}};
