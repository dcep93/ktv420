import { type ObjectTreeNode } from "./types";

export const MD5_PATTERN = /^[a-f0-9]{32}$/;

export const extractMd5FromPath = (path: string) => {
  const trimmedPath = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = trimmedPath.split("/");

  for (const part of parts) {
    if (MD5_PATTERN.test(part)) {
      return part;
    }
  }

  return null;
};

export const isMd5Folder = (node: ObjectTreeNode) =>
  node.type === "folder" && MD5_PATTERN.test(node.name);

export const isInputFolder = (node: ObjectTreeNode) =>
  node.type === "folder" && node.name.toLowerCase() === "input";

export const isOutputFolder = (node: ObjectTreeNode) =>
  node.type === "folder" && node.name.toLowerCase() === "output";

export const collectFileNodes = (node: ObjectTreeNode): ObjectTreeNode[] => {
  if (node.type === "file") {
    return [node];
  }

  const childNodes = node.children ?? [];

  return childNodes.flatMap((child) => collectFileNodes(child));
};

export const findFirstMp3File = (node: ObjectTreeNode): ObjectTreeNode | null => {
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

export const parseJsonSafely = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const buildOutputPath = (mp3Path: string) => {
  const outputPath = mp3Path.replace(/\/input\/[^/]+$/, "/output/");

  if (outputPath === mp3Path) {
    return null;
  }

  return outputPath;
};

export const withAsyncFlag = async <T>(
  setFlag: (value: boolean) => void,
  task: () => Promise<T>
) => {
  setFlag(true);

  try {
    return await task();
  } finally {
    setFlag(false);
  }
};

export const createStepRecorder = () => {
  const steps: string[] = [];

  return {
    steps,
    recordStep: (description: string) => steps.push(description),
    summary: () => steps.join(", "),
    summaryWithFailure: (failureMessage: string) =>
      steps.length
        ? `${steps.join(", ")}, Failure: ${failureMessage}`
        : `Failure: ${failureMessage}`,
  };
};
