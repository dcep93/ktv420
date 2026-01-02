import { useEffect, useState } from "react";

import ObjectTreeView from "./components/ObjectTreeView";
import Player from "./components/Player";
import UploadControls from "./components/UploadControls";
import { formatErrorMessage } from "./errors";
import {
  BUCKET_NAME,
  computeMd5,
  deleteObjectsWithPrefix,
  fetchObjectBlob,
  fetchObjectContents,
  listBucketObjects,
} from "./gcsClient";
import {
  cacheMd5Files,
  clearCachedOutputs,
  getCachedMd5,
  type CachedOutputRecord,
} from "./indexedDbClient";
import { buildObjectTree } from "./objectTree";
import sha from "./sha.json";
import { type GcsObject, type ObjectTreeNode } from "./types";
import {
  buildOutputPath,
  collectFileNodes,
  createStepRecorder,
  extractMd5FromPath,
  findFirstMp3File,
  isInputFolder,
  isMd5Folder,
  isOutputFolder,
  parseJsonSafely,
  withAsyncFlag,
} from "./utils";

export default function Stem420() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [isCachingOutputs, setIsCachingOutputs] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [rootResponse, setRootResponse] = useState<unknown | null>(null);
  const [objects, setObjects] = useState<GcsObject[]>([]);
  const [objectTree, setObjectTree] = useState<ObjectTreeNode[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<
    CachedOutputRecord | undefined
  >();

  const fetchRootResponse = async () => {
    const functionName = "fetchRootResponse";

    try {
      const response = await fetch(
        "https://stem420-854199998954.us-east1.run.app/"
      );
      const responseText = await response.text();
      const parsedResponse = parseJsonSafely(responseText);

      setRootResponse(parsedResponse);

      if (!response.ok) {
        throw new Error(
          `Request failed with status ${response.status}: ${response.statusText}`
        );
      }
    } catch (error) {
      const formattedMessage = formatErrorMessage(functionName, error);
      console.error(formattedMessage, error);
      setRootResponse({ error: formattedMessage });
    }
  };

  const isBusy =
    isUploading || isDeleting || isCachingOutputs || isClearingCache;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
  };

  const refreshObjectList = async () => {
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
  };

  const handleUpload = async () => {
    const functionName = "handleUpload";

    if (!file) {
      alert("Please select a file to upload.");
      return;
    }

    const { recordStep, summary, summaryWithFailure } = createStepRecorder();

    await withAsyncFlag(setIsUploading, async () => {
      try {
        recordStep("Constructing MD5 checksum");
        const md5Hash = await computeMd5(file);
        recordStep("Checking for existing file in GCS");
        const objectPath = `_stem420/${md5Hash}/input/${file.name}`;
        recordStep(objectPath);
        const encodedPath = encodeURIComponent(objectPath);
        const metadataUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodedPath}`;

        const metadataResponse = await fetch(metadataUrl);

        if (metadataResponse.ok) {
          recordStep("File already exists in bucket");
          recordStep(objectPath);

          alert(summary());
          return;
        }

        if (metadataResponse.status !== 404) {
          throw new Error(
            `Unexpected response when checking object: ${metadataResponse.status}`
          );
        }

        recordStep("Uploading file to GCS");
        const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${encodedPath}`;

        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed with status ${uploadResponse.status}`);
        }

        recordStep("Upload complete");

        await refreshObjectList();
        alert(summary());
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        const alertMessage = summaryWithFailure(formattedMessage);

        console.error(formattedMessage, error);
        alert(alertMessage);
      }
    });
  };

  const handleDeleteAll = async () => {
    const functionName = "handleDeleteAll";
    const { recordStep, summary, summaryWithFailure } = createStepRecorder();

    if (!window.confirm("Delete all files from the GCS bucket?")) {
      return;
    }

    await withAsyncFlag(setIsDeleting, async () => {
      try {
        recordStep("Fetching object list");
        const objectsToDelete = await listBucketObjects();
        const objectNames = objectsToDelete
          .filter((object) => object.type === "file")
          .map((object) => object.name);

        if (objectNames.length === 0) {
          recordStep("Bucket is already empty");
          alert(summary());
          return;
        }

        recordStep(`Deleting ${objectNames.length} object(s)`);

        for (const objectName of objectNames) {
          const encodedName = encodeURIComponent(objectName);
          const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodedName}`;
          const deleteResponse = await fetch(deleteUrl, { method: "DELETE" });

          if (!deleteResponse.ok) {
            throw new Error(
              `Failed to delete ${objectName}: ${deleteResponse.status} ${deleteResponse.statusText}`
            );
          }
        }

        recordStep("Deletion complete");
        setObjects([]);
        setObjectTree([]);
        alert(summary());
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        const alertMessage = summaryWithFailure(formattedMessage);

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

  const outputFolderExistsForMd5 = (md5: string): boolean => {
    const nodesToSearch = [...objectTree];

    while (nodesToSearch.length) {
      const currentNode = nodesToSearch.pop();

      if (!currentNode) {
        continue;
      }

      if (isMd5Folder(currentNode) && currentNode.name === md5) {
        return (currentNode.children ?? []).some((child) =>
          isOutputFolder(child)
        );
      }

      nodesToSearch.push(...(currentNode.children ?? []));
    }

    return false;
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
      const response = await fetch(
        "https://stem420-854199998954.us-east1.run.app/run_job",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mp3_path: mp3Path, output_path: outputPath }),
        }
      );

      const responseText = await response.text();
      const parsedResponse = parseJsonSafely(responseText);

      console.log("Run job response:", parsedResponse);

      if (!response.ok) {
        throw new Error(
          `Request failed with status ${response.status}: ${response.statusText}`
        );
      }
    } catch (error) {
      console.error(formatErrorMessage(functionName, error), error);
    }
  };

  const handleDeleteOutputFolder = async (node: ObjectTreeNode) => {
    const functionName = "handleDeleteOutputFolder";
    const normalizedPath = node.path.endsWith("/")
      ? node.path
      : `${node.path}/`;

    if (!window.confirm(`Delete all files under ${normalizedPath}?`)) {
      return;
    }

    await withAsyncFlag(setIsDeleting, async () => {
      try {
        const deletedCount = await deleteObjectsWithPrefix(normalizedPath);

        await refreshObjectList();

        const deletedMessage =
          deletedCount > 0
            ? `Deleted ${deletedCount} object(s) from ${normalizedPath}.`
            : `No objects found under ${normalizedPath}.`;

        alert(deletedMessage);
      } catch (error) {
        const formattedMessage = formatErrorMessage(functionName, error);
        console.error(formattedMessage, error);
        alert(formattedMessage);
      }
    });
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

    await withAsyncFlag(setIsCachingOutputs, async () => {
      try {
        const cachedRecord = await getCachedMd5(md5);

        if (cachedRecord) {
          setActiveRecord(cachedRecord);
          return;
        }

        const fileNodes = collectFileNodes(node);

        if (fileNodes.length === 0) {
          alert("No files found under this MD5 folder to cache.");
          return;
        }

        const files = await Promise.all(
          fileNodes.map(async (fileNode) => ({
            name: fileNode.name,
            path: fileNode.path,
            blob: await fetchObjectBlob(fileNode.path),
          }))
        );

        await cacheMd5Files(md5, files);

        const newRecord: CachedOutputRecord = { md5, files };
        setActiveRecord(newRecord);

        alert(`Downloaded and cached ${files.length} file(s) for ${md5}.`);
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
        const contents = await fetchObjectContents(object.path);
        const parsedContents = parseJsonSafely(contents);

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

  useEffect(() => {
    void refreshObjectList();
  }, []);

  const rootResponseText =
    rootResponse === null ? null : JSON.stringify(rootResponse, null, 2);

  return (
    <div>
      <pre
        onClick={() => void fetchRootResponse()}
        style={{ cursor: "pointer" }}
      >
        {JSON.stringify(sha, null, 2)}
      </pre>
      <pre>{rootResponseText}</pre>
      <ObjectTreeView
        isBusy={isBusy}
        isListing={isListing}
        listError={listError}
        objectTree={objectTree}
        totalObjects={objects.length}
        onRefresh={refreshObjectList}
        onFolderClick={handleFolderClick}
        isFolderClickable={(node) => {
          if (isInputFolder(node)) {
            const md5 = extractMd5FromPath(node.path);

            if (md5 && outputFolderExistsForMd5(md5)) {
              return false;
            }
          }

          return (
            isMd5Folder(node) || isInputFolder(node) || isOutputFolder(node)
          );
        }}
        onFileClick={handleFileClick}
      />
      <UploadControls
        isBusy={isBusy}
        isDeleting={isDeleting}
        isClearingCache={isClearingCache}
        isUploading={isUploading}
        onFileChange={handleFileChange}
        onUpload={handleUpload}
        onDeleteAll={handleDeleteAll}
        onClearCache={handleClearCache}
      />
      {activeRecord ? (
        <Player
          record={activeRecord}
          onClose={() => setActiveRecord(undefined)}
        />
      ) : null}
    </div>
  );
}
