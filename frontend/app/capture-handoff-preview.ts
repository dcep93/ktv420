// Dev-only test of the real playlist UI with an intentionally delayed storage view.
// Audio, model downloads, and persistent writes are not needed for this regression.
import type { LocalTrack } from './src/features/local/library';
import type { CaptureProgress } from './src/features/local/captureProgress';
if (!import.meta.env.DEV) throw Error('Development fixture only');
const frame=document.querySelector('iframe')!,button=document.querySelector<HTMLButtonElement>('#run')!,report=document.querySelector('#result')!;
const tracks=[{trackId:'handoffOne',trackName:'First song',trackArtist:'Test',rowIndex:0},{trackId:'handoffTwo',trackName:'Second song',trackArtist:'Test',rowIndex:1}];
let saved:LocalTrack[]=[],captureProgress:CaptureProgress|null=null,error='',delayNextRead=false;
const staleReplies:(()=>void)[]=[];
const post=()=>frame.contentWindow!.postMessage({source:'ktv420-parent',version:2,type:'state',tracks,active:true,starting:false,supported:true,captureProgress,error,
 spotifyPath:'album/handoff',navigation:{revision:1,open:true,trackIndex:null}},location.origin);
window.addEventListener('message',event=>{
 if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
 const data=event.data;
 if(data.source==='ktv420-overlay'&&data.type==='ready')post();
 if(data.source==='ktv420-overlay'&&data.type==='view-ready'){button.disabled=false;}
 if(data.source==='ktv420-library'){
  const supported=['listTracks','getProcessingEnabled','acquireLock'];
  const result=data.method==='listTracks'?saved:false;
  const reply=()=>frame.contentWindow!.postMessage({source:'ktv420-library',version:2,id:data.id,ok:supported.includes(data.method),result,error:'Unsupported fixture operation'},location.origin);
  if(data.method==='listTracks'&&delayNextRead){delayNextRead=false;staleReplies.push(reply);}else reply();
 }
});
frame.src=`/?brokerOrigin=${encodeURIComponent(location.origin)}`;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const label=(index:number)=>frame.contentDocument?.querySelectorAll('.iframe-track-row')[index]?.getAttribute('aria-label')||'';
async function expectLabel(index:number,text:string){for(let i=0;i<40;i++){if(label(index).includes(text))return;await delay(50);}throw Error(`Expected ${text}, got ${label(index)}`);}
button.onclick=async()=>{
 button.disabled=true;const results:string[]=[];
 try{
  saved=[];error='';captureProgress={trackId:'handoffOne',fraction:.99,phase:'saving'};post();
  await expectLabel(0,'Saving…');results.push('Finished audio shows Saving');
  captureProgress={trackId:'handoffTwo',fraction:.01};post();
  await expectLabel(1,'Capturing 1%');
  for(let i=0;i<60;i++){if(!label(0).includes('Saving…'))throw Error(`Saving flickered: ${label(0)}`);await delay(50);}
  results.push('First song stays Saving for 3 seconds across stale storage polls and next-track capture');
  delayNextRead=true;captureProgress={trackId:'handoffTwo',fraction:.99,phase:'saving'};post();
  for(let i=0;i<40&&!staleReplies.length;i++)await delay(50);
  if(!staleReplies.length)throw Error('Expected a storage refresh on capture phase change');
  saved=[{id:'spotify-handoffOne',title:'First song',artist:'Test',status:'captured',source:'spotify',bytes:8,frames:1,sampleRate:48000,createdAt:Date.now()}];
  captureProgress=null;post();await expectLabel(0,'Queued');results.push('Stored capture becomes Queued');
  staleReplies.splice(0).forEach(reply=>reply());await delay(100);
  if(!label(0).includes('Queued'))throw Error('An older storage response replaced the saved track');
  results.push('A delayed older storage response cannot revert the saved track');
  captureProgress={trackId:'handoffTwo',fraction:.99,phase:'saving'};post();await expectLabel(1,'Saving…');
  error='Test save failed';captureProgress=null;post();await expectLabel(1,'Not captured');results.push('Failed save clears Saving');
  report.textContent=JSON.stringify({passed:true,results},null,2);
 }catch(reason){report.textContent=JSON.stringify({passed:false,error:String(reason),results},null,2);}
 finally{button.disabled=false;}
};
