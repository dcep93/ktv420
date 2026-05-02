import { useCallback, useEffect, useState } from "react";

import {
  deleteLocalOpfsEntry,
  listLocalOpfsEntries,
  type LocalDatabaseEntry
} from "./iframeArtifacts";

export default function SettingsPage() {
  const [entries, setEntries] = useState<LocalDatabaseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      setEntries(await listLocalOpfsEntries());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const deleteEntry = async (entry: LocalDatabaseEntry) => {
    setError("");

    try {
      await deleteLocalOpfsEntry(entry.path);
      await loadEntries();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  return (
    <main className="standalone-page" aria-label="ktv420 settings">
      <header className="standalone-header">
        <h1>Settings</h1>
        <button type="button" onClick={loadEntries} disabled={loading}>
          Refresh
        </button>
      </header>
      {error ? <p className="settings-error">{error}</p> : null}
      {loading ? (
        <p className="settings-empty">Loading...</p>
      ) : entries.length > 0 ? (
        <ol className="settings-list">
          {entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="settings-row"
                aria-label={`Delete ${entry.kind} ${entry.path}`}
                title={entry.text}
                onClick={() => {
                  void deleteEntry(entry);
                }}
              >
                <span className="settings-kind">{entry.kind === "directory" ? "dir" : "file"}</span>
                <span className="settings-path">{entry.path}</span>
                <span className="settings-size">{formatBytes(entry.size)}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="settings-empty">No OPFS entries.</p>
      )}
    </main>
  );
}

function formatBytes(value: number | undefined) {
  if (value === undefined) {
    return "";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  for (const unit of units) {
    if (size < 1024 || unit === units[units.length - 1]) {
      return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
    }

    size /= 1024;
  }

  return `${value} B`;
}
