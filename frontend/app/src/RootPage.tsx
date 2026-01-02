import { useCallback, useEffect, useMemo, useState } from "react";

import "./RootPage.css";
import Player from "./Stem420/components/Player";
import { formatErrorMessage } from "./Stem420/errors";
import { fetchObjectBlob, listBucketObjects } from "./Stem420/gcsClient";
import {
  type CachedOutputRecord,
  cacheMd5Files,
  getCachedMd5,
} from "./Stem420/indexedDbClient";
import { buildObjectTree } from "./Stem420/objectTree";
import { type GcsObject, type ObjectTreeNode } from "./Stem420/types";
import { collectFileNodes, extractMd5FromPath } from "./Stem420/utils";

type InputOption = {
  value: string;
  label: string;
  md5: string;
};

const findMd5Node = (
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

export default function RootPage() {
  const [objects, setObjects] = useState<GcsObject[]>([]);
  const [objectTree, setObjectTree] = useState<ObjectTreeNode[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [activeRecord, setActiveRecord] = useState<CachedOutputRecord | null>(
    null
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingSelection, setIsFetchingSelection] = useState(false);

  const resetStatus = () => setStatus(null);

  const refreshObjectTree = useCallback(async (statusMessage: string | null = null) => {
    setIsLoading(true);
    setError(null);
    setStatus(statusMessage);

    try {
      const listedObjects = await listBucketObjects();
      setObjects(listedObjects);
      setObjectTree(buildObjectTree(listedObjects));
    } catch (loadError) {
      const formattedMessage = formatErrorMessage(
        "listBucketObjects",
        loadError
      );
      console.error(formattedMessage, loadError);
      setError(formattedMessage);
    } finally {
      setIsLoading(false);
      resetStatus();
    }
  }, []);

  useEffect(() => {
    void refreshObjectTree("Checking bucket contents...");
  }, [refreshObjectTree]);

  const inputOptions = useMemo<InputOption[]>(() => {
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
  }, [objects]);

  const handleSelection = async (value: string) => {
    setSelectedInput(value);
    setActiveRecord(null);
    setError(null);

    if (!value) {
      resetStatus();
      return;
    }

    const selectedOption = inputOptions.find(
      (option) => option.value === value
    );

    if (!selectedOption) {
      setError("Unable to find the selected input.");
      return;
    }

    await loadSelection(selectedOption);
  };

  const loadSelection = async (selectedOption: InputOption) => {
    const md5Node = findMd5Node(objectTree, selectedOption.md5);

    if (!md5Node) {
      setError("No related files were found for this input.");
      return;
    }

    setIsFetchingSelection(true);
    setStatus("Loading files...");

    try {
      const cachedRecord = await getCachedMd5(selectedOption.md5);

      if (cachedRecord) {
        setStatus("Loaded cached files.");
        setActiveRecord(cachedRecord);
        return;
      }

      const fileNodes = collectFileNodes(md5Node);

      if (!fileNodes.length) {
        throw new Error("No files were found for the selected input.");
      }

      setStatus("Downloading files from GCS and caching them...");

      const files = await Promise.all(
        fileNodes.map(async (node) => ({
          name: node.name,
          path: node.path,
          blob: await fetchObjectBlob(node.path),
        }))
      );

      await cacheMd5Files(selectedOption.md5, files);
      setActiveRecord({ md5: selectedOption.md5, files });
      setStatus(`Fetched ${files.length} file(s) for playback.`);
    } catch (selectionError) {
      const formattedMessage = formatErrorMessage(
        "handleSelection",
        selectionError
      );
      console.error(formattedMessage, selectionError);
      setError(formattedMessage);
    } finally {
      setIsFetchingSelection(false);
    }
  };

  const handleRefresh = async () => {
    await refreshObjectTree("Refreshing bucket contents...");
  };

  return (
    <main className="root-page">
      <header className="root-page__header">
        <div>
          <h1>Stem420 Player</h1>
        </div>
        <div className="root-page__actions">
          <button
            onClick={handleRefresh}
            disabled={isLoading || isFetchingSelection}
          >
            Refresh inputs
          </button>
        </div>
      </header>

      <section className="root-page__panel">
        <div className="root-page__control-group">
          <label htmlFor="input-selector">Choose an input file</label>
          <select
            id="input-selector"
            value={selectedInput}
            onChange={(event) => void handleSelection(event.target.value)}
            disabled={
              isLoading || isFetchingSelection || inputOptions.length === 0
            }
          >
            <option value="">Select an input...</option>
            {inputOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="root-page__status-area">
          {isLoading ? (
            <p className="muted">Checking GCS for files...</p>
          ) : null}
          {!isLoading && inputOptions.length === 0 ? (
            <p className="muted">No inputs were found in the bucket.</p>
          ) : null}
          {status ? <p>{status}</p> : null}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </section>

      {activeRecord ? (
        <section className="root-page__player">
          <Player record={activeRecord} onClose={() => setActiveRecord(null)} />
        </section>
      ) : null}
    </main>
  );
}
