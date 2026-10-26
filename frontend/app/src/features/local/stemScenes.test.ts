import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStemSceneState, stemRoles, updateStemScene, type StemVoice } from '../stems/player/visuals/stemScene';
import { drawStemScene, type NewStemScene } from '../stems/player/visuals/stemScenes';
import { combinedVisualizers, isCombinedVisualizer } from '../stems/player/visuals/combinedVisualizers';
import { visualizerOptions } from '../stems/player/visualizerOptions';
import { validSnapshot } from './recording';

function voice(name: string, amplitude = .2): StemVoice {
  return { name, input: name === 'original', audible: true, analyser: {
    fftSize: 128, frequencyBinCount: 64, context: { sampleRate: 44100 },
    getFloatTimeDomainData(buffer: Float32Array) { buffer.fill(amplitude); },
    getByteFrequencyData(buffer: Uint8Array) { buffer.fill(100); },
  } as unknown as AnalyserNode };
}

test('combined scenes use each audible stem independently and preserve fader level', () => {
  for (const role of stemRoles) {
    const state = createStemSceneState();
    updateStemScene(state, [voice(role)], 1, true);
    assert.ok(state.levels[role] > 0);
    for (const other of stemRoles.filter(r => r !== role)) assert.equal(state.levels[other], 0);
    const quiet = createStemSceneState();
    updateStemScene(quiet, [voice(role, .1)], 1, true);
    assert.ok(Math.abs(quiet.levels[role] * 2 - state.levels[role]) < 1e-6, 'faders must not be normalized away');
  }
});

test('mute clears layers and drum history immediately; seeks reset smoothing and onset history', () => {
  const voices = stemRoles.map(role => voice(role)), state = createStemSceneState();
  updateStemScene(state, voices, 2, true);
  assert.equal(state.strikeTime, 2);
  voices.forEach(v => { v.audible = false; });
  updateStemScene(state, voices, 2.01, true);
  assert.ok(stemRoles.every(role => state.levels[role] === 0));
  assert.equal(state.strikeTime, -Infinity); assert.equal(state.pulse, 0); assert.equal(state.vocalWave, undefined);
  const loud = voice('bass'); updateStemScene(state, [loud], 2.02, true);
  const fresh = createStemSceneState();
  updateStemScene(state, [voice('vocals', .1)], 1, true);
  updateStemScene(fresh, [voice('vocals', .1)], 1, true);
  assert.deepEqual(state.levels, fresh.levels);
});

// Real renderers with a recording canvas context: catch nonfinite geometry,
// leaking save/restore, stale muted layers and accidentally unbounded drawing.
function surface(width: number, height: number) {
  let operations = 0, depth = 0, marks = 0;
  const context = new Proxy({}, {
    get(_target, key) {
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args: number[]) => {
        args.forEach(value => assert.ok(Number.isFinite(value))); operations++;
        return { addColorStop() { operations++; } };
      };
      return (...args: unknown[]) => {
        operations++;
        for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${String(key)} received ${arg}`);
        if (key === 'save') depth++;
        if (key === 'restore') { depth--; assert.ok(depth >= 0); }
        if (key === 'fill' || key === 'stroke' || key === 'fillRect') marks++;
      };
    },
    set() { return true; },
  });
  return { canvas: { width, height, getContext: () => context } as unknown as HTMLCanvasElement,
    reset() { operations = marks = 0; }, read: () => ({ operations, depth, marks }) };
}
const modes: NewStemScene[] = ['night-city', 'stem-garden', 'stem-orbit'];
for (const mode of modes) test(`${mode} stays bounded, supports every solo and clears muted contributions`, () => {
  for (const [width, height] of [[360, 210], [1600, 360], [2400, 1200]]) {
    const s = surface(width, height), voices = stemRoles.map(role => voice(role));
    for (let frame = 0; frame < 120; frame++) {
      s.reset(); drawStemScene(mode, s.canvas, voices, frame / 60, true);
      assert.equal(s.read().depth, 0); assert.ok(s.read().operations < 2400);
    }
    voices.forEach(v => { v.audible = false; });
    s.reset(); drawStemScene(mode, s.canvas, voices, 2, true);
    assert.equal(s.read().marks, 1, 'muted scene contains only its background');
    for (const v of voices) {
      v.audible = true; s.reset(); drawStemScene(mode, s.canvas, voices, 2.1, true);
      assert.ok(s.read().marks > 1, `${v.name} should have its own visible contribution`);
      v.audible = false;
    }
  }
});

test('every combined scene is selectable and remains valid in recorded snapshots', () => {
  for (const [value, scene] of Object.entries(combinedVisualizers)) {
    const option = visualizerOptions.find(option => option.value === value);
    assert.ok(option); assert.equal(option.label, scene.label); assert.ok(isCombinedVisualizer(option.value));
    assert.equal(scene.legend.length, 4);
    assert.ok(validSnapshot({ visualizer: value, tempo: 1, pitch: 0, spotlight: null,
      stems: [{ name: 'vocals.mp3', input: false, volume: 1, mute: false, deafen: false, effect: 'wah', value: 0 }] }));
  }
  assert.equal(isCombinedVisualizer('time-ribbon'), false);
});

test('Highway perspective converges at the horizon and widens toward the listener', async () => {
  const {highwayPoint}=await import('../stems/player/visuals/highway');
  for(const time of [0,10,1000]) {
    let lastWidth=0,lastY=0;
    for(let i=0;i<=100;i++){
      const left=highwayPoint(i/100,-1,1200,600,time),right=highwayPoint(i/100,1,1200,600,time);
      assert.ok(right.x-left.x>=lastWidth);
      assert.ok(left.y>=lastY);
      assert.equal(left.y,right.y);
      lastWidth=right.x-left.x;lastY=left.y;
    }
  }
});

test('Highway is a bounded combined scene with independent stem contributions and safe seeks', async () => {
  const {drawHighway,resetHighway}=await import('../stems/player/visuals/highway');
  for(const [width,height] of [[360,210],[1600,360],[2400,1200]]) {
    const s=surface(width,height),voices=stemRoles.map(role=>voice(role));
    for(let i=0;i<120;i++){
      s.reset();drawHighway(s.canvas,voices,i/60,true);
      assert.equal(s.read().depth,0);assert.ok(s.read().operations<3000);
    }
    voices.forEach(v=>{v.audible=false;});
    s.reset();drawHighway(s.canvas,voices,2,true);const silent=s.read().marks;
    for(const role of ['drums','vocals','other','original']) {
      const v=voices.find(v=>v.name===role)!;v.audible=true;
      s.reset();drawHighway(s.canvas,voices,2.1,true);
      assert.ok(s.read().marks>silent,role);v.audible=false;
    }
    for(const time of [2.1,2.1,1,4000]){
      s.reset();drawHighway(s.canvas,voices,time,false);
      assert.equal(s.read().depth,0);assert.equal(s.read().marks,silent);
    }
    resetHighway(s.canvas);drawHighway(s.canvas,voices,0,true);
    assert.equal(s.read().depth,0);
  }
});
