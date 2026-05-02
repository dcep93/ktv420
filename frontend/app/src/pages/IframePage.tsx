import { useCallback, useEffect, useState } from "react";

import {
  downloadArtifactsToOpfs,
  listLocalOpfsEntries,
  type LocalDatabaseEntry
} from "./iframeArtifacts";

const IFRAME_MESSAGE_SOURCE = "ktv420-iframe";
const PARENT_MESSAGE_SOURCE = "ktv420-parent";
const CLOSE_OVERLAY_MESSAGE = "ktv420:close-overlay";
const TRACKS_MESSAGE = "ktv420:tracks";
const TOGGLE_RUN_MESSAGE = "ktv420:toggle-run";
const PREPARE_JOB_MESSAGE = "ktv420:prepare-job";
const RUN_JOB_MESSAGE = "ktv420:run-job";
const REQUEST_LOCAL_DATABASE_MESSAGE = "ktv420:request-local-database";
const LOCAL_DATABASE_MESSAGE = "ktv420:local-database";
const PREPARE_JOB_RESULT_MESSAGE = "ktv420:prepare-job-result";
const RUN_JOB_RESULT_MESSAGE = "ktv420:run-job-result";

type IframeMessageType =
  | typeof CLOSE_OVERLAY_MESSAGE
  | typeof TOGGLE_RUN_MESSAGE
  | typeof PREPARE_JOB_MESSAGE
  | typeof RUN_JOB_MESSAGE
  | typeof REQUEST_LOCAL_DATABASE_MESSAGE;
type OpfsState = "missing" | "hydrated" | "broken";
type MetadataRecord = Record<string, unknown>;
type ViewMode = "tracks" | "database";

type IframeTrack = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  rowIndex: number;
  opfsState: OpfsState;
  metadata: MetadataRecord | null;
  error?: string;
};

type LocalDatabaseSource = {
  sourceName: string;
  entries: LocalDatabaseEntry[];
  error?: string;
  loading?: boolean;
};

function getParentOrigin() {
  if (!document.referrer) {
    return "*";
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return "*";
  }
}

function postParentMessage(type: IframeMessageType, payload: MetadataRecord = {}) {
  window.parent.postMessage({ source: IFRAME_MESSAGE_SOURCE, type, ...payload }, getParentOrigin());
}

export default function IframePage() {
  const [tracks, setTracks] = useState<IframeTrack[] | null>(null);
  const [isDev, setIsDev] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("tracks");
  const [databaseSources, setDatabaseSources] = useState<LocalDatabaseSource[]>([]);
  const isReady = tracks !== null;

  useEffect(() => {
    const parentOrigin = getParentOrigin();
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) {
        return;
      }

      if (parentOrigin !== "*" && event.origin !== parentOrigin) {
        return;
      }

      const message = event.data;
      if (!message || message.source !== PARENT_MESSAGE_SOURCE) {
        return;
      }

      if (message.type === TRACKS_MESSAGE && Array.isArray(message.tracks)) {
        const nextIsDev = message.isDev === true;
        setIsDev(nextIsDev);
        setViewMode("tracks");
        if (!nextIsDev) {
          setDatabaseSources([]);
        }
        setTracks(
          message.tracks
            .map((track: unknown) => toIframeTrack(track))
            .filter((track: IframeTrack | null): track is IframeTrack => track !== null)
        );
        return;
      }

      if (message.type === LOCAL_DATABASE_MESSAGE) {
        const source = toLocalDatabaseSource(message);
        if (source) {
          setDatabaseSources((sources) => upsertDatabaseSource(sources, source));
        }
        return;
      }

      if (message.type === PREPARE_JOB_RESULT_MESSAGE || message.type === RUN_JOB_RESULT_MESSAGE) {
        window.alert(formatActionResult(message));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const close = useCallback(() => {
    setTracks(null);
    setViewMode("tracks");
    setDatabaseSources([]);
    postParentMessage(CLOSE_OVERLAY_MESSAGE);
  }, []);

  const toggleRun = useCallback(() => {
    if (!isReady) {
      return;
    }

    postParentMessage(TOGGLE_RUN_MESSAGE);
  }, [isReady]);

  const loadLocalDatabase = useCallback(async () => {
    if (!isDev) {
      return;
    }

    setViewMode("database");
    setDatabaseSources([
      { sourceName: "Spotify content script", entries: [], loading: true },
      { sourceName: "Iframe", entries: [], loading: true }
    ]);
    postParentMessage(REQUEST_LOCAL_DATABASE_MESSAGE);

    try {
      const entries = await listLocalOpfsEntries();
      setDatabaseSources((sources) =>
        upsertDatabaseSource(sources, { sourceName: "Iframe", entries })
      );
    } catch (error) {
      setDatabaseSources((sources) =>
        upsertDatabaseSource(sources, {
          sourceName: "Iframe",
          entries: [],
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }, [isDev]);

  const toggleDatabaseView = useCallback(() => {
    if (viewMode === "database") {
      setViewMode("tracks");
      return;
    }

    void loadLocalDatabase();
  }, [loadLocalDatabase, viewMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key === "Enter" && isReady) {
        event.preventDefault();
        toggleRun();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, isReady, toggleRun]);

  const prepareTrack = (track: IframeTrack) => {
    postParentMessage(PREPARE_JOB_MESSAGE, { trackId: track.trackId });
  };

  const runTrack = (track: IframeTrack) => {
    postParentMessage(RUN_JOB_MESSAGE, { trackId: track.trackId });
  };

  const downloadTrack = async (track: IframeTrack) => {
    try {
      const result = await downloadArtifactsToOpfs(track.trackId, track.metadata ?? {});
      window.alert(
        `Downloaded ${result.fileCount} file(s) to OPFS (${result.inputFileCount} input, ${result.outputFileCount} output). Deleted ${result.deletedCount} GCS object(s).`
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="iframe-page" aria-label="ktv420 iframe controls">
      <div className="iframe-actions">
        <button
          type="button"
          className="iframe-close-button"
          aria-label="Close"
          onClick={close}
        >
          ❌
        </button>
        <button
          type="button"
          className="iframe-logo-button"
          aria-label="Toggle ktv420 capture run"
          aria-disabled={!isReady}
          disabled={!isReady}
          onClick={toggleRun}
        >
          <img alt="" src="/favicon.svg" />
        </button>
        {isDev && (
          <button
            type="button"
            className="iframe-database-button"
            aria-label="Toggle local database view"
            aria-pressed={viewMode === "database"}
            onClick={toggleDatabaseView}
          >
            📊
          </button>
        )}
      </div>
      {viewMode === "database" ? (
        <section className="iframe-database-view" aria-label="Local database view">
          {databaseSources.map((source) => (
            <section className="iframe-database-source" key={source.sourceName}>
              <header className="iframe-database-source-header">
                <h2>{source.sourceName}</h2>
                <span>{databaseSummary(source)}</span>
              </header>
              {source.error ? (
                <p className="iframe-database-error">{source.error}</p>
              ) : source.loading ? (
                <p className="iframe-database-empty">Loading...</p>
              ) : source.entries.length > 0 ? (
                <ol className="iframe-database-list">
                  {source.entries.map((entry) => (
                    <li
                      className="iframe-database-row"
                      key={`${source.sourceName}-${entry.path}`}
                      title={databaseEntryTitle(entry)}
                    >
                      <span className="iframe-database-kind">{entry.kind === "directory" ? "dir" : "file"}</span>
                      <span className="iframe-database-path">{entry.path}</span>
                      <span className="iframe-database-size">{formatBytes(entry.size)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="iframe-database-empty">No OPFS entries.</p>
              )}
            </section>
          ))}
        </section>
      ) : tracks ? (
        <ol className="iframe-track-list" aria-label="Spotify page tracks">
          {tracks.map((track) => (
            <li
              key={`${track.trackId}-${track.rowIndex}`}
              className="iframe-track-row"
              title={metadataTooltip(track.metadata)}
            >
              <span className="iframe-track-state" aria-label={stateLabel(track.opfsState)}>
                {stateGlyph(track.opfsState)}
              </span>
              {track.trackArtworkSrc && (
                <img className="iframe-track-artwork" alt="" src={track.trackArtworkSrc} />
              )}
              <span className="iframe-track-copy">
                <span className="iframe-track-name">{track.trackName}</span>
                <span className="iframe-track-artist">{track.trackArtist}</span>
              </span>
              <span className="iframe-track-actions">
                <button
                  type="button"
                  disabled={track.opfsState !== "hydrated"}
                  onClick={() => prepareTrack(track)}
                >
                  Prepare
                </button>
                <button
                  type="button"
                  disabled={track.opfsState !== "hydrated"}
                  onClick={() => runTrack(track)}
                >
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void downloadTrack(track);
                  }}
                >
                  Download
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </main>
  );
}

function toIframeTrack(value: unknown): IframeTrack | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const track = value as Record<string, unknown>;
  const metadata = isRecord(track.metadata) ? track.metadata : null;
  const trackId = readString(track.trackId) || readString(metadata?.trackId);
  const trackName = readString(track.trackName) || readString(metadata?.trackName);
  const trackArtist = readString(track.trackArtist) || readString(metadata?.trackArtist);
  const trackArtworkSrc = readString(track.trackArtworkSrc) || readString(metadata?.trackArtworkSrc);
  const rowIndex = typeof track.rowIndex === "number" ? track.rowIndex : null;
  const opfsState = isOpfsState(track.opfsState) ? track.opfsState : null;

  if (!trackId || !trackName || rowIndex === null || !opfsState) {
    return null;
  }

  return {
    trackId,
    trackName,
    trackArtist,
    trackArtworkSrc,
    rowIndex,
    opfsState,
    metadata,
    error: readString(track.error) || undefined
  };
}

function toLocalDatabaseSource(value: unknown): LocalDatabaseSource | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceName = readString(value.sourceName);
  if (!sourceName || !Array.isArray(value.entries)) {
    return null;
  }

  return {
    sourceName,
    entries: value.entries
      .map((entry: unknown) => toLocalDatabaseEntry(entry))
      .filter((entry: LocalDatabaseEntry | null): entry is LocalDatabaseEntry => entry !== null),
    error: readString(value.error) || undefined
  };
}

function toLocalDatabaseEntry(value: unknown): LocalDatabaseEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const path = readString(value.path);
  const kind = value.kind === "directory" || value.kind === "file" ? value.kind : null;
  if (!path || !kind) {
    return null;
  }

  return {
    path,
    kind,
    size: typeof value.size === "number" && Number.isFinite(value.size) ? value.size : undefined,
    modifiedAt: readString(value.modifiedAt) || undefined
  };
}

function upsertDatabaseSource(sources: LocalDatabaseSource[], nextSource: LocalDatabaseSource) {
  const nextSources = sources.filter((source) => source.sourceName !== nextSource.sourceName);
  nextSources.push(nextSource);
  return nextSources.sort(compareDatabaseSources);
}

function metadataTooltip(metadata: MetadataRecord | null) {
  return metadata ? JSON.stringify(metadata, null, 2) : undefined;
}

function formatActionResult(message: MetadataRecord) {
  if (message.ok === true) {
    return JSON.stringify(message.result ?? null, null, 2);
  }

  return readString(message.error) || "Action failed";
}

function databaseSummary(source: LocalDatabaseSource) {
  if (source.loading) {
    return "Loading";
  }

  if (source.error) {
    return "Error";
  }

  const fileCount = source.entries.filter((entry) => entry.kind === "file").length;
  const directoryCount = source.entries.length - fileCount;
  const totalBytes = source.entries.reduce((total, entry) => total + (entry.size ?? 0), 0);

  return `${fileCount} file(s), ${directoryCount} dir(s), ${formatBytes(totalBytes)}`;
}

function databaseEntryTitle(entry: LocalDatabaseEntry) {
  const details = [entry.path];
  if (entry.modifiedAt) {
    details.push(`Modified ${formatTimestamp(entry.modifiedAt)}`);
  }

  return details.join("\n");
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
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

function compareDatabaseSources(a: LocalDatabaseSource, b: LocalDatabaseSource) {
  return databaseSourceOrder(a.sourceName) - databaseSourceOrder(b.sourceName);
}

function databaseSourceOrder(sourceName: string) {
  if (sourceName === "Spotify content script") {
    return 0;
  }

  if (sourceName === "Iframe") {
    return 1;
  }

  return 2;
}

function isRecord(value: unknown): value is MetadataRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isOpfsState(value: unknown): value is OpfsState {
  return value === "missing" || value === "hydrated" || value === "broken";
}

function stateGlyph(state: OpfsState) {
  if (state === "hydrated") {
    return "◪";
  }

  if (state === "broken") {
    return "☒";
  }

  return "□";
}

function stateLabel(state: OpfsState) {
  if (state === "hydrated") {
    return "Fully hydrated";
  }

  if (state === "broken") {
    return "Broken OPFS artifact";
  }

  return "Missing from OPFS";
}
