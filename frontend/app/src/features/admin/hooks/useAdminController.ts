import { useEffect, useState, type ChangeEvent } from "react";

import { formatErrorMessage } from "../../stems/lib/errors";
import {
  buildOutputPath,
  createStepRecorder,
  extractMd5FromPath,
  findFirstMp3File,
  isInputFolder,
  isMd5Folder,
  isOutputFolder,
  outputFolderExistsForMd5,
  withAsyncFlag,
} from "../../stems/lib/utils";
import { type ObjectTreeNode } from "../../stems/lib/types";
import { cacheFilesForNode } from "../../stems/services/cacheRecords";
import { BUCKET_NAME } from "../../stems/services/gcsClient";
import {
  clearCachedOutputs,
  getCachedMd5,
  type CachedOutputRecord,
} from "../../stems/services/indexedDbClient";
import {
  fetchRootResponse as fetchStemRootResponse,
  runStemJob,
} from "../../stems/services/stemApi";
import {
  buildDeleteMessage,
  deleteAllBucketFiles,
  deleteFolderContents,
  fetchJsonObject,
  normalizeFolderPath,
  uploadInputFile,
} from "../../stems/services/storageWorkflows";
import { useObjectTreeState } from "./useObjectTreeState";

export function useAdminController() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCachingOutputs, setIsCachingOutputs] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [rootResponse, setRootResponse] = useState<unknown | null>(null);
  const [activeRecord, setActiveRecord] = useState<
    CachedOutputRecord | undefined
  >();
  const {
    clearObjectList,
    isListing,
    listError,
    objects,
    objectTree,
    refreshObjectList,
  } = useObjectTreeState();

  const fetchRootResponse = async () => {
    const functionName = "fetchRootResponse";

    try {
      setRootResponse(await fetchStemRootResponse());
    } catch (error) {
      const formattedMessage = formatErrorMessage(functionName, error);
      console.error(formattedMessage, error);
      setRootResponse({ error: formattedMessage });
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  };

  const handleUpload = async () => {
    const functionName = "handleUpload";

    if (!file) {
      alert("Please select a file to upload.");
      return;
    }

    const stepRecorder = createStepRecorder();

    await withAsyncFlag(setIsUploading, async () => {
      try {
        const didUpload = await uploadInputFile(file, stepRecorder);

        if (didUpload) {
          await refreshObjectList();
        }

        alert(stepRecorder.summary());
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        const alertMessage = stepRecorder.summaryWithFailure(formattedMessage);

        console.error(formattedMessage, error);
        alert(alertMessage);
      }
    });
  };

  const handleDeleteAll = async () => {
    const functionName = "handleDeleteAll";
    const stepRecorder = createStepRecorder();

    if (!window.confirm("Delete all files from the GCS bucket?")) {
      return;
    }

    await withAsyncFlag(setIsDeleting, async () => {
      try {
        const deletedCount = await deleteAllBucketFiles(stepRecorder);

        if (deletedCount > 0) {
          clearObjectList();
        }

        alert(stepRecorder.summary());
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        const alertMessage = stepRecorder.summaryWithFailure(formattedMessage);

        console.error(formattedMessage, error);
        alert(alertMessage);
      }
    });
  };

  const handleClearCache = async () => {
    const functionName = "handleClearCache";

    if (!window.confirm("Clear all cached files from IndexedDB?")) {
      return;
    }

    await withAsyncFlag(setIsClearingCache, async () => {
      try {
        await clearCachedOutputs();
        setActiveRecord(undefined);
        alert("Cleared all cached files from IndexedDB.");
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        console.error(formattedMessage, error);
        alert(formattedMessage);
      }
    });
  };

  const triggerJobForMp3 = async (objectPath: string) => {
    const functionName = "triggerJobForMp3";
    const mp3Path = `gs://${BUCKET_NAME}/${objectPath}`;
    const outputPath = buildOutputPath(mp3Path);

    if (!outputPath) {
      console.error(
        formatErrorMessage(functionName, "Unable to determine output path"),
        mp3Path
      );
      return;
    }

    try {
      const parsedResponse = await runStemJob(objectPath, outputPath);

      console.log("Run job response:", parsedResponse);
    } catch (error) {
      console.error(formatErrorMessage(functionName, error), error);
    }
  };

  const handleDeleteOutputFolder = async (node: ObjectTreeNode) => {
    const functionName = "handleDeleteOutputFolder";
    const normalizedPath = normalizeFolderPath(node.path);

    if (!window.confirm(`Delete all files under ${normalizedPath}?`)) {
      return;
    }

    await withAsyncFlag(setIsDeleting, async () => {
      try {
        const deletedCount = await deleteFolderContents(normalizedPath);

        await refreshObjectList();
        alert(buildDeleteMessage(deletedCount, normalizedPath));
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        console.error(formattedMessage, error);
        alert(formattedMessage);
      }
    });
  };

  const handleDeleteFolder = async (node: ObjectTreeNode) => {
    const functionName = "handleDeleteFolder";
    const normalizedPath = normalizeFolderPath(node.path);

    await withAsyncFlag(setIsDeleting, async () => {
      try {
        const deletedCount = await deleteFolderContents(normalizedPath);

        await refreshObjectList();
        setActiveRecord(undefined);
        alert(buildDeleteMessage(deletedCount, normalizedPath));
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        console.error(formattedMessage, error);
        alert(formattedMessage);
      }
    });
  };

  const cacheMd5Folder = async (node: ObjectTreeNode, md5: string) => {
    const cachedRecord = await getCachedMd5(md5);

    if (cachedRecord) {
      setActiveRecord(cachedRecord);
      return;
    }

    const newRecord = await cacheFilesForNode(md5, node);
    setActiveRecord(newRecord);

    alert(`Downloaded and cached ${newRecord.files.length} file(s) for ${md5}.`);
  };

  const handleFolderClick = async (node: ObjectTreeNode) => {
    const functionName = "handleFolderClick";

    if (node.type !== "folder") {
      return;
    }

    if (isInputFolder(node)) {
      const mp3File = findFirstMp3File(node);

      if (!mp3File) {
        alert("No .mp3 file found in this input folder.");
        return;
      }

      await triggerJobForMp3(mp3File.path);
      return;
    }

    if (isOutputFolder(node)) {
      await handleDeleteOutputFolder(node);
      return;
    }

    if (!isMd5Folder(node)) {
      return;
    }

    const md5 = extractMd5FromPath(node.path);

    if (!md5) {
      console.error(formatErrorMessage(functionName, "Unable to locate MD5"));
      return;
    }

    const shouldDeleteMd5Folder = window.confirm(
      `Delete all files under ${node.path}/?\n\nSelect “Cancel” to keep the folder and cache files locally instead.`
    );

    if (shouldDeleteMd5Folder) {
      await handleDeleteFolder(node);
      return;
    }

    await withAsyncFlag(setIsCachingOutputs, async () => {
      try {
        await cacheMd5Folder(node, md5);
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        console.error(formattedMessage, error);
        alert(formattedMessage);
      }
    });
  };

  const handleFileClick = async (object: ObjectTreeNode) => {
    const functionName = "handleFileClick";

    if (object.type !== "file") {
      return;
    }

    const lowercaseName = object.name.toLowerCase();

    if (lowercaseName.endsWith(".json")) {
      try {
        const parsedContents = await fetchJsonObject(object.path);

        alert(JSON.stringify(parsedContents, null, 2));
      } catch (error) {
        console.error(formatErrorMessage(functionName, error), error);
      }

      return;
    }

    if (!lowercaseName.endsWith(".mp3")) {
      return;
    }

    await triggerJobForMp3(object.path);
  };

  const isFolderClickable = (node: ObjectTreeNode) => {
    if (isInputFolder(node)) {
      const md5 = extractMd5FromPath(node.path);

      if (md5 && outputFolderExistsForMd5(objectTree, md5)) {
        return false;
      }
    }

    return isMd5Folder(node) || isInputFolder(node) || isOutputFolder(node);
  };

  useEffect(() => {
    void refreshObjectList();
  }, [refreshObjectList]);

  return {
    activeRecord,
    closePlayer: () => setActiveRecord(undefined),
    fetchRootResponse,
    handleClearCache,
    handleDeleteAll,
    handleFileChange,
    handleFileClick,
    handleFolderClick,
    handleUpload,
    isBusy: isUploading || isDeleting || isCachingOutputs || isClearingCache,
    isClearingCache,
    isDeleting,
    isFolderClickable,
    isListing,
    isUploading,
    listError,
    objectTree,
    refreshObjectList,
    rootResponse,
    totalObjects: objects.length,
  };
}
