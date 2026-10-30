import {
  getPlaybackRecord,
  listTracks,
  transaction,
  type LocalTrack,
  type StoredAudio,
} from '../library';
import { MP3_NAMES, type Mp3Files } from '../audio/mp3Types';
import { parseBundle, raster, verifyAsset, type Bundle, type BundleTrack } from './manifest';
import { parseCollection } from '../savedCollections';
import { savedCollection } from '../collections';
import { validateMp3 } from '../audio/mp3Validation';
import { rememberCollection } from '../collections';
type LibraryLocks = Pick<LockManager, 'request'>;

export async function exportCollection(path: unknown) {
  const collection = await savedCollection(path),
    tracks = new Map((await listTracks()).map((t) => [t.id, t]));
  const missing = collection.trackIds.filter(
    (id) => tracks.get(`spotify-${id}`)?.status !== 'ready',
  );
  if (missing.length)
    throw new Error(
      `${missing.length} song${missing.length === 1 ? '' : 's'} still need capture or separation before export.`,
    );
  return {
    collection,
    bytes: [...new Set(collection.trackIds)].reduce(
      (sum, id) => sum + (tracks.get(`spotify-${id}`)?.bytes || 0),
      0,
    ),
  };
}
export async function exportTrack(id: unknown) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{1,100}$/.test(id))
    throw new Error('Invalid song ID.');
  // Metadata and blobs must describe the same revision, even if another tab deletes audio.
  const { track, audio } = await transaction<{ track?: LocalTrack; audio: StoredAudio[] }>(
    ['tracks', 'audio'],
    'readonly',
    (tx, done) => {
      const metadata = tx.objectStore('tracks').get(`spotify-${id}`);
      const files = tx.objectStore('audio').index('trackId').getAll(`spotify-${id}`);
      files.onsuccess = () => done({ track: metadata.result, audio: files.result });
    },
  );
  const record = {
    md5: `spotify-${id}`,
    playbackGain: track?.playbackGain,
    artwork: audio.find((file) => file.name === 'artwork')?.blob,
    files: audio
      .filter((file) => file.name !== 'artwork')
      .map((file) => ({
        name: file.name,
        path: `spotify-${id}/${file.name === 'input.mp3' ? 'input' : 'output'}/${file.name}`,
        blob: file.blob,
      })),
  };
  if (
    !track ||
    track.status !== 'ready' ||
    !MP3_NAMES.every((name) => record.files.some((file) => file.name === `${name}.mp3`))
  )
    throw new Error('Song is not fully prepared.');
  return { track, record };
}
export async function beginImport(value: unknown) {
  const bundle = parseBundle(value);
  await rememberCollection({ ...bundle.collection, observedAt: Date.now() });
  const tracks = await listTracks();
  const ready: string[] = [];
  for (const track of tracks) {
    if (
      track.status !== 'ready' ||
      !bundle.collection.trackIds.includes(track.id.replace(/^spotify-/, ''))
    )
      continue;
    const record = await getPlaybackRecord(track.id);
    if (
      MP3_NAMES.every((name) =>
        record.files.some((file) => file.name === `${name}.mp3` && file.blob.size > 0),
      )
    )
      ready.push(track.id.replace(/^spotify-/, ''));
  }
  return ready;
}
export async function importTrack(
  value: unknown,
  files: unknown,
  artwork: unknown,
  locks: LibraryLocks,
  estimate: () => Promise<StorageEstimate>,
) {
  // Reuse the full validator without trusting the website to have checked metadata.
  if (!value || typeof value !== 'object' || !('track' in value) || !('collection' in value))
    throw new Error('Invalid import.');
  const v = value as { track: BundleTrack; collection: Bundle['collection'] };
  const collection = parseCollection(v.collection);
  if (!collection || !collection.trackIds.includes(v.track?.id))
    throw new Error('Song does not belong to this playlist.');
  const track = parseBundle({
    format: 'ktv420-playlist',
    version: 2,
    collection: { ...collection, trackIds: [v.track.id] },
    tracks: [v.track],
  }).tracks[0];
  if (!files || typeof files !== 'object' || Object.keys(files).length !== 5)
    throw new Error('Original and all four stems are required.');
  const blobs = files as Mp3Files;
  for (const name of MP3_NAMES) {
    if (!(blobs[name] instanceof Blob)) throw new Error('Missing audio file.');
    await verifyAsset(blobs[name], track.files[name]);
    await validateMp3(blobs[name], track.encoding.sampleRate, track.encoding.frames);
  }
  let cover: Blob | undefined;
  if (track.artwork) {
    if (!(artwork instanceof Blob)) throw new Error('Missing artwork.');
    await verifyAsset(artwork, track.artwork);
    cover = await raster(artwork);
  }
  const bytes = MP3_NAMES.reduce((sum, name) => sum + blobs[name].size, cover?.size || 0);
  return locks.request('ktv420-separation', { ifAvailable: true }, async (lock) => {
    if (!lock)
      throw new Error(
        'Pause separation before importing. Completed songs are safe; retry this package afterward.',
      );
    const storage = await estimate();
    if (
      typeof storage.quota === 'number' &&
      typeof storage.usage === 'number' &&
      storage.quota - storage.usage < bytes + 16 * 1024 ** 2
    )
      throw new Error(
        'Not enough browser storage. Free local audio or disk space, then retry; completed songs are kept.',
      );
    return await transaction<'saved' | 'skipped'>(
      ['tracks', 'audio', 'collections'],
      'readwrite',
      (tx, done) => {
        const existing = tx.objectStore('tracks').get(`spotify-${track.id}`);
        existing.onsuccess = () => {
          const read = tx.objectStore('audio').index('trackId').getAll(`spotify-${track.id}`);
          read.onsuccess = () => {
            const stored = read.result as StoredAudio[];
            if (
              existing.result?.status === 'ready' &&
              MP3_NAMES.every((name) =>
                stored.some((file) => file.name === `${name}.mp3` && file.blob.size > 0),
              )
            ) {
              done('skipped');
              return;
            }
            for (const file of stored) tx.objectStore('audio').delete(file.key);
            const id = `spotify-${track.id}`;
            for (const name of MP3_NAMES)
              tx.objectStore('audio').put({
                key: `${id}/${name}.mp3`,
                trackId: id,
                name: `${name}.mp3`,
                blob: blobs[name],
              });
            if (cover)
              tx.objectStore('audio').put({
                key: `${id}/artwork`,
                trackId: id,
                name: 'artwork',
                blob: cover,
              });
            tx.objectStore('tracks').put({
              id,
              title: track.title,
              artist: track.artist,
              source: 'spotify',
              sampleRate: track.sampleRate,
              frames: track.frames,
              createdAt: Date.now(),
              status: 'ready',
              bytes,
              playbackGain: track.encoding.gain,
              metadata: {
                ...track.metadata,
                trackId: track.id,
                trackName: track.title,
                trackArtist: track.artist,
                trackArtworkSrc: track.artworkUrl,
                crop: track.crop,
                encoding: track.encoding,
              },
            } satisfies LocalTrack);
            const collections = tx.objectStore('collections'),
              previous = collections.get(collection.path);
            previous.onsuccess = () =>
              collections.put({
                ...collection,
                savedAt: previous.result?.savedAt ?? Date.now(),
                startedAt: previous.result?.startedAt ?? Date.now(),
              });
            done('saved');
          };
        };
      },
    );
  });
}
