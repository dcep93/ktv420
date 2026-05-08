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

export async function inspectTrackArtifact(trackId) {
  const root = await navigator.storage.getDirectory();
  let trackDirectory;

  try {
    trackDirectory = await root.getDirectoryHandle(trackId, { create: false });
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        opfsState: "missing",
        metadata: null
      };
    }

    return {
      opfsState: "broken",
      metadata: null,
      error: error?.message || String(error)
    };
  }

  const metadataResult = await readJsonArtifact(trackDirectory, ARTIFACT_FILES.metadata);
  const pcmResult = await inspectFileArtifact(trackDirectory, ARTIFACT_FILES.pcmBase64);

  if (metadataResult.missing && pcmResult.missing) {
    return {
      opfsState: "missing",
      metadata: null
    };
  }

  const metadata = metadataResult.value || null;
  const errors = [];
  if (metadataResult.error) {
    errors.push(metadataResult.error);
  }
  if (pcmResult.error) {
    errors.push(pcmResult.error);
  }
  if (metadataResult.missing) {
    errors.push("Missing metadata artifact.");
  }
  if (pcmResult.missing) {
    errors.push("Missing PCM artifact.");
  }
  if (metadata && !isValidMetadata(metadata, trackId)) {
    errors.push("Metadata is invalid for the current storage version.");
  }

  if (errors.length > 0) {
    return {
      opfsState: "broken",
      metadata,
      error: errors.join(" ")
    };
  }

  return {
    opfsState: "hydrated",
    metadata
  };
}

export async function readTrackArtifact(trackId) {
  const root = await navigator.storage.getDirectory();
  const trackDirectory = await root.getDirectoryHandle(trackId, { create: false });
  const metadataResult = await readJsonArtifact(trackDirectory, ARTIFACT_FILES.metadata);
  const pcmResult = await readTextArtifact(trackDirectory, ARTIFACT_FILES.pcmBase64);

  if (metadataResult.error) {
    throw new Error(metadataResult.error);
  }
  if (pcmResult.error) {
    throw new Error(pcmResult.error);
  }
  if (metadataResult.missing) {
    throw new Error("Missing metadata artifact.");
  }
  if (pcmResult.missing) {
    throw new Error("Missing PCM artifact.");
  }
  if (!isValidMetadata(metadataResult.value, trackId)) {
    throw new Error("Metadata is invalid for the current storage version.");
  }

  return {
    metadata: metadataResult.value,
    pcmS16leB64: pcmResult.value
  };
}

export async function writeTrackArtifact(trackId, pcmBase64, metadata) {
  const root = await navigator.storage.getDirectory();
  const trackDirectory = await root.getDirectoryHandle(trackId, { create: true });

  await writeTextFile(trackDirectory, ARTIFACT_FILES.pcmBase64, pcmBase64);
  await writeTextFile(trackDirectory, ARTIFACT_FILES.metadata, JSON.stringify(metadata, null, 2));
}

export async function deleteTrackArtifact(trackId) {
  const root = await navigator.storage.getDirectory();

  try {
    await root.removeEntry(trackId, { recursive: true });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

export function isValidMetadata(metadata, trackId) {
  return Boolean(
    metadata &&
      metadata.storageVersion === STORAGE_VERSION &&
      metadata.trackId === trackId &&
      metadata.audioSampleFormat === "PCM_S16LE" &&
      metadata.audioChannelLayout === "interleaved" &&
      typeof metadata.trackArtworkSrc === "string" &&
      Number.isFinite(metadata.audioByteLength) &&
      typeof metadata.md5 === "string" &&
      metadata.md5.length === 32
  );
}

async function readJsonArtifact(directory, filename) {
  const textResult = await readTextArtifact(directory, filename);
  if (textResult.missing || textResult.error) {
    return textResult;
  }

  try {
    return {
      value: JSON.parse(textResult.value)
    };
  } catch (error) {
    return {
      value: null,
      error: error?.message || String(error)
    };
  }
}

async function readTextArtifact(directory, filename) {
  try {
    const handle = await directory.getFileHandle(filename, { create: false });
    const file = await handle.getFile();
    return {
      value: await file.text()
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        missing: true,
        value: null
      };
    }

    return {
      value: null,
      error: error?.message || String(error)
    };
  }
}

async function inspectFileArtifact(directory, filename) {
  try {
    const handle = await directory.getFileHandle(filename, { create: false });
    await handle.getFile();
    return {
      missing: false
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        missing: true
      };
    }

    return {
      missing: false,
      error: error?.message || String(error)
    };
  }
}

async function writeTextFile(directory, filename, text) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

function isNotFoundError(error) {
  return error?.name === "NotFoundError";
}
