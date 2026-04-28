import { BUCKET_NAME } from "./gcsClient";
import { parseJsonSafely } from "../lib/utils";

const STEM_API_BASE_URL = "https://stem420-854199998954.us-east1.run.app";

const readJsonResponse = async (response: Response) => {
  const responseText = await response.text();
  const parsedResponse = parseJsonSafely(responseText);

  if (!response.ok) {
    throw new Error(
      `Request failed with status ${response.status}: ${response.statusText}`
    );
  }

  return parsedResponse;
};

export const fetchRootResponse = async () => {
  const response = await fetch(`${STEM_API_BASE_URL}/`);

  return readJsonResponse(response);
};

export const runStemJob = async (objectPath: string, outputPath: string) => {
  const mp3Path = `gs://${BUCKET_NAME}/${objectPath}`;
  const response = await fetch(`${STEM_API_BASE_URL}/run_job`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mp3_path: mp3Path, output_path: outputPath }),
  });

  return readJsonResponse(response);
};
