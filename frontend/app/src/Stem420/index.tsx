import { useEffect, useState } from "react";

import ObjectTreeView from "./components/ObjectTreeView";
import UploadControls from "./components/UploadControls";
import { formatErrorMessage } from "./errors";
import {
  BUCKET_NAME,
  computeMd5,
  fetchObjectContents,
  listBucketObjects,
} from "./gcsClient";
import { buildObjectTree } from "./objectTree";
import { type GcsObject, type ObjectTreeNode } from "./types";

export default function Stem420() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [rootResponse, setRootResponse] = useState<unknown | null>(null);
  const [objects, setObjects] = useState<GcsObject[]>([]);
  const [objectTree, setObjectTree] = useState<ObjectTreeNode[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const fetchRootResponse = async () => {
    const functionName = "fetchRootResponse";

    try {
      const response = await fetch("https://stem420-854199998954.us-east1.run.app/");
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

  const isBusy = isUploading || isDeleting;

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

    const mp3Path = `gs://${BUCKET_NAME}/${object.path}`;
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
        {rootResponseText}
      </pre>
      <ObjectTreeView
        isBusy={isBusy}
        isListing={isListing}
        listError={listError}
        objectTree={objectTree}
        totalObjects={objects.length}
        onRefresh={refreshObjectList}
        onFileClick={handleFileClick}
      />
      <UploadControls
        isBusy={isBusy}
        isDeleting={isDeleting}
        isUploading={isUploading}
        onFileChange={handleFileChange}
        onUpload={handleUpload}
        onDeleteAll={handleDeleteAll}
      />
    </div>
  );
}
