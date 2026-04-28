import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatErrorMessage } from "../../stems/lib/errors";
import { buildObjectTree } from "../../stems/lib/objectTree";
import { type GcsObject, type ObjectTreeNode } from "../../stems/lib/types";
import { cacheFilesForNode } from "../../stems/services/cacheRecords";
import { listBucketObjects } from "../../stems/services/gcsClient";
import {
  type CachedOutputRecord,
  getCachedMd5,
} from "../../stems/services/indexedDbClient";
import {
  buildInputHash,
  buildInputOptions,
  findMd5Node,
  parseInputHash,
  type InputOption,
} from "../lib/inputOptions";
import { useFocusablePage } from "./useFocusablePage";

export function useSampleController() {
  const [objects, setObjects] = useState<GcsObject[]>([]);
  const [objectTree, setObjectTree] = useState<ObjectTreeNode[]>([]);
  const [selectedInput, setSelectedInput] = useState("");
  const [activeRecord, setActiveRecord] = useState<CachedOutputRecord | null>(
    null
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingSelection, setIsFetchingSelection] = useState(false);
  const pageRef = useRef<HTMLElement | null>(null);

  useFocusablePage(pageRef);

  const resetStatus = useCallback(() => setStatus(null), []);

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
    [resetStatus]
  );

  useEffect(() => {
    void refreshObjectTree("Checking bucket contents...");
  }, [refreshObjectTree]);

  const inputOptions = useMemo<InputOption[]>(
    () => buildInputOptions(objects),
    [objects]
  );

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

        setStatus("Downloading files from GCS and caching them...");
        const newRecord = await cacheFilesForNode(selectedOption.md5, md5Node);

        setActiveRecord(newRecord);
        setStatus(`Fetched ${newRecord.files.length} file(s) for playback.`);
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
    [inputOptions, loadSelection, resetStatus]
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

  return {
    activeRecord,
    clearActiveRecord: () => setActiveRecord(null),
    error,
    handleRefresh,
    handleSelection,
    inputOptions,
    isFetchingSelection,
    isLoading,
    pageRef,
    selectedInput,
    status,
  };
}
