import CryptoJS from "crypto-js";

import { formatErrorMessage } from "../lib/errors";
import { type GcsObject } from "../lib/types";

export const BUCKET_NAME = "stem420-bucket";
const STORAGE_API_BASE_URL = "https://storage.googleapis.com/storage/v1";
const STORAGE_UPLOAD_BASE_URL =
  "https://storage.googleapis.com/upload/storage/v1";

const bucketObjectsUrl = () =>
  new URL(`${STORAGE_API_BASE_URL}/b/${BUCKET_NAME}/o`);

const cacheBustedUrl = (url: string | URL) => {
  const nextUrl = new URL(url.toString());
  nextUrl.searchParams.set("_ktv420_ts", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return nextUrl.toString();
};

const objectUrl = (objectPath: string, { media = false } = {}) => {
  const encodedName = encodeURIComponent(objectPath);
  const mediaQuery = media ? "?alt=media" : "";

  return `${STORAGE_API_BASE_URL}/b/${BUCKET_NAME}/o/${encodedName}${mediaQuery}`;
};

const uploadObjectUrl = (objectPath: string) => {
  const encodedName = encodeURIComponent(objectPath);

  return `${STORAGE_UPLOAD_BASE_URL}/b/${BUCKET_NAME}/o?uploadType=media&name=${encodedName}`;
};

export async function computeMd5(file: File) {
  const functionName = "computeMd5";

  try {
    const arrayBuffer = await file.arrayBuffer();
    const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);
    return CryptoJS.MD5(wordArray).toString(CryptoJS.enc.Hex);
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

export async function listBucketObjects(): Promise<GcsObject[]> {
  const functionName = "listBucketObjects";

  try {
    let pageToken: string | undefined;
    const objects: GcsObject[] = [];
    const folderNames = new Set<string>();

    do {
      const listUrl = bucketObjectsUrl();

      if (pageToken) {
        listUrl.searchParams.set("pageToken", pageToken);
      }

      const requestUrl = cacheBustedUrl(listUrl);
      const listResponse = await fetch(requestUrl, { cache: "no-store" });

      if (!listResponse.ok) {
        throw new Error(
          `Failed to list objects: ${listResponse.status} ${listResponse.statusText}`
        );
      }

      const listData = (await listResponse.json()) as {
        items?: { name: string; size?: string }[];
        prefixes?: string[];
        nextPageToken?: string;
      };

      const items = listData.items ?? [];
      console.log("[ktv420 settings] GCS list page", {
        url: requestUrl,
        status: listResponse.status,
        itemCount: items.length,
        itemNames: items.map((item) => item.name),
        nextPageToken: listData.nextPageToken ?? null
      });
      const parsedObjects = items.map((item) => ({
        name: item.name,
        size: Number(item.size ?? 0),
        type: "file" as const,
      }));

      for (const item of items) {
        const itemParts = item.name.split("/");

        if (itemParts.length < 2) {
          continue;
        }

        let accumulatedPath = "";

        for (let index = 0; index < itemParts.length - 1; index += 1) {
          accumulatedPath += `${itemParts[index]}/`;
          folderNames.add(accumulatedPath);
        }
      }

      objects.push(...parsedObjects);
      pageToken = listData.nextPageToken;
    } while (pageToken);

    const parsedFolders = Array.from(folderNames).map((prefix) => ({
      name: prefix,
      size: 0,
      type: "folder" as const,
    }));

    const result = [...objects, ...parsedFolders];
    console.log("[ktv420 settings] GCS list complete", {
      objectCount: objects.length,
      folderCount: parsedFolders.length,
      resultCount: result.length,
      names: result.map((object) => object.name)
    });
    return result;
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

export async function fetchObjectContents(objectPath: string): Promise<string> {
  const functionName = "fetchObjectContents";

  try {
    const response = await fetch(cacheBustedUrl(objectUrl(objectPath, { media: true })), {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch object: ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

export async function fetchObjectBlob(objectPath: string): Promise<Blob> {
  const functionName = "fetchObjectBlob";

  try {
    const response = await fetch(cacheBustedUrl(objectUrl(objectPath, { media: true })), {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch object: ${response.status} ${response.statusText}`
      );
    }

    return await response.blob();
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

export async function objectExists(objectPath: string): Promise<boolean> {
  const functionName = "objectExists";

  try {
    const metadataResponse = await fetch(cacheBustedUrl(objectUrl(objectPath)), {
      cache: "no-store"
    });

    if (metadataResponse.ok) {
      return true;
    }

    if (metadataResponse.status === 404) {
      return false;
    }

    throw new Error(
      `Unexpected response when checking object: ${metadataResponse.status}`
    );
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

export async function uploadObject(objectPath: string, file: File) {
  const functionName = "uploadObject";

  try {
    const uploadResponse = await fetch(uploadObjectUrl(objectPath), {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with status ${uploadResponse.status}`);
    }
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

export async function deleteObject(objectPath: string) {
  const functionName = "deleteObject";

  try {
    const deleteResponse = await fetch(objectUrl(objectPath), {
      method: "DELETE",
    });

    if (!deleteResponse.ok) {
      throw new Error(
        `Failed to delete ${objectPath}: ${deleteResponse.status} ${deleteResponse.statusText}`
      );
    }
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

export async function deleteObjectsWithPrefix(prefix: string): Promise<number> {
  const functionName = "deleteObjectsWithPrefix";

  try {
    const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    let pageToken: string | undefined;
    let deletedCount = 0;

    do {
      const listUrl = bucketObjectsUrl();

      listUrl.searchParams.set("prefix", normalizedPrefix);

      if (pageToken) {
        listUrl.searchParams.set("pageToken", pageToken);
      }

      const listResponse = await fetch(cacheBustedUrl(listUrl), { cache: "no-store" });

      if (!listResponse.ok) {
        throw new Error(
          `Failed to list objects: ${listResponse.status} ${listResponse.statusText}`
        );
      }

      const listData = (await listResponse.json()) as {
        items?: { name: string }[];
        nextPageToken?: string;
      };

      const items = listData.items ?? [];

      for (const item of items) {
        const deleteResponse = await fetch(objectUrl(item.name), {
          method: "DELETE",
        });

        if (!deleteResponse.ok) {
          throw new Error(
            `Failed to delete ${item.name}: ${deleteResponse.status} ${deleteResponse.statusText}`
          );
        }

        deletedCount += 1;
      }

      pageToken = listData.nextPageToken;
    } while (pageToken);

    return deletedCount;
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}
