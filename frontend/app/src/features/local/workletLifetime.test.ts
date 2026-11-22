import test from 'node:test';
import assert from 'node:assert/strict';
import { disposeWorkletNode } from '../stems/player/workletLifetime';

function worklet(disconnectError = false) {
  const calls: string[] = [];
  const node = {
    onprocessorerror: () => {},
    port: {onmessage: () => {}, onmessageerror: () => {}, close: () => calls.push('close')},
    disconnect: () => { calls.push('disconnect'); if (disconnectError) throw Error('disconnect'); },
  };
  return {node:node as unknown as AudioWorkletNode,calls};
}
test('worklet cleanup breaks native-to-JS callbacks before releasing processor resources', () => {
  const {node,calls} = worklet();
  disposeWorkletNode(node, () => {
    assert.equal(node.onprocessorerror,null);
    assert.equal(node.port.onmessage,null);
    assert.equal(node.port.onmessageerror,null);
    calls.push('release');
  });
  assert.deepEqual(calls,['release','disconnect','close']);
  disposeWorkletNode(node,()=>{});
  assert.equal(node.onprocessorerror,null);
});
test('a release failure still disconnects and closes the port without retaining listeners', () => {
  const {node,calls} = worklet();
  assert.throws(()=>disposeWorkletNode(node,()=>{throw Error('release');}),/release/);
  assert.deepEqual(calls,['disconnect','close']);
  assert.equal(node.onprocessorerror,null);
  assert.equal(node.port.onmessage,null);
  assert.equal(node.port.onmessageerror,null);
});
test('a disconnect failure still closes the port', () => {
  const {node,calls} = worklet(true);
  assert.throws(()=>disposeWorkletNode(node,()=>{}),/disconnect/);
  assert.deepEqual(calls,['disconnect','close']);
});
