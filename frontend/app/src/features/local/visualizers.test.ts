import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasResolution } from '../stems/player/visuals/canvas';
import { analysisBytes, frequencyBin, signalRms, stereoPoint } from '../stems/player/visuals/analysis';
import { weatherRole } from '../stems/player/visuals/stemWeather';
import { visualizerOptions } from '../stems/player/visualizerOptions';
test('Retina canvases sharpen small panels and bound large panel memory', () => {
  assert.deepEqual(canvasResolution(900,102,2), {width:1800,height:204});
  assert.deepEqual(canvasResolution(900,102,3), {width:1800,height:204});
  const size=canvasResolution(4000,2000,2);
  assert.ok(size.width*size.height<1_505_000);
});
test('stereo geometry distinguishes centered, side-only and one-sided audio', () => {
  assert.deepEqual(stereoPoint(.5,.5), {side:0,mid:.5});
  assert.deepEqual(stereoPoint(.5,-.5), {side:.5,mid:0});
  assert.deepEqual(stereoPoint(.5,0), {side:.25,mid:.25});
  assert.equal(signalRms(new Float32Array([.5,-.5])),.5);
});
test('analysis buffers reuse storage per analyser and sample window', () => {
  const node={} as AnalyserNode, other={} as AnalyserNode;
  assert.equal(analysisBytes(node,1024),analysisBytes(node,1024));
  assert.notEqual(analysisBytes(node,1024),analysisBytes(node,2048));
  assert.notEqual(analysisBytes(node,1024),analysisBytes(other,1024));
  assert.equal(frequencyBin(1000,48000,2048),43);
  assert.equal(frequencyBin(50000,44100,2048),1023);
});
test('new visualizer identities preserve existing replay choices and classify original separately', () => {
  assert.equal(visualizerOptions.length,30);
  assert.equal(new Set(visualizerOptions.map(v=>v.value)).size,30);
  assert.equal(weatherRole('drums.mp3',false),'drums');
  assert.equal(weatherRole('vocals.wav',false),'vocals');
  assert.equal(weatherRole('input.mp3',true),'original');
});
