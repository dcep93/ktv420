import { LocalSeparator } from './features/local/inference/client';
let worker: LocalSeparator | undefined;
const status = document.querySelector<HTMLPreElement>('#status')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
document.querySelector('#cancel')!.addEventListener('click', () => worker?.dispose());
run.addEventListener('click', async () => {
  run.disabled = true; const start = performance.now();
  try {
    const sampleRate = 44100;
    const frames = Math.round(sampleRate * Number(document.querySelector<HTMLInputElement>('#duration')!.value));
    const left = Float32Array.from({length:frames}, (_,i) => 0.2 * Math.sin(2*Math.PI*220*i/sampleRate) + 0.1*Math.sin(2*Math.PI*997*i/sampleRate));
    const right = Float32Array.from({length:frames}, (_,i) => 0.17 * Math.sin(2*Math.PI*330*i/sampleRate));
    worker?.dispose();
    worker = new LocalSeparator({ backend: document.querySelector<HTMLSelectElement>('#backend')!.value as 'wasm' | 'webgpu' });
    let result = await worker.separateStereo({left,right,sampleRate}, p => { status.textContent = `${((performance.now()-start)/1000).toFixed(1)}s ${p.message} ${Math.round(p.fraction*100)}%`; });
    const coldSeconds=(performance.now()-start)/1000;
    const warmStart=performance.now();
    result=await worker.separateStereo({left,right,sampleRate},p=>{status.textContent=`Warm run: ${p.message} ${Math.round(p.fraction*100)}%`;});
    const warmSeconds=(performance.now()-warmStart)/1000;
    const stats = Object.fromEntries(['drums','bass','other','vocals'].map(name => {
      const audio = result[name as 'drums']; let sum=0, peak=0, finite=true;
      for (const channel of [audio.left,audio.right]) for (const value of channel) {sum += value*value; peak = Math.max(peak, Math.abs(value)); finite &&= Number.isFinite(value);}
      return [name,{frames:audio.left.length,peak,rms:Math.sqrt(sum/(frames*2)),finite}];
    }));
    let parity;
    if (frames === 44100) {
      const response = await fetch(new URL('../tests/fixtures/demucs-reference.f32', import.meta.url));
      if (!response.ok) throw new Error('Reference fixture unavailable');
      const reference = new Float32Array(await response.arrayBuffer());
      let offset=0, maxError=0, squaredError=0;
      for (const name of ['drums','bass','other','vocals'] as const) for (const channel of [result[name].left,result[name].right]) for (const value of channel) {
        const difference = value - reference[offset++]; maxError=Math.max(maxError,Math.abs(difference)); squaredError+=difference*difference;
      }
      parity={samples:offset,maxError,rmsError:Math.sqrt(squaredError/offset),pass:offset===reference.length && maxError<0.001};
    }
    status.textContent = JSON.stringify({parity,coldSeconds,warmSeconds,wallSeconds:(performance.now()-start)/1000, metadata:result.metadata,stats},null,2);
  } catch(error) { status.textContent = `FAILED after ${((performance.now()-start)/1000).toFixed(1)}s: ${error instanceof Error ? error.stack : String(error)}`; }
  finally {run.disabled=false;}
});
