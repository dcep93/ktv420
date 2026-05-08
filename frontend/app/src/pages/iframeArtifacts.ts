const BUCKET_NAME = "stem420-bucket";
const STORAGE_API_BASE_URL = "https://storage.googleapis.com/storage/v1";
const STEM_API_BASE_URL = "https://stem420-854199998954.us-east1.run.app";
const QUEUE_HEAD_STATE_PATH = "queue/state/head.json";
const REQUIRED_OUTPUT_ARTIFACTS = [
  "_metadata.json",
  "bass.mp3",
  "drums.mp3",
  "other.mp3",
  "vocals.mp3"
];

type GcsObject = {
  name: string;
};

type QueueItem = {
  track_id: string;
};

export type QueueHeadState = {
  revision: string;
  head_object: string | null;
  head_track_id: string | null;
  head_state: "pending" | "running" | "empty";
  last_changed_track_id: string | null;
  last_changed_status: "completed" | "failed" | null;
  changed_track_ids?: string[];
};

export type RemoteOutputStatus =
  | { status: "completed" }
  | { status: "failed"; error: string };

type StorageAccessDocument = Document & {
  hasStorageAccess?: () => Promise<boolean>;
  requestStorageAccess?: (types?: { getDirectory?: boolean }) => Promise<StorageAccessHandleLike>;
};

type StorageAccessHandleLike = {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
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
  metadataPath: string;
};

export type SavedSpotifyContext = {
  id: string;
  tracks: string[];
};

export type LocalPlaybackFile = {
  name: string;
  path: string;
  blob: Blob;
};

export type LocalPlaybackRecord = {
  md5: string;
  files: LocalPlaybackFile[];
};

export type StoredPlaybackRecording = {
  version: 1;
  name: string;
  createdAt: string;
  trackIds: string[];
  events: Array<{
    type: string;
    trackTimeSeconds: number;
    payload?: Record<string, unknown> | null;
  }>;
};

let unpartitionedOpfsRoot: FileSystemDirectoryHandle | null = null;
let unpartitionedOpfsRootPromise: Promise<FileSystemDirectoryHandle> | null = null;

export async function requestUnpartitionedOpfsAccess() {
  if (!isEmbeddedInCrossOriginFrame()) {
    return true;
  }

  await getOpfsRoot({ requestUnpartitionedAccess: true });
  return true;
}

export async function downloadArtifactsToOpfs(trackId: string, metadata: Record<string, unknown>) {
  const inputPrefix = `stems/${trackId}/input/`;
  const outputPrefix = `stems/${trackId}/output/`;
  const outputMetadataPath = `${outputPrefix}_metadata.json`;
  const [inputObjects, outputObjects] = await Promise.all([
    listObjectsWithPrefix(inputPrefix),
    listObjectsWithPrefix(outputPrefix)
  ]);

  if (!outputObjects.some((object) => object.name === outputMetadataPath)) {
    throw new Error(`No output metadata found at ${outputMetadataPath}.`);
  }

  await removeOpfsEntry(`stems/${trackId}`);

  const objects = [...inputObjects, ...outputObjects].sort((a, b) =>
    compareDownloadOrder(a.name, b.name, outputMetadataPath)
  );
  let fileCount = 0;

  for (const object of objects) {
    const blob = await fetchObjectBlob(object.name);
    const localPath = `stems/${trackId}/${relativeArtifactPath(trackId, object.name)}`;
    await writeOpfsBlob(localPath, blob);
    fileCount += 1;
  }

  const metadataPath = `stems/${trackId}/metadata.json`;
  await writeOpfsText(metadataPath, JSON.stringify(metadata, null, 2));

  const deletedCount =
    (await deleteObjectsWithPrefix(inputPrefix)) + (await deleteObjectsWithPrefix(outputPrefix));

  return {
    deletedCount,
    fileCount,
    inputFileCount: inputObjects.length,
    outputFileCount: outputObjects.length,
    metadataPath
  } satisfies DownloadArtifactsResult;
}

export async function hasLocalOutputMetadata(trackId: string) {
  try {
    const root = await getOpfsRoot();
    const stemsDirectory = await root.getDirectoryHandle("stems", { create: false });
    const trackDirectory = await stemsDirectory.getDirectoryHandle(trackId, { create: false });
    const outputDirectory = await trackDirectory.getDirectoryHandle("output", { create: false });
    await Promise.all(
      REQUIRED_OUTPUT_ARTIFACTS.map((artifact) =>
        outputDirectory.getFileHandle(artifact, { create: false })
      )
    );
    return true;
  } catch (error) {
    if (isNotFoundError(error) || isStorageAccessRequiredError(error)) {
      return false;
    }

    throw error;
  }
}

export async function hasRemoteOutputMetadata(trackId: string) {
  const metadataPath = `stems/${trackId}/output/_metadata.json`;
  const exists = await objectMediaExists(metadataPath);
  console.log("[ktv420 iframe] GCS output metadata probe", {
    trackId,
    path: metadataPath,
    exists
  });
  return exists;
}

export async function hasRemoteStemArtifacts(trackId: string) {
  if (await hasRemoteOutputMetadata(trackId)) {
    return true;
  }

  return await hasObjectsWithPrefix(`stems/${trackId}/`);
}

export async function readRemoteOutputStatus(trackId: string): Promise<RemoteOutputStatus | null> {
  if (await hasRemoteOutputMetadata(trackId)) {
    return { status: "completed" };
  }

  const errorPath = `stems/${trackId}/output/_error.json`;
  const errorPayload = await fetchObjectJsonOrNull(errorPath);
  if (errorPayload !== null) {
    return {
      status: "failed",
      error: readString((errorPayload as Record<string, unknown>).error) || "Remote processing failed."
    };
  }

  return null;
}

export async function readQueueHeadState() {
  const value = await fetchObjectJsonOrNull(QUEUE_HEAD_STATE_PATH);
  if (!isQueueHeadState(value)) {
    return null;
  }

  return value;
}

export async function listPendingQueueTrackIds() {
  const objects = await listObjectsWithPrefix("queue/pending/");
  const pendingTrackIds = new Set<string>();

  await Promise.all(
    objects
      .filter((object) => /\/[0-9]+\.json$/.test(object.name))
      .map(async (object) => {
        const value = await fetchObjectJsonOrNull(object.name);
        if (isQueueItem(value)) {
          pendingTrackIds.add(value.track_id);
        }
      })
  );

  return pendingTrackIds;
}

export async function kickProcessQueue() {
  const response = await fetch(`${STEM_API_BASE_URL}/process_queue`, { method: "POST" });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`process_queue failed with ${response.status} ${response.statusText}: ${responseText}`);
  }

  return responseText ? JSON.parse(responseText) as unknown : null;
}

export async function listLocalOpfsEntries() {
  const root = await getOpfsRoot();
  const entries: LocalDatabaseEntry[] = [];

  await collectOpfsDirectoryEntries(root, "", entries);
  return entries.sort(compareDatabaseEntries);
}

export async function deleteLocalOpfsEntry(path: string) {
  await removeOpfsEntry(path);
}

export async function readLocalOpfsFileContents(path: string) {
  const text = await readOpfsText(path);
  if (text === null) {
    throw new Error(`No OPFS file found at ${path}.`);
  }

  return text;
}

export async function saveSpotifyContext(record: SavedSpotifyContext) {
  await writeOpfsText(spotifyContextPath(record.id), JSON.stringify(record, null, 2));
}

export async function recordingExists(fileName: string) {
  return (await readOpfsText(recordingPath(fileName))) !== null;
}

export async function renameRecording(fromFileName: string, toFileName: string) {
  const text = await readOpfsText(recordingPath(fromFileName));

  if (text === null) {
    return;
  }

  await writeOpfsText(recordingPath(toFileName), text);
  await removeOpfsEntry(recordingPath(fromFileName));
}

export async function savePlaybackRecording(fileName: string, recording: StoredPlaybackRecording) {
  await writeOpfsText(recordingPath(fileName), JSON.stringify(recording, null, 2));
}

export async function readSpotifyContext(spotifyPath: string) {
  const value = await readOpfsJson(spotifyContextPath(spotifyPath));
  if (!isSavedSpotifyContext(value, spotifyPath)) {
    return null;
  }

  return value;
}

export async function readTrackMetadata(trackId: string) {
  return await readOpfsJson(`stems/${trackId}/metadata.json`);
}

export async function readTrackOutputMetadata(trackId: string) {
  return await readOpfsJson(`stems/${trackId}/output/_metadata.json`);
}

export async function readTrackPlaybackRecord(trackId: string): Promise<LocalPlaybackRecord> {
  const [inputFiles, outputFiles] = await Promise.all([
    readOpfsFiles(`stems/${trackId}/input`),
    readOpfsFiles(`stems/${trackId}/output`)
  ]);

  return {
    md5: trackId,
    files: [...outputFiles, ...inputFiles]
  };
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

    const response = await fetch(listUrl.toString(), { cache: "no-store" });

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

function compareDownloadOrder(a: string, b: string, markerPath: string) {
  if (a === markerPath) {
    return 1;
  }

  if (b === markerPath) {
    return -1;
  }

  return a.localeCompare(b);
}

async function hasObjectsWithPrefix(prefix: string) {
  const listUrl = bucketObjectsUrl();
  listUrl.searchParams.set("prefix", prefix);
  listUrl.searchParams.set("maxResults", "1");

  const response = await fetch(listUrl.toString(), { cache: "no-store" });
  const data = response.ok
    ? (await response.json()) as { items?: GcsObject[] }
    : null;

  console.log("[ktv420 iframe] GCS prefix probe", {
    prefix,
    url: listUrl.toString(),
    status: response.status,
    ok: response.ok,
    matchedObjects: data?.items?.map((object) => object.name) ?? []
  });

  if (!response.ok) {
    throw new Error(`Failed to check ${prefix}: ${response.status} ${response.statusText}`);
  }

  return (data?.items ?? []).length > 0;
}

async function fetchObjectBlob(objectPath: string) {
  const response = await fetch(objectUrl(objectPath, { media: true }), { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${objectPath}: ${response.status} ${response.statusText}`);
  }

  return await response.blob();
}

async function objectMediaExists(objectPath: string) {
  const url = objectUrl(objectPath, { media: true });
  const response = await fetch(url, { cache: "no-store" });
  console.log("[ktv420 iframe] GCS media existence probe", {
    path: objectPath,
    url,
    status: response.status,
    ok: response.ok
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Failed to check ${objectPath}: ${response.status} ${response.statusText}`);
  }

  await response.body?.cancel();
  return true;
}

async function fetchObjectJsonOrNull(objectPath: string) {
  const response = await fetch(objectUrl(objectPath, { media: true }), { cache: "no-store" });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${objectPath}: ${response.status} ${response.statusText}`);
  }

  return await response.json() as unknown;
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
  const root = await getOpfsRoot();
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
  const root = await getOpfsRoot();
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

async function readOpfsFiles(path: string) {
  const root = await getOpfsRoot();
  const parts = path.split("/").filter(Boolean);
  let directory = root;

  for (const part of parts) {
    try {
      directory = await directory.getDirectoryHandle(part, { create: false });
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  }

  const files: LocalPlaybackFile[] = [];
  await collectOpfsFiles(directory, parts.join("/"), files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectOpfsFiles(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  files: LocalPlaybackFile[]
) {
  const iterableDirectory = directory as FileSystemDirectoryHandle & {
    entries: () => AsyncIterable<[string, FileSystemHandle]>;
  };

  for await (const [name, handle] of iterableDirectory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;

    if (handle.kind === "directory") {
      await collectOpfsFiles(handle as FileSystemDirectoryHandle, path, files);
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    files.push({
      name,
      path,
      blob: file
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
  const root = await getOpfsRoot();
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

function isStorageAccessRequiredError(error: unknown) {
  return error instanceof Error && error.name === "StorageAccessRequiredError";
}

async function getOpfsRoot(options: { requestUnpartitionedAccess?: boolean } = {}) {
  if (!isEmbeddedInCrossOriginFrame()) {
    return await navigator.storage.getDirectory();
  }

  if (unpartitionedOpfsRoot) {
    return unpartitionedOpfsRoot;
  }

  if (unpartitionedOpfsRootPromise) {
    return await unpartitionedOpfsRootPromise;
  }

  const storageDocument = document as StorageAccessDocument;
  if (typeof storageDocument.requestStorageAccess !== "function") {
    throw storageAccessRequiredError("This browser cannot expose unpartitioned OPFS inside the iframe.");
  }

  if (!options.requestUnpartitionedAccess && typeof storageDocument.hasStorageAccess === "function") {
    const hasStorageAccess = await storageDocument.hasStorageAccess();
    if (!hasStorageAccess) {
      throw storageAccessRequiredError("Allow storage access to read the same OPFS used by /settings.");
    }
  }

  unpartitionedOpfsRootPromise = storageDocument
    .requestStorageAccess({ getDirectory: true })
    .then(async (storageAccessHandle) => {
      if (typeof storageAccessHandle?.getDirectory !== "function") {
        throw storageAccessRequiredError("Storage access was granted without OPFS directory access.");
      }

      unpartitionedOpfsRoot = await storageAccessHandle.getDirectory();
      return unpartitionedOpfsRoot;
    })
    .catch((error) => {
      unpartitionedOpfsRootPromise = null;
      throw storageAccessRequiredError(
        `Storage access was not granted, so the iframe cannot use the same OPFS as /settings. ${formatErrorMessage(error)}`
      );
    });

  return await unpartitionedOpfsRootPromise;
}

function storageAccessRequiredError(message: string) {
  const error = new Error(message);
  error.name = "StorageAccessRequiredError";
  return error;
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function isEmbeddedInCrossOriginFrame() {
  if (window.top === window) {
    return false;
  }

  const parentOrigin = getParentOrigin();
  return parentOrigin !== window.location.origin;
}

function getParentOrigin() {
  if (!document.referrer) {
    return "";
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return "";
  }
}

function relativeArtifactPath(trackId: string, objectPath: string) {
  const prefix = `stems/${trackId}/`;
  return objectPath.startsWith(prefix) ? objectPath.slice(prefix.length) : objectPath;
}

function spotifyContextPath(spotifyPath: string) {
  return `playlists/${spotifyPath}.json`;
}

function recordingPath(fileName: string) {
  return `recordings/${fileName}`;
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

function isQueueHeadState(value: unknown): value is QueueHeadState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const headState = record.head_state;
  const lastStatus = record.last_changed_status;
  return Boolean(
    typeof record.revision === "string" &&
      (record.head_object === null || typeof record.head_object === "string") &&
      (record.head_track_id === null || typeof record.head_track_id === "string") &&
      (headState === "pending" || headState === "running" || headState === "empty") &&
      (record.last_changed_track_id === null || typeof record.last_changed_track_id === "string") &&
      (lastStatus === null || lastStatus === "completed" || lastStatus === "failed") &&
      (
        record.changed_track_ids === undefined ||
        (
          Array.isArray(record.changed_track_ids) &&
          record.changed_track_ids.every((trackId) => typeof trackId === "string")
        )
      )
  );
}

function isQueueItem(value: unknown): value is QueueItem {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as QueueItem).track_id === "string"
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function bucketObjectsUrl() {
  return new URL(`${STORAGE_API_BASE_URL}/b/${BUCKET_NAME}/o`);
}

function objectUrl(objectPath: string, { media = false } = {}) {
  const encodedName = encodeURIComponent(objectPath);
  const mediaQuery = media ? "?alt=media" : "";

  return `${STORAGE_API_BASE_URL}/b/${BUCKET_NAME}/o/${encodedName}${mediaQuery}`;
}
