import CryptoJS from "crypto-js";
import { useEffect, useState } from "react";
import recorded_sha from "./recorded_sha";

const BUCKET_NAME = "stem420-bucket";

type GcsObject = {
  name: string;
  size: number;
  type: "file" | "folder";
};

async function computeMd5(file: File) {
  const functionName = "computeMd5";

  try {
    const arrayBuffer = await file.arrayBuffer();
    const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);
    return CryptoJS.MD5(wordArray).toString(CryptoJS.enc.Hex);
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

function formatErrorMessage(functionName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `[${functionName}] ${message}`;
}

async function listBucketObjects(): Promise<GcsObject[]> {
  const functionName = "listBucketObjects";

  try {
    let pageToken: string | undefined;
    const objects: GcsObject[] = [];
    const folderNames = new Set<string>();

    do {
      const listUrl = new URL(
        `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o`
      );

      listUrl.searchParams.set("delimiter", "/");

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

      const parsedFolders = (listData.prefixes ?? [])
        .filter((prefix) => {
          if (folderNames.has(prefix)) {
            return false;
          }

          folderNames.add(prefix);
          return true;
        })
        .map((prefix) => ({
          name: prefix,
          size: 0,
          type: "folder" as const,
        }));

      objects.push(...parsedObjects);
      objects.push(...parsedFolders);
      pageToken = listData.nextPageToken;
    } while (pageToken);

    return objects;
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

export default function Stem420() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [objects, setObjects] = useState<GcsObject[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const isBusy = isUploading || isDeleting;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
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
      const objectNames = objectsToDelete.map((object) => object.name);

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

  const refreshObjectList = async () => {
    const functionName = "refreshObjectList";

    setIsListing(true);
    setListError(null);

    try {
      const listedObjects = await listBucketObjects();
      setObjects(listedObjects);
    } catch (error) {
      const formattedMessage = formatErrorMessage(functionName, error);
      setListError(formattedMessage);
      console.error(formattedMessage, error);
    } finally {
      setIsListing(false);
    }
  };

  const handleFolderClick = async (object: GcsObject) => {
    const functionName = "handleFolderClick";

    if (object.type !== "folder") {
      return;
    }

    const trimmedName = object.name.endsWith("/")
      ? object.name.slice(0, -1)
      : object.name;
    const folderName = trimmedName.split("/").pop();

    if (folderName !== "input") {
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
          body: JSON.stringify({ path: object.name }),
        }
      );

      const responseText = await response.text();
      let parsedResponse: unknown;

      try {
        parsedResponse = JSON.parse(responseText);
      } catch (parseError) {
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
    void refreshObjectList();
  }, []);

  return (
    <div>
      <div>testing123 {recorded_sha}</div>
      <div style={{ marginTop: "1rem" }}>
        <h2>GCS Bucket Contents</h2>
        <button onClick={refreshObjectList} disabled={isBusy || isListing}>
          {isListing ? "Refreshing..." : "Refresh List"}
        </button>
        {listError && (
          <div style={{ color: "red", marginTop: "0.5rem" }}>{listError}</div>
        )}
        {!listError && objects.length === 0 && !isListing ? (
          <div style={{ marginTop: "0.5rem" }}>No files found in bucket.</div>
        ) : null}
        {objects.length > 0 ? (
          <ul style={{ marginTop: "0.5rem" }}>
            {objects.map((object) => (
              <li key={object.name}>
                {object.type === "folder" ? (
                  <button
                    type="button"
                    onClick={() => void handleFolderClick(object)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "blue",
                      textDecoration: "underline",
                      cursor: "pointer",
                    }}
                  >
                    <code>{object.name}</code>
                  </button>
                ) : (
                  <code>{object.name}</code>
                )}
                
                —
                {object.type === "folder"
                  ? " folder"
                  : ` ${object.size.toLocaleString()} bytes`}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div style={{ marginTop: "1rem" }}>
        <input type="file" onChange={handleFileChange} disabled={isBusy} />
        <button
          onClick={handleUpload}
          disabled={isBusy}
          style={{ marginLeft: "0.5rem" }}
        >
          {isUploading ? "Uploading..." : "Upload to GCS"}
        </button>
        <button
          onClick={handleDeleteAll}
          disabled={isBusy}
          style={{ marginLeft: "0.5rem" }}
        >
          {isDeleting ? "Deleting..." : "Delete All GCS Files"}
        </button>
      </div>
    </div>
  );
}
