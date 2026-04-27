import { ARTIFACT_FILES, STORAGE_VERSION } from "./constants.js";

export async function readCachedTrack(trackId) {
  const root = await navigator.storage.getDirectory();

  try {
    const trackDirectory = await root.getDirectoryHandle(trackId, { create: false });
    const metadataHandle = await trackDirectory.getFileHandle(ARTIFACT_FILES.metadata, { create: false });
    const metadataFile = await metadataHandle.getFile();
    const metadata = JSON.parse(await metadataFile.text());

    if (isValidMetadata(metadata, trackId)) {
      return metadata;
    }
  } catch {
    return null;
  }

  return null;
}

export async function writeTrackArtifact(trackId, pcmBase64, metadata) {
  const root = await navigator.storage.getDirectory();
  const trackDirectory = await root.getDirectoryHandle(trackId, { create: true });

  await writeTextFile(trackDirectory, ARTIFACT_FILES.pcmBase64, pcmBase64);
  await writeTextFile(trackDirectory, ARTIFACT_FILES.metadata, JSON.stringify(metadata, null, 2));
}

export function isValidMetadata(metadata, trackId) {
  return Boolean(
    metadata &&
      metadata.storageVersion === STORAGE_VERSION &&
      metadata.trackId === trackId &&
      metadata.audioSampleFormat === "PCM_S16LE" &&
      metadata.audioChannelLayout === "interleaved" &&
      Number.isFinite(metadata.audioByteLength) &&
      typeof metadata.md5 === "string" &&
      metadata.md5.length === 32
  );
}

async function writeTextFile(directory, filename, text) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}
