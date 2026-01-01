import CryptoJS from "crypto-js";

import { formatErrorMessage } from "./errors";
import { type GcsObject } from "./types";

export const BUCKET_NAME = "stem420-bucket";

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
      const listUrl = new URL(
        `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o`
      );

      if (pageToken) {
        listUrl.searchParams.set("pageToken", pageToken);
      }

      const listResponse = await fetch(listUrl.toString());

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

    return [...objects, ...parsedFolders];
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}
