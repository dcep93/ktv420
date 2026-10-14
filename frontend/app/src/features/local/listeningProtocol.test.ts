import test from 'node:test';
import assert from 'node:assert/strict';
import { captureStartSeconds, parseListeningState, parseTransportCommand } from './listeningProtocol';
import { claimListeningLease } from '../../extension/listeningLease';
test('transport accepts only bounded commands and strips extra fields', () => {
  assert.deepEqual(parseTransportCommand({ action: 'seek', trackId: 'abc', position: 3, script: 'no' }), { action: 'seek', trackId: 'abc', position: 3 });
  for (const command of [{action:'eval'}, {action:'volume',volume:NaN}, {action:'volume',volume:2}, {action:'seek',position:-1,trackId:'a'}, {action:'select',trackId:'../a'}]) assert.equal(parseTransportCommand(command), null);
});
test('listening state rejects invalid time, volume, and route identifiers', () => {
  const state = { capability:1,trackId:'abc',generation:1,position:2,duration:8,playing:true,local:true,output:'stems',volume:.5,observedAt:Date.now(),error:'' };
  assert.equal(parseListeningState(state)?.output,'stems');
  for (const bad of [{position:NaN},{observedAt:Infinity},{volume:-1},{trackId:'spotify:abc'},{output:'both'}]) assert.equal(parseListeningState({...state,...bad}),null);
});
test('only one tab holds the listening lease until it expires', () => {
  const first=claimListeningLease(undefined,1,100);
  assert.equal(claimListeningLease(first,2,200).tabId,1);
  const renewed=claimListeningLease(first,1,500);
  assert.equal(renewed.expires,3500);
  assert.equal(claimListeningLease(renewed,2,3501).tabId,2);
});
test('capture offsets preserve subsecond alignment and reject malformed metadata', () => {
  assert.equal(captureStartSeconds({ crop: '0.125-0' }), 0.125);
  for (const crop of [undefined, null, 'bad', 'Infinity-0', '4-0', '-0.2-0']) assert.equal(captureStartSeconds({ crop }), 0);
  assert.equal(captureStartSeconds(), 0);
});
