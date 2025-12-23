import { useState } from "react";
import recorded_sha from "./recorded_sha";

const BUCKET_NAME = "stem420";

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function computeSha256(file: File) {
  const functionName = "computeSha256";

  try {
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return toHex(hash);
  } catch (error) {
    throw new Error(formatErrorMessage(functionName, error));
  }
}

function formatErrorMessage(functionName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `[${functionName}] ${message}`;
}

export default function Stem420() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

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
      recordStep("Constructing SHA-256 checksum");
      const sha256Hash = await computeSha256(file);
      recordStep("Checking for existing file in GCS");
      const objectPath = `_stem420/${sha256Hash}/input/${file.name}`;
      const encodedPath = encodeURIComponent(objectPath);
      const metadataUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodedPath}`;

      const metadataResponse = await fetch(metadataUrl);

      if (metadataResponse.ok) {
        recordStep("File already exists in bucket");

        alert(steps.join(", "));
        return;
      }

      if (metadataResponse.status !== 404) {
        throw new Error(
          `Unexpected response when checking object: ${metadataResponse.status}`,
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

  return (
    <div>
      <div>testing123 {recorded_sha}</div>
      <div style={{ marginTop: "1rem" }}>
        <input type="file" onChange={handleFileChange} disabled={isUploading} />
        <button
          onClick={handleUpload}
          disabled={isUploading}
          style={{ marginLeft: "0.5rem" }}
        >
          {isUploading ? "Uploading..." : "Upload to GCS"}
        </button>
      </div>
    </div>
  );
}
