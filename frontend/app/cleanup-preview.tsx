// Development-only integration regression. References used for inspection are weak.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Player from './src/features/stems/player/Player';
import { TempoEngine } from './src/features/stems/player/tempoEngine';
import { encodeFloat32Wav } from './src/features/local/audio/wav';
import type { MixerControl, MixerSnapshot } from './src/features/local/recording';

if (!import.meta.env.DEV) throw new Error('Development fixture only');
const result = document.querySelector('#result')!;
const root = createRoot(document.querySelector('#root')!);
const contexts: WeakRef<AudioContext>[] = [], nodes: WeakRef<AudioWorkletNode>[] = [], buffers: WeakRef<AudioBuffer>[] = [];
const NativeContext = window.AudioContext, NativeWorklet = window.AudioWorkletNode;
window.AudioContext = class extends NativeContext {
  constructor(options?: AudioContextOptions) { super(options); contexts.push(new WeakRef(this)); }
  override async decodeAudioData(data: ArrayBuffer) {
    const buffer = await super.decodeAudioData(data); buffers.push(new WeakRef(buffer)); return buffer;
  }
};
window.AudioWorkletNode = class extends NativeWorklet {
  constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
    super(context, name, options); nodes.push(new WeakRef(this));
  }
};
const samples = new Float32Array(48000 * 2);
for (let i = 0; i < samples.length; i++) samples[i] = .01 * Math.sin(i * 2 * Math.PI * 440 / 48000);
const blob = new Blob([encodeFloat32Wav({left:samples,right:samples,sampleRate:48000})], {type:'audio/wav'});
const names = ['input','drums','bass','other','vocals'];
const settings: MixerSnapshot = {tempo:1,pitch:0,visualizer:'time-ribbon',spotlight:null,stems:names.map(name=>({name:`${name}.mp3`,input:name==='input',volume:1,mute:name==='input',deafen:false,effect:'wah',value:.5}))};
let controls: MixerControl | null = null;
const onControls = (value: MixerControl | null) => { controls = value; };
const checks: string[] = [];
let completed = false, failure: string | null = null;
const report = () => {
  const liveContexts = contexts.flatMap(ref => ref.deref() ?? []);
  const liveNodes = nodes.flatMap(ref => ref.deref() ?? []);
  result.textContent = JSON.stringify({completed,failure,checks,created:{contexts:contexts.length,nodes:nodes.length,decodedBuffers:buffers.length},survivors:{
    contexts:liveContexts.length,openContexts:liveContexts.filter(context=>context.state!=='closed').length,
    worklets:liveNodes.length,errorHandlers:liveNodes.filter(node=>node.onprocessorerror!==null).length,
    decodedBuffers:buffers.filter(ref=>ref.deref()!==undefined).length,
  }},null,2);
};
const assert = (ok: boolean, label: string) => { if (!ok) throw Error(label); checks.push(label); };
const waitFor = async (condition: () => boolean) => {
  const end = performance.now() + 15000;
  while (!condition()) { if (performance.now() > end) throw Error('Timed out waiting for player'); await new Promise(resolve=>setTimeout(resolve,20)); }
};
const mount = (index: number) => {
  const record = {md5:`cleanup-${index}`,files:names.map(name=>({name:`${name}.mp3`,path:`cleanup-${index}/${name==='input'?'input':'output'}/${name}.mp3`,blob}))};
  flushSync(()=>root.render(<Player key={index} record={record} title={`Cleanup ${index}`} masterVolume={0} tempoSupported
    initialSettings={{...settings,tempo:index%2?.75:1,pitch:index%2?3:0}} onControls={onControls} />));
};
document.querySelector('#inspect')!.addEventListener('click', report);
document.querySelector('#run')!.addEventListener('click', async () => {
  (document.querySelector('#run') as HTMLButtonElement).disabled = true;
  try {
    for (let i = 0; i < 12; i++) {
      mount(i);
      await waitFor(()=>controls?.ready===true);
      await controls!.play(); await controls!.seek(.25); await controls!.pause();
      assert(true,`Song ${i+1}: ready, play, seek, pause (${i%2?'tempo/pitch':'neutral'})`);
      report();
    }
    flushSync(()=>root.render(null));
    await waitFor(()=>contexts.every(ref=>!ref.deref()||ref.deref()!.state==='closed'));
    assert(nodes.every(ref=>!ref.deref()||ref.deref()!.onprocessorerror===null),'All retired worklet error handlers detached');
    // Switch away while decode/setup is still pending.
    mount(12); flushSync(()=>root.render(null));
    await new Promise(resolve=>setTimeout(resolve,100));
    assert(nodes.every(ref=>!ref.deref()||ref.deref()!.onprocessorerror===null),'Cancelled load leaves no error handlers');
    // Keep an explicit engine reference: dispose must release its own arrays,
    // even before the engine itself becomes eligible for garbage collection.
    const retainedContext = new AudioContext();
    try {
      const engine = await TempoEngine.create(retainedContext,[retainedContext.createBuffer(2,48000,retainedContext.sampleRate)],[retainedContext.destination],()=>{});
      const state = engine as unknown as {buffers:AudioBuffer[];destinations:AudioNode[];routes:AudioNode[];gates:GainNode[];splitter:ChannelSplitterNode|null;node:AudioWorkletNode};
      engine.dispose(); engine.dispose();
      assert(state.buffers.length===0&&state.destinations.length===0,'Disposed engine releases audio buffers and destinations');
      assert(state.routes.length===0&&state.gates.length===0&&state.splitter===null,'Disposed engine releases graph collections');
      assert(state.node.onprocessorerror===null&&state.node.port.onmessage===null,'Disposed engine releases callbacks; repeated disposal is safe');
      let rejected = false;
      try { await engine.start(0); } catch { rejected = true; }
      assert(rejected,'Disposed engine cannot restart playback');
    } finally { await retainedContext.close(); }
    // Failure after the worklet exists, before channel copies complete.
    const context = new AudioContext();
    try {
      const buffer = context.createBuffer(2,48000,context.sampleRate);
      buffer.getChannelData = () => { throw new RangeError('Synthetic allocation failure'); };
      let rejected = false;
      try { await TempoEngine.create(context,[buffer],[context.destination],()=>{}); }
      catch (error) { rejected = String(error).includes('Synthetic allocation failure'); }
      assert(rejected,'Channel-copy failure is propagated');
      assert(nodes.every(ref=>!ref.deref()||ref.deref()!.onprocessorerror===null),'Failed setup detaches its error handler');
    } finally { await context.close(); }
    completed = true;
  } catch (error) { failure = String(error); }
  finally { flushSync(()=>root.render(null)); report(); }
});
