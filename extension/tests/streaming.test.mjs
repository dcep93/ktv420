import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IncrementalMd5, md5Hex } from '../src/content/md5.js';
import { createStreamingArtifact } from '../src/content/storage.js';

test('incremental hashes match independent MD5 across every block/padding boundary', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 127, 128, 262144 + 72]) {
    const bytes = Uint8Array.from({ length }, (_, i) => i * 73 % 256);
    const expected = createHash('md5').update(bytes).digest('hex');
    assert.equal(md5Hex(bytes), expected);
    for (const size of [1, 17, 63, 64, 65, 262144]) {
      const hash = new IncrementalMd5();
      for (let i = 0; i < length; i += size) {
        hash.update(bytes.subarray(i, i + size));
        if (i < 128) assert.equal(hash.hex(), createHash('md5').update(bytes.subarray(0, Math.min(length, i + size))).digest('hex'));
      }
      assert.equal(hash.hex(), expected); assert.equal(hash.hex(), expected);
    }
  }
});

test('streaming transfers exact bounded chunks and commits only after explicit final metadata', async () => {
  const bytes = Uint8Array.from({ length: 262144 * 2 + 24 }, (_, i) => i * 31 % 256), messages = [];
  const writer = createStreamingArtifact({ trackId: 'song' }, async message => { messages.push(message); return 'capture'; });
  await writer.append(bytes.subarray(0, 262144));
  assert.equal(writer.offset, 262144);
  assert.ok(!messages.some(message => message.type.endsWith('finish')));
  await writer.append(bytes.subarray(262144));
  assert.equal(writer.md5, createHash('md5').update(bytes).digest('hex'));
  await assert.rejects(writer.finish({ audioByteLength: bytes.length + 8 }));
  await writer.finish({ audioByteLength: bytes.length, captureEndVerified: true });
  const chunks = messages.filter(message => message.type === 'ktv420:capture-chunk');
  assert.deepEqual(chunks.map(chunk => chunk.index), [0, 1, 2]);
  assert.deepEqual(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.base64, 'base64'))), Buffer.from(bytes));
  assert.equal(messages.at(-1).bytes, bytes.length);
});

test('failed chunk acknowledgment cannot advance the stream or its hash', async () => {
  let fail = true;
  const writer = createStreamingArtifact({}, async message => {
    if (message.type.endsWith('chunk') && fail) throw new Error('disk unavailable');
    return 'capture';
  });
  await assert.rejects(writer.append(new Uint8Array(8)));
  assert.equal(writer.offset, 0);
  fail = false; await writer.append(new Uint8Array(8));
  assert.equal(writer.offset, 8);
  assert.equal(writer.md5, createHash('md5').update(new Uint8Array(8)).digest('hex'));
});
