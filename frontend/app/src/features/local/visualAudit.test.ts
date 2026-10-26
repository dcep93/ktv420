import test from 'node:test';
import assert from 'node:assert/strict';
import { drawVisualizer, resetVisualizerState } from '../stems/player/visualizers';
import { visualizerOptions } from '../stems/player/visualizerOptions';
import { isCombinedVisualizer } from '../stems/player/visuals/combinedVisualizers';

// Exercise every legacy drawing branch with finite coordinates and actual arc rules.
test('all per-stem renderers keep finite geometry and balanced canvas state',()=>{
  let depth=0,operations=0;
  const call=(key:PropertyKey,args:unknown[])=>{
    operations++;
    for(const x of args)if(typeof x==='number')assert.ok(Number.isFinite(x),`${String(key)}: ${x}`);
    if(key==='arc')assert.ok(Number(args[2])>=0,'negative radius');
    if(key==='save')depth++;
    if(key==='restore'){depth--;assert.ok(depth>=0);}
  };
  const context=new Proxy({}, {get(_t,key){
    if(key==='createLinearGradient'||key==='createRadialGradient')return (...args:unknown[])=>{call(key,args);return {addColorStop(){}};};
    if(key==='createPattern')return ()=>({});
    return (...args:unknown[])=>call(key,args);
  },set(){return true;}});
  Object.defineProperty(globalThis,'Path2D',{configurable:true,value:class {moveTo(...args:unknown[]){call('moveTo',args);}lineTo(...args:unknown[]){call('lineTo',args);}}});
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class {complete=true;naturalWidth=200;width=200;height=200;}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
  const analyser={fftSize:2048,frequencyBinCount:1024,
    getByteFrequencyData(data:Uint8Array){for(let i=0;i<data.length;i++)data[i]=Math.round(255/(1+i*.03));},
    getByteTimeDomainData(data:Uint8Array){for(let i=0;i<data.length;i++)data[i]=128+Math.round(Math.sin(i*.05)*80);},
  } as unknown as AnalyserNode;
  const envelope=Array.from({length:1000},(_,i)=>.5+.5*Math.sin(i*.07));
  for(const option of visualizerOptions){
    if(isCombinedVisualizer(option.value)||option.value==='spectrogram'||option.value==='stereo-bloom')continue;
    for(const [width,height] of [[360,102],[1400,800]]){
      const canvas={width,height,getContext:()=>context,addEventListener(){},removeEventListener(){}} as unknown as HTMLCanvasElement;
      for(const time of [0,1,30,30.016,300,0]){
        operations=0;
        drawVisualizer({canvas,analyser,visualizerType:option.value,currentTime:time,duration:50,isPlaying:time!==30,amplitudeEnvelope:envelope,amplitudeMaximum:1,sampleRate:44100});
        assert.equal(depth,0,option.value);assert.ok(operations<15000,`${option.value}: ${operations}`);
      }
      resetVisualizerState(canvas);
    }
  }
});
