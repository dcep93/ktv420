import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  buildStemRunRequest,
  deleteLocalOpfsEntry,
  downloadArtifactsToOpfs,
  findPreparedInputMp3,
  hasLocalOutputMetadata,
  hasRemoteOutputMetadata,
  listLocalOpfsEntries,
  requestUnpartitionedOpfsAccess,
  saveSpotifyContext,
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
const CAPTURE_COMPLETE_MESSAGE = "ktv420:capture-complete";
const PREPARE_JOB_RESULT_MESSAGE = "ktv420:prepare-job-result";
const RUN_JOB_RESULT_MESSAGE = "ktv420:run-job-result";
const POLL_INTERVAL_MS = 1000;
const IFRAME_DATABASE_SOURCE_NAME = "Iframe";
const SPOTIFY_DATABASE_SOURCE_NAME = "Spotify content script";

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
type JobResultMessageType = typeof PREPARE_JOB_RESULT_MESSAGE | typeof RUN_JOB_RESULT_MESSAGE;

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

type QueueItem = {
  trackId: string;
  metadata: MetadataRecord;
};

type PendingAction = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
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
  const pendingActionsRef = useRef(new Map<string, PendingAction>());
  const toggleRunRef = useRef<() => void>(() => {});
  const handleCapturedTrackMessageRef = useRef<(value: MetadataRecord) => void>(() => {});
  const enqueueCapturedTrackRef = useRef<(value: MetadataRecord) => void>(() => {});
  const setExpectedQueueTrackIdsRef = useRef<(trackIds: string[]) => void>(() => {});
  const queueRef = useRef<QueueItem[]>([]);
  const knownQueueIdsRef = useRef(new Set<string>());
  const completedQueueIdsRef = useRef(new Set<string>());
  const expectedCaptureIdsRef = useRef<Set<string> | null>(null);
  const processingQueueRef = useRef(false);
  const queueFailedRef = useRef(false);
  const successAlertedRef = useRef(false);
  const deleteRefreshWaitersRef = useRef(new Map<string, () => void>());
  const tracksRef = useRef<IframeTrack[] | null>(null);
  const spotifyPathRef = useRef("");
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
        const nextSpotifyPath = readString(message.spotifyPath);
        setIsDev(nextIsDev);
        setViewMode("tracks");
        if (!nextIsDev) {
          setDatabaseSources([]);
        }
        spotifyPathRef.current = nextSpotifyPath;
        tracksRef.current = nextTracks;
        setTracks(nextTracks);
        void refreshLocalOutputMetadata(nextTracks, setTracks);
        return;
      }

      if (message.type === TRACK_CAPTURED_MESSAGE && isRecord(message.track)) {
        handleCapturedTrackMessageRef.current(message.track);
        enqueueCapturedTrackRef.current(message.track);
        return;
      }

      if (message.type === CAPTURE_COMPLETE_MESSAGE && Array.isArray(message.trackIds)) {
        const trackIds = message.trackIds
          .map((trackId: unknown) => readString(trackId))
          .filter(Boolean);
        setExpectedQueueTrackIdsRef.current(trackIds);
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
        const handled = settleActionResult(message.type, message);
        if (handled) {
          return;
        }

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
    tracksRef.current = null;
    spotifyPathRef.current = "";
    setViewMode("tracks");
    setDatabaseSources([]);
    postParentMessage(CLOSE_OVERLAY_MESSAGE);
  }, []);

  async function toggleRun() {
    if (!isReady) {
      return;
    }

    try {
      await requestUnpartitionedOpfsAccess();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      return;
    }

    resetQueueState();
    const currentTracks = tracksRef.current ?? [];
    const outputStates = await Promise.all(
      currentTracks.map(async (track) => ({
        trackId: track.trackId,
        hasLocalOutputMetadata: await hasLocalOutputMetadata(track.trackId)
      }))
    );
    const outputStateByTrackId = new Map(
      outputStates.map((state) => [state.trackId, state.hasLocalOutputMetadata])
    );
    const nextTracks = currentTracks.map((track) => ({
      ...track,
      hasLocalOutputMetadata: outputStateByTrackId.get(track.trackId) ?? track.hasLocalOutputMetadata
    }));
    const queueableTracks = nextTracks.filter(
      (track) => !track.hasLocalOutputMetadata && track.opfsState === "hydrated" && track.metadata
    );
    const tracksNeedingPcmCapture = nextTracks.filter(
      (track) => !track.hasLocalOutputMetadata && !queueableTracks.includes(track)
    );

    tracksRef.current = nextTracks;
    setTracks(nextTracks);

    if (nextTracks.length > 0 && tracksNeedingPcmCapture.length === 0) {
      expectedCaptureIdsRef.current = new Set(nextTracks.map((track) => track.trackId));
      for (const track of nextTracks) {
        if (track.hasLocalOutputMetadata) {
          completedQueueIdsRef.current.add(track.trackId);
          continue;
        }

        knownQueueIdsRef.current.add(track.trackId);
        queueRef.current.push({ trackId: track.trackId, metadata: track.metadata as MetadataRecord });
      }

      void processQueue();
      maybeAlertCaptureSuccess();
      return;
    }

    postParentMessage(TOGGLE_RUN_MESSAGE);
  }

  toggleRunRef.current = () => {
    void toggleRun();
  };

  const loadIframeDatabaseSource = useCallback(async () => {
    try {
      const entries = await listLocalOpfsEntries();
      setDatabaseSources((sources) =>
        upsertDatabaseSource(sources, {
          sourceName: IFRAME_DATABASE_SOURCE_NAME,
          entries
        })
      );
    } catch (error) {
      setDatabaseSources((sources) =>
        upsertDatabaseSource(sources, {
          sourceName: IFRAME_DATABASE_SOURCE_NAME,
          entries: [],
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }, []);

  const loadSettingsView = useCallback(async () => {
    if (!isDev) {
      return;
    }

    setViewMode("settings");
    setDatabaseSources([
      { sourceName: SPOTIFY_DATABASE_SOURCE_NAME, entries: [], loading: true },
      { sourceName: IFRAME_DATABASE_SOURCE_NAME, entries: [], loading: true }
    ]);
    postParentMessage(REQUEST_LOCAL_DATABASE_MESSAGE);
    try {
      await requestUnpartitionedOpfsAccess();
      await loadIframeDatabaseSource();
      void refreshLocalOutputMetadata(tracksRef.current ?? [], setTracks);
    } catch (error) {
      setDatabaseSources((sources) =>
        upsertDatabaseSource(sources, {
          sourceName: IFRAME_DATABASE_SOURCE_NAME,
          entries: [],
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }, [isDev, loadIframeDatabaseSource]);

  const toggleSettingsView = useCallback(() => {
    if (viewMode === "settings") {
      setViewMode("tracks");
      return;
    }

    void loadSettingsView();
  }, [loadSettingsView, viewMode]);

  const deleteDatabaseEntry = useCallback(
    async (source: LocalDatabaseSource, entry: LocalDatabaseEntry) => {
      if (source.sourceName === SPOTIFY_DATABASE_SOURCE_NAME) {
        setDatabaseSources((sources) =>
          upsertDatabaseSource(sources, { ...source, loading: true, error: undefined })
        );
        postParentMessage(DELETE_LOCAL_DATABASE_ENTRY_MESSAGE, { path: entry.path });
        return;
      }

      if (source.sourceName !== IFRAME_DATABASE_SOURCE_NAME) {
        return;
      }

      setDatabaseSources((sources) =>
        upsertDatabaseSource(sources, { ...source, loading: true, error: undefined })
      );

      try {
        await deleteLocalOpfsEntry(entry.path);
        await loadIframeDatabaseSource();
      } catch (error) {
        setDatabaseSources((sources) =>
          upsertDatabaseSource(sources, {
            sourceName: IFRAME_DATABASE_SOURCE_NAME,
            entries: [],
            error: error instanceof Error ? error.message : String(error)
          })
        );
      }
    },
    [loadIframeDatabaseSource]
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

      if (event.key === "Enter") {
        event.preventDefault();
        toggleRunRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  function resetQueueState() {
    queueRef.current = [];
    knownQueueIdsRef.current.clear();
    completedQueueIdsRef.current.clear();
    expectedCaptureIdsRef.current = null;
    processingQueueRef.current = false;
    queueFailedRef.current = false;
    successAlertedRef.current = false;
    for (const pending of pendingActionsRef.current.values()) {
      pending.reject(new Error("Capture queue reset."));
    }
    pendingActionsRef.current.clear();
    for (const resolve of deleteRefreshWaitersRef.current.values()) {
      resolve();
    }
    deleteRefreshWaitersRef.current.clear();
  }

  async function handleCapturedTrackMessage(value: MetadataRecord) {
    const trackId = readString(value.trackId) || readString((value.metadata as MetadataRecord | null)?.trackId);
    setTracks((currentTracks) => updateCapturedTrack(currentTracks, value));
    await refreshLocalOutputMetadataForTrack(trackId, setTracks);
    settleDeleteRefresh(trackId);
  }

  handleCapturedTrackMessageRef.current = (value: MetadataRecord) => {
    void handleCapturedTrackMessage(value);
  };

  async function enqueueCapturedTrack(value: MetadataRecord) {
    const trackId = readString(value.trackId) || readString((value.metadata as MetadataRecord | null)?.trackId);
    const metadata = isRecord(value.metadata) ? value.metadata : null;

    if (!trackId || value.opfsState !== "hydrated" || !metadata) {
      return;
    }

    if (await hasLocalOutputMetadata(trackId)) {
      completedQueueIdsRef.current.add(trackId);
      maybeAlertCaptureSuccess();
      return;
    }

    if (knownQueueIdsRef.current.has(trackId) || completedQueueIdsRef.current.has(trackId)) {
      return;
    }

    knownQueueIdsRef.current.add(trackId);
    queueRef.current.push({ trackId, metadata });
    void processQueue();
  }

  enqueueCapturedTrackRef.current = (value: MetadataRecord) => {
    void enqueueCapturedTrack(value);
  };

  async function setExpectedQueueTrackIds(trackIds: string[]) {
    const expectedTrackIds = new Set<string>();

    for (const trackId of trackIds) {
      if (await hasLocalOutputMetadata(trackId)) {
        completedQueueIdsRef.current.add(trackId);
      } else {
        expectedTrackIds.add(trackId);
      }
    }

    expectedCaptureIdsRef.current = expectedTrackIds;
    maybeAlertCaptureSuccess();
  }

  setExpectedQueueTrackIdsRef.current = (trackIds: string[]) => {
    void setExpectedQueueTrackIds(trackIds);
  };

  async function processQueue() {
    if (processingQueueRef.current || queueFailedRef.current) {
      return;
    }

    const item = queueRef.current.shift();
    if (!item) {
      maybeAlertCaptureSuccess();
      return;
    }

    processingQueueRef.current = true;

    try {
      let inputMp3 = await findPreparedInputMp3(item.trackId);
      if (!inputMp3) {
        await sendAction(PREPARE_JOB_MESSAGE, PREPARE_JOB_RESULT_MESSAGE, item.trackId);
        inputMp3 = await pollEvery(() => findPreparedInputMp3(item.trackId), POLL_INTERVAL_MS);
      }

      const runRequest = buildStemRunRequest(item.trackId, inputMp3);
      const remoteHasOutputMetadata = await hasRemoteOutputMetadata(item.trackId);
      if (!remoteHasOutputMetadata) {
        await sendAction(RUN_JOB_MESSAGE, RUN_JOB_RESULT_MESSAGE, item.trackId, {
          request: runRequest
        });
        await pollEvery(
          async () => ((await hasRemoteOutputMetadata(item.trackId)) ? true : null),
          POLL_INTERVAL_MS
        );
      }

      const localHasOutputMetadata = await downloadTrackArtifacts(item.trackId, item.metadata);
      if (!localHasOutputMetadata) {
        throw new Error(`Downloaded artifacts for ${item.trackId} did not include output/_metadata.json.`);
      }
      completedQueueIdsRef.current.add(item.trackId);
    } catch (error) {
      queueFailedRef.current = true;
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      processingQueueRef.current = false;
    }

    if (!queueFailedRef.current) {
      void processQueue();
    }
  }

  async function downloadTrackArtifacts(trackId: string, metadata: MetadataRecord) {
    await downloadArtifactsToOpfs(trackId, metadata);
    const hasOutputMetadata = await hasLocalOutputMetadata(trackId);
    if (hasOutputMetadata) {
      const deleteRefreshPromise = waitForDeleteRefresh(trackId);
      postParentMessage(DELETE_TRACK_ARTIFACT_MESSAGE, { trackId });
      await deleteRefreshPromise;
    }
    return hasOutputMetadata;
  }

  function sendAction(
    type: typeof PREPARE_JOB_MESSAGE | typeof RUN_JOB_MESSAGE,
    resultType: JobResultMessageType,
    trackId: string,
    payload: MetadataRecord = {}
  ) {
    const key = actionKey(resultType, trackId);
    if (pendingActionsRef.current.has(key)) {
      return Promise.reject(new Error(`Already waiting for ${resultType} on ${trackId}.`));
    }

    const promise = new Promise<unknown>((resolve, reject) => {
      pendingActionsRef.current.set(key, { resolve, reject });
    });

    postParentMessage(type, { trackId, ...payload });
    return promise;
  }

  function settleActionResult(type: JobResultMessageType, message: MetadataRecord) {
    const trackId = readString(message.trackId);
    if (!trackId) {
      return false;
    }

    const key = actionKey(type, trackId);
    const pending = pendingActionsRef.current.get(key);
    if (!pending) {
      return false;
    }

    pendingActionsRef.current.delete(key);
    if (message.ok === true) {
      pending.resolve(message.result ?? null);
    } else {
      pending.reject(new Error(readString(message.error) || "Action failed"));
    }
    return true;
  }

  function maybeAlertCaptureSuccess() {
    const expectedTrackIds = expectedCaptureIdsRef.current;
    if (!expectedTrackIds || successAlertedRef.current || queueFailedRef.current) {
      return;
    }

    for (const trackId of expectedTrackIds) {
      if (!completedQueueIdsRef.current.has(trackId)) {
        return;
      }
    }

    successAlertedRef.current = true;
    saveAndOpenPlayRoute().catch((error) => {
      queueFailedRef.current = true;
      window.alert(error instanceof Error ? error.message : String(error));
    });
  }

  async function saveAndOpenPlayRoute() {
    const currentSpotifyPath = spotifyPathRef.current;
    const currentTracks = tracksRef.current ?? [];

    if (!currentSpotifyPath) {
      throw new Error("Missing Spotify playlist or album path.");
    }

    await saveSpotifyContext({
      id: currentSpotifyPath,
      tracks: currentTracks.map((track) => track.trackId)
    });

    const playUrl = new URL("/play", window.location.origin);
    playUrl.hash = currentSpotifyPath;
    window.open(playUrl.toString(), "_blank", "noopener,noreferrer");
  }

  function waitForDeleteRefresh(trackId: string) {
    if (!trackId) {
      return Promise.resolve();
    }

    const existingResolve = deleteRefreshWaitersRef.current.get(trackId);
    if (existingResolve) {
      existingResolve();
    }

    return new Promise<void>((resolve) => {
      deleteRefreshWaitersRef.current.set(trackId, resolve);
    });
  }

  function settleDeleteRefresh(trackId: string) {
    const resolve = deleteRefreshWaitersRef.current.get(trackId);
    if (!resolve) {
      return;
    }

    deleteRefreshWaitersRef.current.delete(trackId);
    resolve();
  }

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
          aria-label="Start or stop ktv420 capture"
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
              <span
                className="iframe-track-state"
                data-state={stateKind(track)}
                aria-label={stateLabel(track)}
              />
              {track.trackArtworkSrc && (
                <img className="iframe-track-artwork" alt="" src={track.trackArtworkSrc} />
              )}
              <span className="iframe-track-copy">
                <span className="iframe-track-name">{track.trackName}</span>
                <span className="iframe-track-artist">{track.trackArtist}</span>
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

async function pollEvery<T>(callback: () => Promise<T | null>, intervalMs: number) {
  while (true) {
    const value = await callback();
    if (value !== null) {
      return value;
    }
    await delay(intervalMs);
  }
}

function actionKey(type: JobResultMessageType, trackId: string) {
  return `${type}:${trackId}`;
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
  if (sourceName === SPOTIFY_DATABASE_SOURCE_NAME) {
    return 0;
  }

  if (sourceName === IFRAME_DATABASE_SOURCE_NAME) {
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

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isOpfsState(value: unknown): value is OpfsState {
  return value === "missing" || value === "hydrated" || value === "broken";
}

function stateKind(track: IframeTrack) {
  if (track.hasLocalOutputMetadata) {
    return "complete";
  }

  if (track.opfsState === "hydrated") {
    return "hydrated";
  }

  if (track.opfsState === "broken") {
    return "broken";
  }

  return "missing";
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
