import { TempoEngine } from './src/features/stems/player/tempoEngine';
const result = document.querySelector('#result')!;
const rate = 44100, seconds = 8, channels = 10;
const rms = (data: Float32Array, start: number, end: number) => Math.sqrt(data.subarray(start,end).reduce((sum,v)=>sum+v*v,0)/(end-start));
function frequency(data: Float32Array, start: number, end: number) {
  let crossings = 0; for(let i=start+1;i<end;i++) if(data[i-1]<0 && data[i]>=0) crossings++;
  return crossings*rate/(end-start);
}
document.querySelector('#run')!.addEventListener('click',async()=>{
 const rows: unknown[] = [];
 try {
  for(const [tempo,pitch] of [[1,0],[1.5,0],[.5,0],[1,12],[1,-12],[1.5,7]]) {
   const context = new OfflineAudioContext(channels,Math.ceil((seconds/tempo+.4)*rate),rate);
   const buffers = Array.from({length:5},(_,stem)=>{const buffer=context.createBuffer(2,rate*seconds,rate);for(let c=0;c<2;c++){const d=buffer.getChannelData(c);for(let i=0;i<d.length;i++)d[i]=.1*Math.sin(2*Math.PI*(220+stem*110)*i/rate);}return buffer;});
   const outputs=Array.from({length:5},(_,i)=>{const split=context.createChannelSplitter(2);const merge=context.createChannelMerger(channels);split.connect(merge,0,i*2);split.connect(merge,1,i*2+1);merge.connect(context.destination);return split;});
   const before=performance.now();
   const engine=await TempoEngine.create(context,buffers,outputs,message=>{throw Error(message);});
   engine.set(tempo,pitch);await engine.start(0);
   const start=performance.now();const rendered=await context.startRendering();const elapsed=performance.now()-start;
   let stereoError=0;for(let stem=0;stem<5;stem++){const l=rendered.getChannelData(stem*2),r=rendered.getChannelData(stem*2+1);for(let i=0;i<l.length;i++)stereoError=Math.max(stereoError,Math.abs(l[i]-r[i]));}
   const measured = Array.from({length:5},(_,i)=>frequency(rendered.getChannelData(i*2),rate,rate*3));
   const expected=Array.from({length:5},(_,i)=>(220+i*110)*2**(pitch/12));
   const error=Math.max(...measured.map((f,i)=>Math.abs(f-expected[i])/expected[i]));
   const data=rendered.getChannelData(0);let last=0;for(let i=data.length-1;i>=0;i--)if(Math.abs(data[i])>.01){last=i/rate;break;}
   const row={tempo,pitch,renderMs:Math.round(elapsed),setupMs:Math.round(start-before),audioSeconds:rendered.duration,cpuFraction:elapsed/1000/rendered.duration,frequencies:measured,expected,maxFrequencyError:error,stereoError,lastAudible:last,expectedEnd:seconds/tempo+.02,rms:rms(data,rate,rate*3)};
   rows.push(row);result.textContent=JSON.stringify({running:true,rows},null,2);
   if(error>.02 || Math.abs(last-(seconds/tempo+.02))>.2 || row.rms<.03)throw Error('Pitch, duration or level validation failed');
   engine.dispose();
  }
  result.textContent=JSON.stringify({passed:true,rows},null,2);
 }catch(error){result.textContent=JSON.stringify({passed:false,error:String(error),rows},null,2);}
});
