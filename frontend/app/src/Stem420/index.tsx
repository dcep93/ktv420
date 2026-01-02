import { useEffect, useState } from "react";

import ObjectTreeView from "./components/ObjectTreeView";
import Player from "./components/Player";
import UploadControls from "./components/UploadControls";
import { formatErrorMessage } from "./errors";
import {
  BUCKET_NAME,
  computeMd5,
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

const MD5_PATTERN = /^[a-f0-9]{32}$/;

const extractMd5FromPath = (path: string) => {
  const trimmedPath = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = trimmedPath.split("/");

  for (const part of parts) {
    if (MD5_PATTERN.test(part)) {
      return part;
    }
  }

  return null;
};

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
      let parsedResponse: unknown = responseText;

      try {
        parsedResponse = JSON.parse(responseText);
      } catch {
        parsedResponse = responseText;
      }

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

    setIsListing(true);
    setListError(null);

    try {
      const listedObjects = await listBucketObjects();
      setObjects(listedObjects);
      setObjectTree(buildObjectTree(listedObjects));
    } catch (error) {
      const formattedMessage = formatErrorMessage(functionName, error);
      setListError(formattedMessage);
      console.error(formattedMessage, error);
    } finally {
      setIsListing(false);
    }
  };

  const handleUpload = async () => {
    const functionName = "handleUpload";

    if (!file) {
      alert("Please select a file to upload.");
      return;
    }

    setIsUploading(true);
    const steps: string[] = [];

    const recordStep = (description: string) => {
      steps.push(description);
    };

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

        alert(steps.join(", "));
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
      alert(steps.join(", "));
    } catch (error) {
      const formattedMessage = formatErrorMessage(functionName, error);
      const stepDetails = steps.join(", ");
      const alertMessage = stepDetails
        ? `${stepDetails}, Failure: ${formattedMessage}`
        : `Failure: ${formattedMessage}`;

      console.error(formattedMessage, error);
      alert(alertMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAll = async () => {
    const functionName = "handleDeleteAll";
    const steps: string[] = [];

    const recordStep = (description: string) => {
      steps.push(description);
    };

    if (!window.confirm("Delete all files from the GCS bucket?")) {
      return;
    }

    setIsDeleting(true);

    try {
      recordStep("Fetching object list");
      const objectsToDelete = await listBucketObjects();
      const objectNames = objectsToDelete
        .filter((object) => object.type === "file")
        .map((object) => object.name);

      if (objectNames.length === 0) {
        recordStep("Bucket is already empty");
        alert(steps.join(", "));
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
      alert(steps.join(", "));
    } catch (error) {
      const formattedMessage = formatErrorMessage(functionName, error);
      const stepDetails = steps.join(", ");
      const alertMessage = stepDetails
        ? `${stepDetails}, Failure: ${formattedMessage}`
        : `Failure: ${formattedMessage}`;

      console.error(formattedMessage, error);
      alert(alertMessage);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClearCache = async () => {
    const functionName = "handleClearCache";

    if (!window.confirm("Clear all cached files from IndexedDB?")) {
      return;
    }

    setIsClearingCache(true);

    try {
      await clearCachedOutputs();
      setActiveRecord(undefined);
      alert("Cleared all cached files from IndexedDB.");
    } catch (error) {
      const formattedMessage = formatErrorMessage(functionName, error);
      console.error(formattedMessage, error);
      alert(formattedMessage);
    } finally {
      setIsClearingCache(false);
    }
  };

  const collectFileNodes = (node: ObjectTreeNode): ObjectTreeNode[] => {
    if (node.type === "file") {
      return [node];
    }

    const childNodes = node.children ?? [];

    return childNodes.flatMap((child) => collectFileNodes(child));
  };

  const isMd5Folder = (node: ObjectTreeNode) =>
    node.type === "folder" && MD5_PATTERN.test(node.name);

  const isInputFolder = (node: ObjectTreeNode) =>
    node.type === "folder" && node.name.toLowerCase() === "input";

  const findFirstMp3File = (node: ObjectTreeNode): ObjectTreeNode | null => {
    if (node.type === "file" && node.name.toLowerCase().endsWith(".mp3")) {
      return node;
    }

    for (const child of node.children ?? []) {
      const mp3File = findFirstMp3File(child);

      if (mp3File) {
        return mp3File;
      }
    }

    return null;
  };

  const triggerJobForMp3 = async (objectPath: string) => {
    const functionName = "triggerJobForMp3";
    const mp3Path = `gs://${BUCKET_NAME}/${objectPath}`;
    const outputPath = mp3Path.replace(/\/input\/[^/]+$/, "/output/");

    if (outputPath === mp3Path) {
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
      let parsedResponse: unknown;

      try {
        parsedResponse = JSON.parse(responseText);
      } catch {
        parsedResponse = responseText;
      }

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

    if (!isMd5Folder(node)) {
      return;
    }

    const md5 = extractMd5FromPath(node.path);

    if (!md5) {
      console.error(formatErrorMessage(functionName, "Unable to locate MD5"));
      return;
    }

    setIsCachingOutputs(true);

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
    } finally {
      setIsCachingOutputs(false);
    }
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
        let parsedContents: unknown = contents;

        try {
          parsedContents = JSON.parse(contents);
        } catch {
          parsedContents = contents;
        }

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
    void fetchRootResponse();
    void refreshObjectList();
  }, []);

  const rootResponseText =
    rootResponse === null
      ? "Fetching root response..."
      : JSON.stringify(rootResponse, null, 2);

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
        isFolderClickable={(node) => isMd5Folder(node) || isInputFolder(node)}
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
