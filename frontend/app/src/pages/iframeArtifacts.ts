const BUCKET_NAME = "stem420-bucket";
const STORAGE_API_BASE_URL = "https://storage.googleapis.com/storage/v1";

export type GcsObject = {
  name: string;
};

export type StemRunRequest = {
  mp3_path: string;
  output_path: string;
};

type StoredArtifact = {
  gcsPath: string;
  localPath: string;
  size: number;
};

export type LocalDatabaseEntry = {
  path: string;
  kind: "directory" | "file";
  size?: number;
  modifiedAt?: string;
  text?: string;
};

export type DownloadArtifactsResult = {
  deletedCount: number;
  fileCount: number;
  inputFileCount: number;
  outputFileCount: number;
  manifestPath: string;
};

export type SavedSpotifyContext = {
  id: string;
  tracks: string[];
};

export async function downloadArtifactsToOpfs(trackId: string, metadata: Record<string, unknown>) {
  const inputPrefix = `stems/${trackId}/input/`;
  const outputPrefix = `stems/${trackId}/output/`;
  const [inputObjects, outputObjects] = await Promise.all([
    listObjectsWithPrefix(inputPrefix),
    listObjectsWithPrefix(outputPrefix)
  ]);

  if (outputObjects.length === 0) {
    throw new Error(`No output files found under ${outputPrefix}.`);
  }

  if (inputObjects.length === 0) {
    throw new Error(`No input MP3 found under ${inputPrefix}.`);
  }

  await removeOpfsEntry(`stems/${trackId}`);

  const objects = [...inputObjects, ...outputObjects];
  const storedFiles: StoredArtifact[] = [];

  for (const object of objects) {
    const blob = await fetchObjectBlob(object.name);
    const localPath = `stems/${trackId}/${relativeArtifactPath(trackId, object.name)}`;
    await writeOpfsBlob(localPath, blob);
    storedFiles.push({
      gcsPath: object.name,
      localPath,
      size: blob.size
    });
  }

  const manifestPath = `stems/${trackId}/manifest.json`;
  await writeOpfsText(
    manifestPath,
    JSON.stringify(
      {
        downloadedAt: new Date().toISOString(),
        trackId,
        metadata,
        files: storedFiles
      },
      null,
      2
    )
  );

  const deletedCount =
    (await deleteObjectsWithPrefix(inputPrefix)) + (await deleteObjectsWithPrefix(outputPrefix));

  return {
    deletedCount,
    fileCount: storedFiles.length,
    inputFileCount: inputObjects.length,
    outputFileCount: outputObjects.length,
    manifestPath
  } satisfies DownloadArtifactsResult;
}

export async function hasLocalOutputMetadata(trackId: string) {
  try {
    const root = await navigator.storage.getDirectory();
    const stemsDirectory = await root.getDirectoryHandle("stems", { create: false });
    const trackDirectory = await stemsDirectory.getDirectoryHandle(trackId, { create: false });
    const outputDirectory = await trackDirectory.getDirectoryHandle("output", { create: false });
    await outputDirectory.getFileHandle("_metadata.json", { create: false });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

export async function findPreparedInputMp3(trackId: string) {
  const inputObjects = await listObjectsWithPrefix(`stems/${trackId}/input/`);
  return inputObjects.find((object) => object.name.toLowerCase().endsWith(".mp3")) ?? null;
}

export async function hasRemoteOutputMetadata(trackId: string) {
  const metadataPath = `stems/${trackId}/output/_metadata.json`;
  const outputObjects = await listObjectsWithPrefix(metadataPath);
  return outputObjects.some((object) => object.name === metadataPath);
}

export function buildStemRunRequest(trackId: string, inputMp3: GcsObject): StemRunRequest {
  return {
    mp3_path: `gs://${BUCKET_NAME}/${inputMp3.name}`,
    output_path: `gs://${BUCKET_NAME}/stems/${trackId}/output/`
  };
}

export async function listLocalOpfsEntries() {
  const root = await navigator.storage.getDirectory();
  const entries: LocalDatabaseEntry[] = [];

  await collectOpfsDirectoryEntries(root, "", entries);
  return entries.sort(compareDatabaseEntries);
}

export async function deleteLocalOpfsEntry(path: string) {
  await removeOpfsEntry(path);
}

export async function saveSpotifyContext(record: SavedSpotifyContext) {
  await writeOpfsText(spotifyContextPath(record.id), JSON.stringify(record, null, 2));
}

export async function readSpotifyContext(spotifyPath: string) {
  const value = await readOpfsJson(spotifyContextPath(spotifyPath));
  if (!isSavedSpotifyContext(value, spotifyPath)) {
    return null;
  }

  return value;
}

export async function readTrackManifest(trackId: string) {
  return await readOpfsJson(`stems/${trackId}/manifest.json`);
}

export async function readTrackOutputMetadata(trackId: string) {
  return await readOpfsJson(`stems/${trackId}/output/_metadata.json`);
}

async function listObjectsWithPrefix(prefix: string): Promise<GcsObject[]> {
  const objects: GcsObject[] = [];
  let pageToken: string | undefined;

  do {
    const listUrl = bucketObjectsUrl();
    listUrl.searchParams.set("prefix", prefix);

    if (pageToken) {
      listUrl.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(listUrl.toString());

    if (!response.ok) {
      throw new Error(`Failed to list ${prefix}: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      items?: GcsObject[];
      nextPageToken?: string;
    };

    objects.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return objects;
}

async function fetchObjectBlob(objectPath: string) {
  const response = await fetch(objectUrl(objectPath, { media: true }));

  if (!response.ok) {
    throw new Error(`Failed to fetch ${objectPath}: ${response.status} ${response.statusText}`);
  }

  return await response.blob();
}

async function deleteObjectsWithPrefix(prefix: string) {
  const objects = await listObjectsWithPrefix(prefix);
  let deletedCount = 0;

  for (const object of objects) {
    const response = await fetch(objectUrl(object.name), { method: "DELETE" });

    if (!response.ok) {
      throw new Error(`Failed to delete ${object.name}: ${response.status} ${response.statusText}`);
    }

    deletedCount += 1;
  }

  return deletedCount;
}

async function writeOpfsBlob(path: string, blob: Blob) {
  const handle = await getOpfsFileHandle(path);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function writeOpfsText(path: string, text: string) {
  const handle = await getOpfsFileHandle(path);
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function readOpfsText(path: string) {
  const root = await navigator.storage.getDirectory();
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();

  if (!fileName) {
    return null;
  }

  let directory = root;
  for (const part of parts) {
    try {
      directory = await directory.getDirectoryHandle(part, { create: false });
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  try {
    const handle = await directory.getFileHandle(fileName, { create: false });
    const file = await handle.getFile();
    return await file.text();
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function readOpfsJson(path: string) {
  const text = await readOpfsText(path);
  if (text === null) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

async function getOpfsFileHandle(path: string) {
  const root = await navigator.storage.getDirectory();
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error("OPFS path must include a filename.");
  }

  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }

  return await directory.getFileHandle(fileName, { create: true });
}

async function collectOpfsDirectoryEntries(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  entries: LocalDatabaseEntry[]
) {
  const iterableDirectory = directory as FileSystemDirectoryHandle & {
    entries: () => AsyncIterable<[string, FileSystemHandle]>;
  };

  for await (const [name, handle] of iterableDirectory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;

    if (handle.kind === "directory") {
      entries.push({ path, kind: "directory" });
      await collectOpfsDirectoryEntries(handle as FileSystemDirectoryHandle, path, entries);
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    entries.push({
      path,
      kind: "file",
      size: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
      ...(isJsonPath(path) ? { text: await file.text() } : {})
    });
  }
}

function compareDatabaseEntries(a: LocalDatabaseEntry, b: LocalDatabaseEntry) {
  return a.path.localeCompare(b.path);
}

function isJsonPath(path: string) {
  return path.toLowerCase().endsWith(".json");
}

async function removeOpfsEntry(path: string) {
  const root = await navigator.storage.getDirectory();
  const parts = path.split("/").filter(Boolean);
  const entryName = parts.pop();

  if (!entryName) {
    return;
  }

  let directory = root;
  for (const part of parts) {
    try {
      directory = await directory.getDirectoryHandle(part, { create: false });
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }

      throw error;
    }
  }

  try {
    await directory.removeEntry(entryName, { recursive: true });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function isNotFoundError(error: unknown) {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function relativeArtifactPath(trackId: string, objectPath: string) {
  const prefix = `stems/${trackId}/`;
  return objectPath.startsWith(prefix) ? objectPath.slice(prefix.length) : objectPath;
}

function spotifyContextPath(spotifyPath: string) {
  return `playlists/${spotifyPath}.json`;
}

function isSavedSpotifyContext(value: unknown, spotifyPath: string): value is SavedSpotifyContext {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as SavedSpotifyContext).id === spotifyPath &&
      Array.isArray((value as SavedSpotifyContext).tracks) &&
      (value as SavedSpotifyContext).tracks.every((trackId) => typeof trackId === "string")
  );
}

function bucketObjectsUrl() {
  return new URL(`${STORAGE_API_BASE_URL}/b/${BUCKET_NAME}/o`);
}

function objectUrl(objectPath: string, { media = false } = {}) {
  const encodedName = encodeURIComponent(objectPath);
  const mediaQuery = media ? "?alt=media" : "";

  return `${STORAGE_API_BASE_URL}/b/${BUCKET_NAME}/o/${encodedName}${mediaQuery}`;
}
