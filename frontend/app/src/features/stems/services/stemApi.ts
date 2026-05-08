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

export const processQueue = async () => {
  const response = await fetch(`${STEM_API_BASE_URL}/process_queue`, {
    method: "POST",
  });

  return readJsonResponse(response);
};
