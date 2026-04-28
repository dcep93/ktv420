import { fetchObjectBlob } from "./gcsClient";
import { cacheMd5Files, type CachedOutputRecord } from "./indexedDbClient";
import { type ObjectTreeNode } from "../lib/types";
import { collectFileNodes } from "../lib/utils";

export const fetchFilesForNode = async (node: ObjectTreeNode) => {
  const fileNodes = collectFileNodes(node);

  if (!fileNodes.length) {
    throw new Error("No files were found for this selection.");
  }

  return Promise.all(
    fileNodes.map(async (fileNode) => ({
      name: fileNode.name,
      path: fileNode.path,
      blob: await fetchObjectBlob(fileNode.path),
    }))
  );
};

export const cacheFilesForNode = async (
  md5: string,
  node: ObjectTreeNode
): Promise<CachedOutputRecord> => {
  const files = await fetchFilesForNode(node);

  await cacheMd5Files(md5, files);

  return { md5, files };
};
