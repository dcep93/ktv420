import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import {
  deleteLocalOpfsEntry,
  downloadArtifactsToOpfs,
  hasLocalOutputMetadata,
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
const DELETE_LOCAL_DATABASE_ENTRY_MESSAGE = "ktv420:delete-local-database-entry";
const DELETE_TRACK_ARTIFACT_MESSAGE = "ktv420:delete-track-artifact";
const LOCAL_DATABASE_MESSAGE = "ktv420:local-database";
const TRACK_CAPTURED_MESSAGE = "ktv420:track-captured";
const PREPARE_JOB_RESULT_MESSAGE = "ktv420:prepare-job-result";
const RUN_JOB_RESULT_MESSAGE = "ktv420:run-job-result";

type IframeMessageType =
  | typeof CLOSE_OVERLAY_MESSAGE
  | typeof TOGGLE_RUN_MESSAGE
  | typeof PREPARE_JOB_MESSAGE
  | typeof RUN_JOB_MESSAGE
  | typeof REQUEST_LOCAL_DATABASE_MESSAGE
  | typeof DELETE_LOCAL_DATABASE_ENTRY_MESSAGE
  | typeof DELETE_TRACK_ARTIFACT_MESSAGE;
type OpfsState = "missing" | "hydrated" | "broken";
type MetadataRecord = Record<string, unknown>;
type ViewMode = "tracks" | "settings";

type IframeTrack = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  rowIndex: number;
  opfsState: OpfsState;
  hasLocalOutputMetadata: boolean;
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
        const nextTracks = message.tracks
          .map((track: unknown) => toIframeTrack(track))
          .filter((track: IframeTrack | null): track is IframeTrack => track !== null);
        setIsDev(nextIsDev);
        setViewMode("tracks");
        if (!nextIsDev) {
          setDatabaseSources([]);
        }
        setTracks(nextTracks);
        void refreshLocalOutputMetadata(nextTracks, setTracks);
        return;
      }

      if (message.type === TRACK_CAPTURED_MESSAGE && isRecord(message.track)) {
        setTracks((currentTracks) => updateCapturedTrack(currentTracks, message.track));
        void refreshLocalOutputMetadataForTrack(readString(message.track.trackId), setTracks);
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
        if (message.ok !== true) {
          window.alert(formatActionResult(message));
        }
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

  const loadSettingsView = useCallback(async () => {
    if (!isDev) {
      return;
    }

    setViewMode("settings");
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

  const toggleSettingsView = useCallback(() => {
    if (viewMode === "settings") {
      setViewMode("tracks");
      return;
    }

    void loadSettingsView();
  }, [loadSettingsView, viewMode]);

  const deleteDatabaseEntry = useCallback(
    async (source: LocalDatabaseSource, entry: LocalDatabaseEntry) => {
      if (source.sourceName === "Spotify content script") {
        setDatabaseSources((sources) =>
          upsertDatabaseSource(sources, { ...source, loading: true, error: undefined })
        );
        postParentMessage(DELETE_LOCAL_DATABASE_ENTRY_MESSAGE, { path: entry.path });
        return;
      }

      if (source.sourceName !== "Iframe") {
        return;
      }

      setDatabaseSources((sources) =>
        upsertDatabaseSource(sources, { ...source, loading: true, error: undefined })
      );

      try {
        await deleteLocalOpfsEntry(entry.path);
        const entries = await listLocalOpfsEntries();
        setDatabaseSources((sources) =>
          upsertDatabaseSource(sources, { sourceName: "Iframe", entries })
        );
      } catch (error) {
        setDatabaseSources((sources) =>
          upsertDatabaseSource(sources, {
            sourceName: "Iframe",
            entries: source.entries,
            error: error instanceof Error ? error.message : String(error)
          })
        );
      }
    },
    []
  );

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
      await downloadArtifactsToOpfs(track.trackId, track.metadata ?? {});
      const hasOutputMetadata = await hasLocalOutputMetadata(track.trackId);
      if (hasOutputMetadata) {
        postParentMessage(DELETE_TRACK_ARTIFACT_MESSAGE, { trackId: track.trackId });
      }
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
            className="iframe-settings-button"
            aria-label="Toggle settings view"
            aria-pressed={viewMode === "settings"}
            onClick={toggleSettingsView}
          >
            ⚙️
          </button>
        )}
      </div>
      {viewMode === "settings" ? (
        <section className="iframe-settings-view" aria-label="Settings view">
          {databaseSources.map((source) => (
            <section className="iframe-settings-source" key={source.sourceName}>
              <header className="iframe-settings-source-header">
                <h2>{source.sourceName}</h2>
                <span>{databaseSummary(source)}</span>
              </header>
              {source.error ? (
                <p className="iframe-settings-error">{source.error}</p>
              ) : source.loading ? (
                <p className="iframe-settings-empty">Loading...</p>
              ) : source.entries.length > 0 ? (
                <ol className="iframe-settings-list">
                  {source.entries.map((entry) => (
                    <li key={`${source.sourceName}-${entry.path}`}>
                      <button
                        type="button"
                        className="iframe-settings-row"
                        aria-label={`Delete ${entry.kind} ${entry.path} from ${source.sourceName}`}
                        title={databaseEntryTitle(entry)}
                        onClick={() => {
                          void deleteDatabaseEntry(source, entry);
                        }}
                      >
                        <span className="iframe-settings-kind">{entry.kind === "directory" ? "dir" : "file"}</span>
                        <span className="iframe-settings-path">{entry.path}</span>
                        <span className="iframe-settings-size">{formatBytes(entry.size)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="iframe-settings-empty">No OPFS entries.</p>
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
              <span className="iframe-track-state" aria-label={stateLabel(track)}>
                {stateGlyph(track)}
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
  const hasOutputMetadata = track.hasLocalOutputMetadata === true;

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
    hasLocalOutputMetadata: hasOutputMetadata,
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
    modifiedAt: readString(value.modifiedAt) || undefined,
    text: readString(value.text) || undefined
  };
}

function upsertDatabaseSource(sources: LocalDatabaseSource[], nextSource: LocalDatabaseSource) {
  const nextSources = sources.filter((source) => source.sourceName !== nextSource.sourceName);
  nextSources.push(nextSource);
  return nextSources.sort(compareDatabaseSources);
}

function updateCapturedTrack(currentTracks: IframeTrack[] | null, value: MetadataRecord) {
  if (!currentTracks) {
    return currentTracks;
  }

  const trackId = readString(value.trackId) || readString((value.metadata as MetadataRecord | null)?.trackId);
  if (!trackId) {
    return currentTracks;
  }

  return currentTracks.map((track) => {
    if (track.trackId !== trackId) {
      return track;
    }

    const metadata = isRecord(value.metadata) ? value.metadata : track.metadata;
    return {
      ...track,
      trackName: readString(value.trackName) || readString(metadata?.trackName) || track.trackName,
      trackArtist: readString(value.trackArtist) || readString(metadata?.trackArtist) || track.trackArtist,
      trackArtworkSrc:
        readString(value.trackArtworkSrc) ||
        readString(metadata?.trackArtworkSrc) ||
        track.trackArtworkSrc,
      opfsState: isOpfsState(value.opfsState) ? value.opfsState : track.opfsState,
      metadata,
      error: readString(value.error) || undefined
    };
  });
}

async function refreshLocalOutputMetadata(
  tracks: IframeTrack[],
  setTracks: Dispatch<SetStateAction<IframeTrack[] | null>>
) {
  const states = await Promise.all(
    tracks.map(async (track) => ({
      trackId: track.trackId,
      hasLocalOutputMetadata: await hasLocalOutputMetadata(track.trackId)
    }))
  );

  setTracks((currentTracks) => {
    if (!currentTracks) {
      return currentTracks;
    }

    const stateByTrackId = new Map(
      states.map((state) => [state.trackId, state.hasLocalOutputMetadata])
    );
    return currentTracks.map((track) => {
      const hasOutputMetadata = stateByTrackId.get(track.trackId);
      return hasOutputMetadata === undefined
        ? track
        : { ...track, hasLocalOutputMetadata: hasOutputMetadata };
    });
  });
}

async function refreshLocalOutputMetadataForTrack(
  trackId: string,
  setTracks: Dispatch<SetStateAction<IframeTrack[] | null>>
) {
  if (!trackId) {
    return;
  }

  const hasOutputMetadata = await hasLocalOutputMetadata(trackId);
  setTracks((currentTracks) =>
    markTrackLocalOutputMetadata(currentTracks, trackId, hasOutputMetadata)
  );
}

function markTrackLocalOutputMetadata(
  currentTracks: IframeTrack[] | null,
  trackId: string,
  hasOutputMetadata: boolean
) {
  if (!currentTracks) {
    return currentTracks;
  }

  return currentTracks.map((track) =>
    track.trackId === trackId
      ? { ...track, hasLocalOutputMetadata: hasOutputMetadata }
      : track
  );
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
  return entry.text;
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

function stateGlyph(track: IframeTrack) {
  if (track.hasLocalOutputMetadata) {
    return "☑";
  }

  if (track.opfsState === "hydrated") {
    return "◪";
  }

  if (track.opfsState === "broken") {
    return "☒";
  }

  return "□";
}

function stateLabel(track: IframeTrack) {
  if (track.hasLocalOutputMetadata) {
    return "Output metadata saved locally";
  }

  if (track.opfsState === "hydrated") {
    return "Fully hydrated";
  }

  if (track.opfsState === "broken") {
    return "Broken OPFS artifact";
  }

  return "Missing from OPFS";
}
