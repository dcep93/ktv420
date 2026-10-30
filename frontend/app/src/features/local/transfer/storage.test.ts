import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMp3Set } from '../audio/mp3';
import { MP3_NAMES } from '../audio/mp3Types';
import { beginImport, importTrack, exportTrack } from './storage';
import { exportPlaylist, importPlaylist, type TransferClient } from './transfer';
import { openZip, openFolder } from './archive';
import { digest, bundleAssets, MANIFEST, type Bundle } from './manifest';
import { savedCollection } from '../collections';
import {
  listTracks,
  deleteTracks,
  getPlaybackRecord,
  setTrackStatus,
  saveInput,
  getInput,
} from '../library';
import { drainSpotifyQueue } from '../spotifyQueue';
const locks = {
  request: async (_name: string, _options: unknown, run: (lock: unknown) => unknown) => run({}),
} as Pick<LockManager, 'request'>;
const estimate = async () => ({ usage: 0, quota: 1024 ** 3 });
const signal = () => new AbortController().signal;
async function fixture() {
  const left = Float32Array.from({ length: 6000 }, (_, i) => Math.sin(i * 0.08) * 0.2),
    audio = { left, right: left, sampleRate: 44100 };
  const encoded = await encodeMp3Set(audio, {
    drums: audio,
    bass: audio,
    other: audio,
    vocals: audio,
  });
  const ids = ['one', 'two'];
  const collection = {
    path: 'album/2222222222222222222222',
    title: 'Standalone',
    artwork: '',
    trackIds: ['two', 'one', 'two'],
    complete: true,
  };
  const tracks: Bundle['tracks'] = [];
  for (const id of ['two', 'one']) {
    const files = {} as Bundle['tracks'][number]['files'];
    for (const name of MP3_NAMES)
      files[name] = {
        path: `tracks/${id}/${name}.mp3`,
        bytes: encoded.files[name].size,
        sha256: await digest(encoded.files[name]),
      };
    tracks.push({
      id,
      title: `Song ${id}`,
      artist: 'Artist',
      sampleRate: 44100,
      frames: left.length,
      encoding: encoded.encoding,
      crop: '0-0',
      artworkUrl: '',
      files,
      metadata: {
        captureStartVerified: true,
        separation: { backend: 'WebGPU' },
        custom: 'preserve',
      },
    });
  }
  return {
    bundle: { format: 'ktv420-playlist', version: 2, collection, tracks } satisfies Bundle,
    encoded,
    ids,
  };
}
test('website-only multi-track ZIP/folder round trip preserves order, duplicates, exact audio, timing and metadata', async () => {
  const { bundle, encoded, ids } = await fixture();
  await beginImport(bundle);
  for (const track of bundle.tracks)
    assert.equal(
      await importTrack(
        { track, collection: bundle.collection },
        encoded.files,
        null,
        locks,
        estimate,
      ),
      'saved',
    );
  assert.deepEqual((await savedCollection(bundle.collection.path)).trackIds, ['two', 'one', 'two']);
  assert.equal((await getPlaybackRecord('spotify-two')).playbackGain, encoded.encoding.gain);
  const client: TransferClient = {
    async request<T>(op: string, args: unknown[] = []): Promise<T> {
      switch (op) {
        case 'beginImport':
          return (await beginImport(args[0])) as T;
        case 'importTrack':
          return (await importTrack(args[0], args[1], args[2], locks, estimate)) as T;
        case 'exportTrack':
          return (await exportTrack(args[0])) as T;
        case 'exportCollection':
          return { collection: bundle.collection, bytes: 100000 } as T;
        default:
          throw new Error(op);
      }
    },
  };
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  await exportPlaylist(
    client,
    bundle.collection.path,
    new WritableStream({
      write: (chunk) => {
        chunks.push(Uint8Array.from(chunk));
      },
    }),
    signal(),
    () => {},
  );
  const zip = await openZip(new Blob(chunks), signal());
  assert.equal(zip.bundle.version, 2);
  assert.equal(zip.bundle.tracks[0].metadata?.custom, 'preserve');
  const files: File[] = [];
  for (const asset of bundleAssets(zip.bundle)) {
    const blob = await zip.read(asset, signal());
    assert.equal(await digest(blob), asset.sha256);
    const file = new File([blob], asset.path.split('/').at(-1)!);
    Object.defineProperty(file, 'webkitRelativePath', { value: `Playlist/${asset.path}` });
    files.push(file);
  }
  const manifest = new File([JSON.stringify(zip.bundle)], MANIFEST);
  Object.defineProperty(manifest, 'webkitRelativePath', { value: `Playlist/${MANIFEST}` });
  files.push(manifest);
  await deleteTracks(ids.map((id) => `spotify-${id}`));
  await importPlaylist(client, zip, signal(), () => {});
  await zip.close();
  assert.equal((await exportTrack('one')).track.metadata?.custom, 'preserve');
  await deleteTracks(ids.map((id) => `spotify-${id}`));
  const folder = await openFolder(files, signal());
  await importPlaylist(client, folder, signal(), () => {});
  await folder.close();
  for (const id of ids) {
    const record = await getPlaybackRecord(`spotify-${id}`);
    for (const name of MP3_NAMES)
      assert.deepEqual(
        await record.files.find((f) => f.name === `${name}.mp3`)!.blob.arrayBuffer(),
        await encoded.files[name].arrayBuffer(),
      );
  }
});
test('quota denial and competing separation leave prepared audio unchanged', async () => {
  const { bundle, encoded } = await fixture(),
    track = bundle.tracks[0];
  await assert.rejects(
    importTrack({ track, collection: bundle.collection }, encoded.files, null, locks, async () => ({
      quota: 10,
      usage: 9,
    })),
    /Not enough browser storage/,
  );
  const unavailable = {
    request: async (_name: string, _options: unknown, run: (lock: null) => unknown) => run(null),
  } as Pick<LockManager, 'request'>;
  await assert.rejects(
    importTrack(
      { track, collection: bundle.collection },
      encoded.files,
      null,
      unavailable,
      estimate,
    ),
    /Pause separation/,
  );
  assert.equal((await getPlaybackRecord('spotify-two')).files.length, 5);
});
test('a reopened processing queue retries processing inputs; ready imports never require inference', async () => {
  const id = 'spotify-recovery',
    raw = new Blob([new Uint8Array(100)]);
  await saveInput(
    {
      id,
      title: 'Interrupted',
      artist: '',
      createdAt: 1,
      sampleRate: 44100,
      frames: 10,
      status: 'captured',
      bytes: 100,
      source: 'spotify',
    },
    raw,
  );
  await setTrackStatus(id, 'processing');
  const attempted: string[] = [];
  await drainSpotifyQueue({
    list: listTracks,
    cancelled: () => false,
    onError: (error) => {
      throw error;
    },
    process: async (next) => {
      attempted.push(next);
      assert.equal((await getInput(next)).size, 100);
      await setTrackStatus(next, 'ready');
    },
  });
  assert.deepEqual(attempted, [id]);
});
