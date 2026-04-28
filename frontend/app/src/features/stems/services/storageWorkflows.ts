import {
  computeMd5,
  deleteObject,
  deleteObjectsWithPrefix,
  fetchObjectContents,
  listBucketObjects,
  objectExists,
  uploadObject,
} from "./gcsClient";
import { parseJsonSafely } from "../lib/utils";

type StepRecorder = {
  recordStep: (description: string) => void;
};

export const buildInputObjectPath = (md5Hash: string, fileName: string) =>
  `_stem420/${md5Hash}/input/${fileName}`;

export const normalizeFolderPath = (path: string) =>
  path.endsWith("/") ? path : `${path}/`;

export async function uploadInputFile(file: File, recorder: StepRecorder) {
  recorder.recordStep("Constructing MD5 checksum");
  const md5Hash = await computeMd5(file);

  recorder.recordStep("Checking for existing file in GCS");
  const objectPath = buildInputObjectPath(md5Hash, file.name);
  recorder.recordStep(objectPath);

  if (await objectExists(objectPath)) {
    recorder.recordStep("File already exists in bucket");
    recorder.recordStep(objectPath);
    return false;
  }

  recorder.recordStep("Uploading file to GCS");
  await uploadObject(objectPath, file);
  recorder.recordStep("Upload complete");
  return true;
}

export async function deleteAllBucketFiles(recorder: StepRecorder) {
  recorder.recordStep("Fetching object list");
  const objectsToDelete = await listBucketObjects();
  const objectNames = objectsToDelete
    .filter((object) => object.type === "file")
    .map((object) => object.name);

  if (objectNames.length === 0) {
    recorder.recordStep("Bucket is already empty");
    return 0;
  }

  recorder.recordStep(`Deleting ${objectNames.length} object(s)`);

  for (const objectName of objectNames) {
    await deleteObject(objectName);
  }

  recorder.recordStep("Deletion complete");
  return objectNames.length;
}

export async function deleteFolderContents(path: string) {
  return deleteObjectsWithPrefix(normalizeFolderPath(path));
}

export async function fetchJsonObject(objectPath: string) {
  const contents = await fetchObjectContents(objectPath);

  return parseJsonSafely(contents);
}

export const buildDeleteMessage = (deletedCount: number, path: string) =>
  deletedCount > 0
    ? `Deleted ${deletedCount} object(s) from ${path}.`
    : `No objects found under ${path}.`;
