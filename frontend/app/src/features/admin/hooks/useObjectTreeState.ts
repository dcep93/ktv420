import { useCallback, useState } from "react";

import { formatErrorMessage } from "../../stems/lib/errors";
import { buildObjectTree } from "../../stems/lib/objectTree";
import { type GcsObject, type ObjectTreeNode } from "../../stems/lib/types";
import { withAsyncFlag } from "../../stems/lib/utils";
import { listBucketObjects } from "../../stems/services/gcsClient";

export function useObjectTreeState() {
  const [objects, setObjects] = useState<GcsObject[]>([]);
  const [objectTree, setObjectTree] = useState<ObjectTreeNode[]>([]);
  const [isListing, setIsListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const refreshObjectList = useCallback(async () => {
    const functionName = "refreshObjectList";

    setListError(null);

    await withAsyncFlag(setIsListing, async () => {
      try {
        const listedObjects = await listBucketObjects();
        setObjects(listedObjects);
        setObjectTree(buildObjectTree(listedObjects));
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        setListError(formattedMessage);
        console.error(formattedMessage, error);
      }
    });
  }, []);

  const clearObjectList = useCallback(() => {
    setObjects([]);
    setObjectTree([]);
  }, []);

  return {
    clearObjectList,
    isListing,
    listError,
    objects,
    objectTree,
    refreshObjectList,
  };
}
