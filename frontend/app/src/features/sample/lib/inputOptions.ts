import { type GcsObject, type ObjectTreeNode } from "../../stems/lib/types";
import { extractMd5FromPath } from "../../stems/lib/utils";

export type InputOption = {
  value: string;
  label: string;
  md5: string;
};

export const buildInputHash = (label: string) =>
  `#${encodeURIComponent(label)}`;

export const parseInputHash = (hash: string): string | null => {
  const trimmedHash = hash.replace(/^#/, "");

  if (!trimmedHash) {
    return null;
  }

  try {
    return decodeURIComponent(trimmedHash);
  } catch (hashError) {
    console.warn("Failed to decode hash, using raw value.", hashError);
    return trimmedHash;
  }
};

export const buildInputOptions = (objects: GcsObject[]): InputOption[] => {
  const options = objects
    .filter(
      (object) => object.type === "file" && object.name.includes("/input/")
    )
    .map((object) => {
      const md5 = extractMd5FromPath(object.name);
      const fileName = object.name.split("/").pop() ?? object.name;

      if (!md5) {
        return null;
      }

      return {
        value: object.name,
        label: fileName,
        md5,
      } satisfies InputOption;
    })
    .filter((option): option is InputOption => Boolean(option));

  return options.sort((a, b) => a.label.localeCompare(b.label));
};

export const findMd5Node = (
  nodes: ObjectTreeNode[],
  md5: string
): ObjectTreeNode | null => {
  for (const node of nodes) {
    if (node.type === "folder" && node.name === md5) {
      return node;
    }

    const childResult = node.children ? findMd5Node(node.children, md5) : null;

    if (childResult) {
      return childResult;
    }
  }

  return null;
};
