const BUCKET_NAME = "stem420-bucket";
const STORAGE_API_BASE_URL = "https://storage.googleapis.com/storage/v1";

type GcsObject = {
  name: string;
};

type StoredArtifact = {
  gcsPath: string;
  localPath: string;
  size: number;
};

export type DownloadArtifactsResult = {
  deletedCount: number;
  fileCount: number;
  inputFileCount: number;
  outputFileCount: number;
  manifestPath: string;
};

export async function downloadArtifactsToOpfs(md5: string, metadata: Record<string, unknown>) {
  const inputPrefix = `_stem420/${md5}/input/`;
  const outputPrefix = `_stem420/${md5}/output/`;
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

  await removeOpfsEntry(`stems/${md5}`);

  const objects = [...inputObjects, ...outputObjects];
  const storedFiles: StoredArtifact[] = [];

  for (const object of objects) {
    const blob = await fetchObjectBlob(object.name);
    const localPath = `stems/${md5}/${relativeArtifactPath(md5, object.name)}`;
    await writeOpfsBlob(localPath, blob);
    storedFiles.push({
      gcsPath: object.name,
      localPath,
      size: blob.size
    });
  }

  const manifestPath = `stems/${md5}/manifest.json`;
  await writeOpfsText(
    manifestPath,
    JSON.stringify(
      {
        downloadedAt: new Date().toISOString(),
        md5,
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

function relativeArtifactPath(md5: string, objectPath: string) {
  const prefix = `_stem420/${md5}/`;
  return objectPath.startsWith(prefix) ? objectPath.slice(prefix.length) : objectPath;
}

function bucketObjectsUrl() {
  return new URL(`${STORAGE_API_BASE_URL}/b/${BUCKET_NAME}/o`);
}

function objectUrl(objectPath: string, { media = false } = {}) {
  const encodedName = encodeURIComponent(objectPath);
  const mediaQuery = media ? "?alt=media" : "";

  return `${STORAGE_API_BASE_URL}/b/${BUCKET_NAME}/o/${encodedName}${mediaQuery}`;
}
