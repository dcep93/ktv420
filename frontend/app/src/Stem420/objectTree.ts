import { type GcsObject, type ObjectTreeNode } from "./types";

export function buildObjectTree(objects: GcsObject[]): ObjectTreeNode[] {
  const folderMap = new Map<string, ObjectTreeNode>();
  const rootNodes: ObjectTreeNode[] = [];

  const ensureFolderNode = (parts: string[]) => {
    let currentChildren = rootNodes;
    let accumulatedPath = "";

    for (const part of parts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      const folderPath = `${accumulatedPath}/`;
      let folderNode = folderMap.get(folderPath);

      if (!folderNode) {
        folderNode = {
          name: part,
          path: folderPath,
          type: "folder",
          children: [],
        };

        folderMap.set(folderPath, folderNode);
        currentChildren.push(folderNode);
      }

      if (!folderNode.children) {
        folderNode.children = [];
      }

      currentChildren = folderNode.children;
    }
  };

  for (const object of objects) {
    const trimmedName =
      object.type === "folder" && object.name.endsWith("/")
        ? object.name.slice(0, -1)
        : object.name;
    const pathParts = trimmedName.split("/").filter(Boolean);

    if (pathParts.length === 0) {
      continue;
    }

    if (object.type === "folder") {
      ensureFolderNode(pathParts);
      continue;
    }

    const parentParts = pathParts.slice(0, -1);

    if (parentParts.length > 0) {
      ensureFolderNode(parentParts);
    }

    const fileName = pathParts[pathParts.length - 1];
    const parentPathKey =
      parentParts.length > 0 ? `${parentParts.join("/")}/` : "";
    const fileNode: ObjectTreeNode = {
      name: fileName,
      path: object.name,
      type: "file",
      size: object.size,
    };

    if (parentPathKey) {
      const parentFolder = folderMap.get(parentPathKey);

      if (parentFolder?.children) {
        parentFolder.children.push(fileNode);
      } else {
        rootNodes.push(fileNode);
      }
    } else {
      rootNodes.push(fileNode);
    }
  }

  const sortNodes = (nodes: ObjectTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }

      return a.type === "folder" ? -1 : 1;
    });

    for (const node of nodes) {
      if (node.children?.length) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(rootNodes);

  return rootNodes;
}
