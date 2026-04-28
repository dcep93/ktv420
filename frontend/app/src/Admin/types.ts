export type GcsObject = {
  name: string;
  size: number;
  type: "file" | "folder";
};

export type ObjectTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  size?: number;
  children?: ObjectTreeNode[];
};
