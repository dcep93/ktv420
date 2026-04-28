import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Player from "./Admin/components/Player";
import { formatErrorMessage } from "./Admin/errors";
import { fetchObjectBlob, listBucketObjects } from "./Admin/gcsClient";
import {
  type CachedOutputRecord,
  cacheMd5Files,
  getCachedMd5,
} from "./Admin/indexedDbClient";
import { buildObjectTree } from "./Admin/objectTree";
import { type GcsObject, type ObjectTreeNode } from "./Admin/types";
import { collectFileNodes, extractMd5FromPath } from "./Admin/utils";
import "./Sample.css";

type InputOption = {
  value: string;
  label: string;
  md5: string;
};

const buildInputHash = (label: string) => `#${encodeURIComponent(label)}`;

const parseInputHash = (hash: string): string | null => {
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

export default function Sample() {
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
  const rootPageRef = useRef<HTMLElement | null>(null);

  const resetStatus = () => setStatus(null);

  useEffect(() => {
    const focusRoot = () => {
      if (rootPageRef.current) {
        rootPageRef.current.focus({ preventScroll: true });
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const isInteractiveTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        target?.isContentEditable;

      if (!isInteractiveTarget) {
        focusRoot();
      }
    };

    focusRoot();
    window.addEventListener("focus", focusRoot);
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.removeEventListener("focus", focusRoot);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  const refreshObjectTree = useCallback(
    async (statusMessage: string | null = null) => {
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
    },
    []
  );

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

  const loadSelection = useCallback(
    async (selectedOption: InputOption) => {
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
    },
    [objectTree]
  );

  const handleSelection = useCallback(
    async (value: string, { updateHash } = { updateHash: true }) => {
      setSelectedInput(value);
      setActiveRecord(null);
      setError(null);

      if (!value) {
        if (updateHash) {
          window.location.hash = "";
        }

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

      if (updateHash) {
        window.location.hash = buildInputHash(selectedOption.label);
      }

      await loadSelection(selectedOption);
    },
    [inputOptions, loadSelection]
  );

  useEffect(() => {
    const applyHashSelection = (hashValue: string) => {
      const decodedLabel = parseInputHash(hashValue);

      if (!decodedLabel) {
        if (selectedInput) {
          void handleSelection("", { updateHash: false });
        }

        return;
      }

      const matchingOption = inputOptions.find(
        (option) => option.label.toLowerCase() === decodedLabel.toLowerCase()
      );

      if (!matchingOption || matchingOption.value === selectedInput) {
        return;
      }

      void handleSelection(matchingOption.value, { updateHash: false });
    };

    const handleHashChange = () => {
      applyHashSelection(window.location.hash);
    };

    applyHashSelection(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [handleSelection, inputOptions, selectedInput]);

  const handleRefresh = async () => {
    await refreshObjectTree("Refreshing bucket contents...");
  };

  return (
    <main
      className="root-page"
      ref={rootPageRef}
      tabIndex={-1}
      aria-label="Sample page"
    >
      {activeRecord ? (
        <section className="root-page__player">
          <Player record={activeRecord} onClose={() => setActiveRecord(null)} />
        </section>
      ) : null}

      <section className="root-page__panel">
        <div className="root-page__status-row">
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
          <div className="root-page__actions">
            <button
              onClick={handleRefresh}
              disabled={isLoading || isFetchingSelection}
            >
              Refresh inputs
            </button>
          </div>
        </div>
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
      </section>
    </main>
  );
}
