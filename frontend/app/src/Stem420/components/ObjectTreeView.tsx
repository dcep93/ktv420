import { type ObjectTreeNode } from "../types";

type ObjectTreeViewProps = {
  isBusy: boolean;
  isListing: boolean;
  listError: string | null;
  objectTree: ObjectTreeNode[];
  totalObjects: number;
  onRefresh: () => void;
  onFolderClick: (node: ObjectTreeNode) => Promise<void> | void;
};

export default function ObjectTreeView({
  isBusy,
  isListing,
  listError,
  objectTree,
  totalObjects,
  onRefresh,
  onFolderClick,
}: ObjectTreeViewProps) {
  const renderObjects = (nodes: ObjectTreeNode[]) => (
    <ul style={{ marginTop: "0.5rem" }}>
      {nodes.map((node) => {
        const isFolder = node.type === "folder";
        const isInputFolder = isFolder && node.name === "input";

        return (
          <li key={node.path}>
            {isFolder ? (
              isInputFolder ? (
                <button
                  type="button"
                  onClick={() => void onFolderClick(node)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "blue",
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  <code>{node.name}/</code>
                </button>
              ) : (
                <code>{node.name}/</code>
              )
            ) : (
              <>
                <code>{node.name}</code> — {node.size?.toLocaleString()} bytes
              </>
            )}

            {node.children && node.children.length > 0
              ? renderObjects(node.children)
              : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div style={{ marginTop: "1rem" }}>
      <h2>GCS Bucket Contents</h2>
      <button onClick={onRefresh} disabled={isBusy || isListing}>
        {isListing ? "Refreshing..." : "Refresh List"}
      </button>
      {listError && (
        <div style={{ color: "red", marginTop: "0.5rem" }}>{listError}</div>
      )}
      {!listError && totalObjects === 0 && !isListing ? (
        <div style={{ marginTop: "0.5rem" }}>No files found in bucket.</div>
      ) : null}
      {objectTree.length > 0 ? renderObjects(objectTree) : null}
    </div>
  );
}
