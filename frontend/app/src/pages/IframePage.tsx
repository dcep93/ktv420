import { useCallback, useEffect, useRef, useState } from "react";

import {
  downloadArtifactsToOpfs,
  hasLocalOutputMetadata,
  kickProcessQueue,
  readQueueHeadState,
  readRemoteOutputStatus,
  readSparseRemoteTrackStates,
  requestUnpartitionedOpfsAccess,
  saveSpotifyContext,
  type LocalDatabaseEntry,
  type RemoteOutputStatus,
  type SparseRemoteTrackState
} from "./iframeArtifacts";

const IFRAME_MESSAGE_SOURCE = "ktv420-iframe";
const PARENT_MESSAGE_SOURCE = "ktv420-parent";
const CLOSE_OVERLAY_MESSAGE = "ktv420:close-overlay";
const TRACKS_MESSAGE = "ktv420:tracks";
const TOGGLE_RUN_MESSAGE = "ktv420:toggle-run";
const ENQUEUE_TRACK_MESSAGE = "ktv420:enqueue-track";
const REQUEST_LOCAL_DATABASE_MESSAGE = "ktv420:request-local-database";
const DELETE_LOCAL_DATABASE_ENTRY_MESSAGE = "ktv420:delete-local-database-entry";
const INSPECT_LOCAL_DATABASE_ENTRY_MESSAGE = "ktv420:inspect-local-database-entry";
const DELETE_TRACK_ARTIFACT_MESSAGE = "ktv420:delete-track-artifact";
const LOCAL_DATABASE_MESSAGE = "ktv420:local-database";
const TRACK_CAPTURED_MESSAGE = "ktv420:track-captured";
const CAPTURE_COMPLETE_MESSAGE = "ktv420:capture-complete";
const ENQUEUE_TRACK_RESULT_MESSAGE = "ktv420:enqueue-track-result";
const POLL_INTERVAL_MS = 1000;
const PROCESS_QUEUE_WATCHDOG_MS = 30000;
const SPOTIFY_DATABASE_SOURCE_NAME = "Spotify content script";

type IframeMessageType =
  | typeof CLOSE_OVERLAY_MESSAGE
  | typeof TOGGLE_RUN_MESSAGE
  | typeof ENQUEUE_TRACK_MESSAGE
  | typeof REQUEST_LOCAL_DATABASE_MESSAGE
  | typeof DELETE_LOCAL_DATABASE_ENTRY_MESSAGE
  | typeof INSPECT_LOCAL_DATABASE_ENTRY_MESSAGE
  | typeof DELETE_TRACK_ARTIFACT_MESSAGE;
type OpfsState = "missing" | "hydrated" | "broken";
type MetadataRecord = Record<string, unknown>;
type ViewMode = "tracks" | "settings";
type JobResultMessageType = typeof ENQUEUE_TRACK_RESULT_MESSAGE;
type TrackResolution = "completed" | "pending_remote" | "needs_capture";
type TrackDisplayState = "missing" | "in-progress" | "broken" | "complete";

type IframeTrack = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  rowIndex: number;
  opfsState: OpfsState;
  hasLocalOutputMetadata: boolean;
  hasRemoteStemArtifacts: boolean;
  hasPendingRemoteQueueItem: boolean;
  remoteOutputStatus: RemoteOutputStatus | null;
  isRemoteProcessing: boolean;
  metadata: MetadataRecord | null;
  error?: string;
};

type LocalDatabaseSource = {
  sourceName: string;
  entries: LocalDatabaseEntry[];
  error?: string;
  loading?: boolean;
};

type TrackProgressRefreshState = {
  trackId: string;
  hasLocalOutputMetadata: boolean;
  hasRemoteStemArtifacts: boolean;
  hasPendingRemoteQueueItem: boolean;
  remoteOutputStatus: RemoteOutputStatus | null;
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
  const [viewMode, setViewMode] = useState<ViewMode>("tracks");
  const [databaseSources, setDatabaseSources] = useState<LocalDatabaseSource[]>([]);
  const pendingActionsRef = useRef(new Map<string, PendingAction>());
  const toggleRunRef = useRef<() => void>(() => { });
  const handleCapturedTrackMessageRef = useRef<(value: MetadataRecord) => void>(() => { });
  const enqueueCapturedTrackRef = useRef<(value: MetadataRecord) => void>(() => { });
  const setExpectedQueueTrackIdsRef = useRef<(trackIds: string[]) => void>(() => { });
  const queueRef = useRef<IframeTrack[]>([]);
  const knownQueueIdsRef = useRef(new Set<string>());
  const tracksNeedingCaptureRef = useRef(new Set<string>());
  const pendingRemoteTrackIdsRef = useRef(new Set<string>());
  const downloadingRemoteTrackIdsRef = useRef(new Set<string>());
  const sparseTrackStatesRef = useRef(new Map<string, SparseRemoteTrackState>());
  const checkingRemoteTrackIdsRef = useRef(new Set<string>());
  const completedQueueIdsRef = useRef(new Set<string>());
  const expectedCaptureIdsRef = useRef<Set<string> | null>(null);
  const captureStartedRef = useRef(false);
  const processingQueueRef = useRef(false);
  const remotePollRunningRef = useRef(false);
  const lastQueueRevisionRef = useRef<string | null>(null);
  const lastProcessQueueKickRef = useRef(0);
  const lastRemoteReconcileRef = useRef(0);
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
        const nextTracks = message.tracks
          .map((track: unknown) => toIframeTrack(track))
          .filter((track: IframeTrack | null): track is IframeTrack => track !== null);
        const nextSpotifyPath = readString(message.spotifyPath);
        setViewMode("tracks");
        setDatabaseSources([]);
        spotifyPathRef.current = nextSpotifyPath;
        tracksRef.current = nextTracks;
        setTracks(nextTracks);
        void refreshTrackProgressStates(nextTracks, (updater) => {
          setTracks((currentTracks) => {
            const refreshedTracks = updater(currentTracks);
            tracksRef.current = refreshedTracks;
            return refreshedTracks;
          });
        }).then((stateByTrackId) => {
          sparseTrackStatesRef.current = stateByTrackId;
        });
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
          if (source.sourceName === SPOTIFY_DATABASE_SOURCE_NAME) {
            setTracks((currentTracks) => {
              const reconciledTracks = reconcileTracksWithSpotifyOpfsEntries(currentTracks, source.entries);
              tracksRef.current = reconciledTracks;
              return reconciledTracks;
            });
          }
        }
        return;
      }

      if (message.type === ENQUEUE_TRACK_RESULT_MESSAGE) {
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
    const outputStateByTrackId = await readSparseRemoteTrackStates(
      currentTracks.map((track) => track.trackId)
    );
    sparseTrackStatesRef.current = outputStateByTrackId;
    const nextTracks = currentTracks.map((track) => {
      const state = outputStateByTrackId.get(track.trackId);
      return state
        ? applyTrackProgressState(track, state, { clearExistingError: true })
        : {
            ...track,
            isRemoteProcessing: false,
            error: undefined
          };
    });

    tracksRef.current = nextTracks;
    setTracks(nextTracks);

    expectedCaptureIdsRef.current = new Set(nextTracks.map((track) => track.trackId));
    requestSpotifyCaptureFromSnapshot(nextTracks, outputStateByTrackId);
    for (const track of nextTracks) {
      enqueueTrack(track);
    }

    void processQueue();
    maybeAlertCaptureSuccess();
  }

  toggleRunRef.current = () => {
    void toggleRun();
  };

  const loadSettingsView = useCallback(async () => {
    setViewMode("settings");
    setDatabaseSources([
      { sourceName: SPOTIFY_DATABASE_SOURCE_NAME, entries: [], loading: true }
    ]);
    postParentMessage(REQUEST_LOCAL_DATABASE_MESSAGE);
  }, []);

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
      }
    },
    []
  );

  const inspectDatabaseEntry = useCallback((source: LocalDatabaseSource, entry: LocalDatabaseEntry) => {
    if (entry.kind !== "file") {
      return;
    }

    if (source.sourceName === SPOTIFY_DATABASE_SOURCE_NAME) {
      postParentMessage(INSPECT_LOCAL_DATABASE_ENTRY_MESSAGE, { path: entry.path });
      return;
    }

    console.log("[ktv420] OPFS file contents", {
      source: source.sourceName,
      path: entry.path,
      contents: parseConsoleContents(entry.text ?? "")
    });
  }, []);

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
    tracksNeedingCaptureRef.current.clear();
    pendingRemoteTrackIdsRef.current.clear();
    downloadingRemoteTrackIdsRef.current.clear();
    sparseTrackStatesRef.current.clear();
    checkingRemoteTrackIdsRef.current.clear();
    completedQueueIdsRef.current.clear();
    expectedCaptureIdsRef.current = null;
    captureStartedRef.current = false;
    processingQueueRef.current = false;
    remotePollRunningRef.current = false;
    lastQueueRevisionRef.current = null;
    lastProcessQueueKickRef.current = 0;
    lastRemoteReconcileRef.current = 0;
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
    const nextTracks = updateCapturedTrack(tracksRef.current, value);
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    await refreshLocalOutputMetadataForTrack(trackId, updateTracks);
    settleDeleteRefresh(trackId);
  }

  handleCapturedTrackMessageRef.current = (value: MetadataRecord) => {
    void handleCapturedTrackMessage(value);
  };

  async function enqueueCapturedTrack(value: MetadataRecord) {
    const trackId = readString(value.trackId) || readString((value.metadata as MetadataRecord | null)?.trackId);

    const isRemoteProcessing = value.isRemoteProcessing === true;
    if (!trackId || (!isRemoteProcessing && value.opfsState !== "hydrated") || readString(value.error)) {
      return;
    }

    await waitForRemoteTrack(trackId);
  }

  enqueueCapturedTrackRef.current = (value: MetadataRecord) => {
    void enqueueCapturedTrack(value);
  };

  async function setExpectedQueueTrackIds(trackIds: string[]) {
    const currentExpectedTrackIds = expectedCaptureIdsRef.current;
    const nextExpectedTrackIds = currentExpectedTrackIds ? null : new Set<string>();

    for (const trackId of trackIds) {
      if (await hasLocalOutputMetadata(trackId)) {
        completedQueueIdsRef.current.add(trackId);
        tracksNeedingCaptureRef.current.delete(trackId);
      } else if (nextExpectedTrackIds) {
        nextExpectedTrackIds.add(trackId);
      }
    }

    if (nextExpectedTrackIds) {
      expectedCaptureIdsRef.current = nextExpectedTrackIds;
    }

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
      requestSpotifyCaptureIfNeeded();
      maybeAlertCaptureSuccess();
      return;
    }

    knownQueueIdsRef.current.delete(item.trackId);
    processingQueueRef.current = true;

    try {
      const resolved = await resolveTrackToLocalOutput(item);
      if (resolved === "completed") {
        completedQueueIdsRef.current.add(item.trackId);
        tracksNeedingCaptureRef.current.delete(item.trackId);
      } else if (resolved === "needs_capture") {
        tracksNeedingCaptureRef.current.add(item.trackId);
      }
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

  async function resolveTrackToLocalOutput(track: IframeTrack): Promise<TrackResolution> {
    if (await hasLocalOutputMetadata(track.trackId)) {
      markTrackComplete(track.trackId);
      return "completed";
    }

    const metadata = metadataForTrack(track);
    const sparseTrackState = await sparseStateForTrack(track.trackId);
    const remoteStatus = sparseTrackState.remoteOutputStatus;
    if (remoteStatus?.status === "completed") {
      startRemoteArtifactDownload(track.trackId, metadata);
      return "pending_remote";
    }
    if (remoteStatus?.status === "failed") {
      markTrackError(track.trackId, remoteStatus.error);
      throw new Error(`Remote processing failed for ${trackNameForId(track.trackId)}. ${remoteStatus.error}`);
    }

    if (sparseTrackState.hasPendingRemoteQueueItem) {
      await waitForRemoteTrack(track.trackId);
      return "pending_remote";
    }

    if (sparseTrackState.hasRemoteStemArtifacts) {
      markTrackRemoteStemArtifacts(track.trackId, true);
      await waitForRemoteTrack(track.trackId);
      return "pending_remote";
    }

    if (track.opfsState !== "hydrated" || !track.metadata) {
      return "needs_capture";
    }

    await sendAction(ENQUEUE_TRACK_MESSAGE, ENQUEUE_TRACK_RESULT_MESSAGE, track.trackId);
    await waitForRemoteTrack(track.trackId);
    return "pending_remote";
  }

  function requestSpotifyCaptureFromSnapshot(
    tracks: IframeTrack[],
    stateByTrackId: Map<string, SparseRemoteTrackState>
  ) {
    for (const track of tracks) {
      const state = stateByTrackId.get(track.trackId);
      if (trackNeedsSpotifyCapture(track, state)) {
        tracksNeedingCaptureRef.current.add(track.trackId);
      }
    }

    requestSpotifyCaptureIfNeeded();
  }

  async function sparseStateForTrack(trackId: string) {
    const cachedState = sparseTrackStatesRef.current.get(trackId);
    if (cachedState) {
      return cachedState;
    }

    const stateByTrackId = await readSparseRemoteTrackStates([trackId]);
    for (const [nextTrackId, state] of stateByTrackId) {
      sparseTrackStatesRef.current.set(nextTrackId, state);
    }
    const state = stateByTrackId.get(trackId);
    if (!state) {
      return {
        trackId,
        hasLocalOutputMetadata: false,
        hasRemoteStemArtifacts: false,
        hasPendingRemoteQueueItem: false,
        remoteOutputStatus: null
      } satisfies SparseRemoteTrackState;
    }

    return state;
  }

  async function waitForRemoteTrack(trackId: string) {
    if (!trackId || completedQueueIdsRef.current.has(trackId)) {
      return;
    }

    markTrackRemoteProcessing(trackId, true);
    pendingRemoteTrackIdsRef.current.add(trackId);
    void checkRemoteTrackOnce(trackId).catch(handleRemotePollError);
    startRemoteOutputPoll();
  }

  function startRemoteOutputPoll() {
    if (remotePollRunningRef.current) {
      return;
    }

    remotePollRunningRef.current = true;
    void pollRemoteOutputs();
  }

  async function pollRemoteOutputs() {
    try {
      while (pendingRemoteTrackIdsRef.current.size > 0 && !queueFailedRef.current) {
        const watchdogKicked = await kickProcessQueueWatchdog();
        const queueState = await readQueueHeadState();

        if (queueState?.revision && queueState.revision !== lastQueueRevisionRef.current) {
          lastQueueRevisionRef.current = queueState.revision;
          if (queueState.head_state === "empty") {
            await checkPendingRemoteTracks(true);
          } else {
            await checkChangedRemoteTracks([
              ...(queueState.changed_track_ids ?? []),
              queueState.last_changed_track_id,
              queueState.head_track_id
            ]);
          }
        } else if (watchdogKicked) {
          await checkPendingRemoteTracks();
        }

        await delay(POLL_INTERVAL_MS);
      }
    } catch (error) {
      handleRemotePollError(error);
    } finally {
      remotePollRunningRef.current = false;
      maybeAlertCaptureSuccess();
      if (pendingRemoteTrackIdsRef.current.size > 0 && !queueFailedRef.current) {
        startRemoteOutputPoll();
      }
    }
  }

  async function kickProcessQueueWatchdog() {
    const now = Date.now();
    if (now - lastProcessQueueKickRef.current < PROCESS_QUEUE_WATCHDOG_MS) {
      return false;
    }

    lastProcessQueueKickRef.current = now;
    try {
      await kickProcessQueue();
      return true;
    } catch (error) {
      console.warn("[ktv420] process_queue watchdog failed", error);
      return true;
    }
  }

  async function checkChangedRemoteTracks(trackIds: Array<string | null>) {
    const uniqueTrackIds = [...new Set(trackIds.filter((trackId): trackId is string => Boolean(trackId)))];
    for (const trackId of uniqueTrackIds) {
      await checkRemoteTrackOnce(trackId);
    }
  }

  async function checkPendingRemoteTracks(force = false) {
    const now = Date.now();
    if (!force && now - lastRemoteReconcileRef.current < PROCESS_QUEUE_WATCHDOG_MS) {
      return;
    }

    lastRemoteReconcileRef.current = now;
    for (const trackId of [...pendingRemoteTrackIdsRef.current]) {
      await checkRemoteTrackOnce(trackId);
    }
  }

  async function checkRemoteTrackOnce(trackId: string) {
    if (!pendingRemoteTrackIdsRef.current.has(trackId) || checkingRemoteTrackIdsRef.current.has(trackId)) {
      return;
    }

    checkingRemoteTrackIdsRef.current.add(trackId);
    try {
      await checkRemoteTrack(trackId);
    } finally {
      checkingRemoteTrackIdsRef.current.delete(trackId);
    }
  }

  function handleRemotePollError(error: unknown) {
    queueFailedRef.current = true;
    window.alert(error instanceof Error ? error.message : String(error));
  }

  async function checkRemoteTrack(trackId: string) {
    const status = await readRemoteOutputStatus(trackId);
    if (!status) {
      return;
    }

    if (status.status === "failed") {
      pendingRemoteTrackIdsRef.current.delete(trackId);
      markTrackRemoteProcessing(trackId, false);
      markTrackError(trackId, status.error);
      throw new Error(`Remote processing failed for ${trackNameForId(trackId)}. ${status.error}`);
    }

    const track = findTrack(trackId);
    startRemoteArtifactDownload(trackId, track ? metadataForTrack(track) : { trackId });
  }

  function startRemoteArtifactDownload(trackId: string, metadata: MetadataRecord) {
    if (
      !trackId ||
      completedQueueIdsRef.current.has(trackId) ||
      downloadingRemoteTrackIdsRef.current.has(trackId)
    ) {
      return;
    }

    downloadingRemoteTrackIdsRef.current.add(trackId);
    markTrackRemoteProcessing(trackId, true);
    void downloadRemoteArtifactToLocalOutput(trackId, metadata);
  }

  async function downloadRemoteArtifactToLocalOutput(trackId: string, metadata: MetadataRecord) {
    try {
      const hasOutputMetadata = await downloadTrackArtifacts(trackId, metadata);
      if (hasOutputMetadata) {
        completedQueueIdsRef.current.add(trackId);
        tracksNeedingCaptureRef.current.delete(trackId);
      }
    } catch (error) {
      handleRemotePollError(error);
    } finally {
      downloadingRemoteTrackIdsRef.current.delete(trackId);
      pendingRemoteTrackIdsRef.current.delete(trackId);
      markTrackRemoteProcessing(trackId, false);
      maybeAlertCaptureSuccess();
    }
  }

  async function downloadTrackArtifacts(trackId: string, metadata: MetadataRecord) {
    await downloadArtifactsToOpfs(trackId, metadata);
    const hasOutputMetadata = await hasLocalOutputMetadata(trackId);
    if (hasOutputMetadata) {
      markTrackComplete(trackId);
      const deleteRefreshPromise = waitForDeleteRefresh(trackId);
      postParentMessage(DELETE_TRACK_ARTIFACT_MESSAGE, { trackId });
      await deleteRefreshPromise;
    }
    return hasOutputMetadata;
  }

  function enqueueTrack(track: IframeTrack) {
    if (knownQueueIdsRef.current.has(track.trackId) || completedQueueIdsRef.current.has(track.trackId)) {
      return;
    }

    knownQueueIdsRef.current.add(track.trackId);
    queueRef.current.push(track);
  }

  function findTrack(trackId: string) {
    return tracksRef.current?.find((track) => track.trackId === trackId) ?? null;
  }

  function trackNameForId(trackId: string) {
    const track = findTrack(trackId);
    return track ? `${track.trackName} (${trackId})` : trackId;
  }

  function requestSpotifyCaptureIfNeeded() {
    if (captureStartedRef.current || tracksNeedingCaptureRef.current.size === 0) {
      return;
    }

    const trackIds = Array.from(tracksNeedingCaptureRef.current);
    captureStartedRef.current = true;
    postParentMessage(TOGGLE_RUN_MESSAGE, { trackIds });
  }

  function markTrackComplete(trackId: string) {
    updateTracks((currentTracks) => markTrackLocalOutputMetadata(currentTracks, trackId, true));
  }

  function markTrackRemoteProcessing(trackId: string, isRemoteProcessing: boolean) {
    updateTracks((currentTracks) =>
      markTrackRemoteProcessingState(currentTracks, trackId, isRemoteProcessing)
    );
  }

  function markTrackRemoteStemArtifacts(trackId: string, hasRemoteArtifacts: boolean) {
    updateTracks((currentTracks) =>
      markTrackRemoteStemArtifactsState(currentTracks, trackId, hasRemoteArtifacts)
    );
  }

  function markTrackError(trackId: string, error: string) {
    updateTracks((currentTracks) => markTrackErrorState(currentTracks, trackId, error));
  }

  function updateTracks(updater: (currentTracks: IframeTrack[] | null) => IframeTrack[] | null) {
    const nextTracks = updater(tracksRef.current);
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  }

  function sendAction(
    type: typeof ENQUEUE_TRACK_MESSAGE,
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
    if (!expectedTrackIds || expectedTrackIds.size === 0 || successAlertedRef.current || queueFailedRef.current) {
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
        <button
          type="button"
          className="iframe-settings-button"
          aria-label="Toggle settings view"
          aria-pressed={viewMode === "settings"}
          onClick={toggleSettingsView}
        >
          ⚙️
        </button>
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
                      {entry.kind === "directory" ? (
                        <button
                          type="button"
                          className="iframe-settings-row"
                          aria-label={`Delete ${entry.kind} ${entry.path} from ${source.sourceName}`}
                          title={databaseEntryTitle(entry)}
                          onClick={() => {
                            void deleteDatabaseEntry(source, entry);
                          }}
                        >
                          <span className="iframe-settings-kind">dir</span>
                          <span className="iframe-settings-path">{entry.path}</span>
                          <span className="iframe-settings-size">{formatBytes(entry.size)}</span>
                        </button>
                      ) : (
                        <div className="iframe-settings-row" title={databaseEntryTitle(entry)}>
                          <span className="iframe-settings-kind">file</span>
                          <span className="iframe-settings-path">{entry.path}</span>
                          <span className="iframe-settings-size">{formatBytes(entry.size)}</span>
                          <span className="iframe-settings-row-actions">
                            <button
                              type="button"
                              className="iframe-settings-emoji-button"
                              aria-label={`Delete file ${entry.path} from ${source.sourceName}`}
                              title="Delete file"
                              onClick={() => {
                                void deleteDatabaseEntry(source, entry);
                              }}
                            >
                              🗑️
                            </button>
                            <button
                              type="button"
                              className="iframe-settings-emoji-button"
                              aria-label={`Log file contents for ${entry.path} from ${source.sourceName}`}
                              title="Log file contents"
                              onClick={() => {
                                inspectDatabaseEntry(source, entry);
                              }}
                            >
                              🔎
                            </button>
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="iframe-settings-empty">No OPFS entries.</p>
              )}
            </section>
          ))}
          <section className="iframe-settings-source">
            <header className="iframe-settings-source-header">
              <h2>Iframe OPFS</h2>
              <a
                className="iframe-settings-link"
                href="./settings"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open settings
              </a>
            </header>
          </section>
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
  const hasRemoteArtifacts = track.hasRemoteStemArtifacts === true;
  const hasPendingRemoteQueueItem = track.hasPendingRemoteQueueItem === true;
  const remoteOutputStatus = toRemoteOutputStatus(track.remoteOutputStatus);
  const isRemoteProcessing = track.isRemoteProcessing === true;

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
    hasRemoteStemArtifacts: hasRemoteArtifacts,
    hasPendingRemoteQueueItem,
    remoteOutputStatus,
    isRemoteProcessing,
    metadata,
    error: readString(track.error) || undefined
  };
}

function toRemoteOutputStatus(value: unknown): RemoteOutputStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.status === "completed") {
    return { status: "completed" };
  }

  if (value.status === "failed") {
    return {
      status: "failed",
      error: readString(value.error) || "Remote processing failed."
    };
  }

  return null;
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

function trackIdsWithLocalCaptureArtifacts(entries: LocalDatabaseEntry[]) {
  const trackArtifacts = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (entry.kind !== "file") {
      continue;
    }

    const [trackId, artifactName] = entry.path.split("/");
    if (!trackId || !artifactName) {
      continue;
    }

    const artifacts = trackArtifacts.get(trackId) ?? new Set<string>();
    artifacts.add(artifactName);
    trackArtifacts.set(trackId, artifacts);
  }

  return new Set(
    [...trackArtifacts.entries()]
      .filter(([, artifacts]) => artifacts.has("metadata.json") && artifacts.has("pcm_s16le.b64"))
      .map(([trackId]) => trackId)
  );
}

function reconcileTracksWithSpotifyOpfsEntries(
  currentTracks: IframeTrack[] | null,
  entries: LocalDatabaseEntry[]
) {
  if (!currentTracks) {
    return currentTracks;
  }

  const hydratedTrackIds = trackIdsWithLocalCaptureArtifacts(entries);
  const nextTracks = currentTracks.map((track) => {
    const hasLocalCapture = hydratedTrackIds.has(track.trackId);
    const opfsState: OpfsState = hasLocalCapture
      ? "hydrated"
      : track.opfsState === "hydrated"
        ? "missing"
        : track.opfsState;

    return {
      ...track,
      opfsState
    };
  });

  return nextTracks;
}

function upsertDatabaseSource(sources: LocalDatabaseSource[], nextSource: LocalDatabaseSource) {
  const nextSources = sources.filter((source) => source.sourceName !== nextSource.sourceName);
  nextSources.push(nextSource);
  return nextSources.sort(compareDatabaseSources);
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
      hasRemoteStemArtifacts:
        value.hasRemoteStemArtifacts === true ||
        value.isRemoteProcessing === true ||
        (track.hasRemoteStemArtifacts && value.hasRemoteStemArtifacts !== false),
      hasPendingRemoteQueueItem:
        value.isRemoteProcessing === true ||
        (track.hasPendingRemoteQueueItem && value.isRemoteProcessing !== false),
      remoteOutputStatus: track.remoteOutputStatus,
      isRemoteProcessing:
        value.isRemoteProcessing === true ||
        (track.isRemoteProcessing && value.isRemoteProcessing !== false),
      metadata,
      error: readString(value.error) || undefined
    };
  });
}

function metadataForTrack(track: IframeTrack): MetadataRecord {
  return {
    ...(track.metadata ?? {}),
    trackId: readString(track.metadata?.trackId) || track.trackId,
    trackName: readString(track.metadata?.trackName) || track.trackName,
    trackArtist: readString(track.metadata?.trackArtist) || track.trackArtist,
    trackArtworkSrc: readString(track.metadata?.trackArtworkSrc) || track.trackArtworkSrc
  };
}

function trackNeedsSpotifyCapture(track: IframeTrack, state?: SparseRemoteTrackState) {
  const hasLocalOutputMetadata = state?.hasLocalOutputMetadata ?? track.hasLocalOutputMetadata;
  const hasRemoteStemArtifacts = state?.hasRemoteStemArtifacts ?? track.hasRemoteStemArtifacts;
  const hasPendingRemoteQueueItem = state?.hasPendingRemoteQueueItem ?? track.hasPendingRemoteQueueItem;
  const remoteOutputStatus = state?.remoteOutputStatus ?? track.remoteOutputStatus;

  if (
    hasLocalOutputMetadata ||
    remoteOutputStatus ||
    hasRemoteStemArtifacts ||
    hasPendingRemoteQueueItem
  ) {
    return false;
  }

  return track.opfsState !== "hydrated" || !track.metadata;
}

async function refreshTrackProgressStates(
  tracks: IframeTrack[],
  updateTracks: (updater: (currentTracks: IframeTrack[] | null) => IframeTrack[] | null) => void
) {
  let stateByTrackId: Map<string, TrackProgressRefreshState>;
  try {
    stateByTrackId = await readSparseRemoteTrackStates(tracks.map((track) => track.trackId));
  } catch (error) {
    console.warn("[ktv420] Failed to refresh sparse remote progress state", error);
    stateByTrackId = new Map(
      tracks.map((track) => [
        track.trackId,
        {
          trackId: track.trackId,
          hasLocalOutputMetadata: track.hasLocalOutputMetadata,
          hasRemoteStemArtifacts: track.hasRemoteStemArtifacts,
          hasPendingRemoteQueueItem: track.hasPendingRemoteQueueItem,
          remoteOutputStatus: track.remoteOutputStatus
        }
      ])
    );
  }

  updateTracks((currentTracks) => {
    if (!currentTracks) {
      return currentTracks;
    }

    return currentTracks.map((track) => {
      const state = stateByTrackId.get(track.trackId);
      return state === undefined ? track : applyTrackProgressState(track, state);
    });
  });

  return stateByTrackId;
}

function applyTrackProgressState(
  track: IframeTrack,
  state: TrackProgressRefreshState,
  { clearExistingError = false } = {}
) {
  const failedError = state.remoteOutputStatus?.status === "failed"
    ? state.remoteOutputStatus.error
    : "";
  const isRemoteProcessing =
    !state.hasLocalOutputMetadata &&
    (
      state.hasPendingRemoteQueueItem ||
      (
        state.hasRemoteStemArtifacts &&
        state.remoteOutputStatus?.status !== "failed"
      )
    );

  return {
    ...track,
    hasLocalOutputMetadata: state.hasLocalOutputMetadata,
    hasRemoteStemArtifacts: state.hasRemoteStemArtifacts,
    hasPendingRemoteQueueItem: state.hasPendingRemoteQueueItem,
    remoteOutputStatus: state.remoteOutputStatus,
    isRemoteProcessing,
    error: failedError || (clearExistingError ? undefined : track.error)
  };
}

async function refreshLocalOutputMetadataForTrack(
  trackId: string,
  updateTracks: (updater: (currentTracks: IframeTrack[] | null) => IframeTrack[] | null) => void
) {
  if (!trackId) {
    return;
  }

  const hasOutputMetadata = await hasLocalOutputMetadata(trackId);
  updateTracks((currentTracks) =>
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
      ? {
          ...track,
          hasLocalOutputMetadata: hasOutputMetadata,
          hasPendingRemoteQueueItem: hasOutputMetadata ? false : track.hasPendingRemoteQueueItem,
          isRemoteProcessing: hasOutputMetadata ? false : track.isRemoteProcessing
        }
      : track
  );
}

function markTrackRemoteProcessingState(
  currentTracks: IframeTrack[] | null,
  trackId: string,
  isRemoteProcessing: boolean
) {
  if (!currentTracks) {
    return currentTracks;
  }

  return currentTracks.map((track) =>
    track.trackId === trackId
      ? {
          ...track,
          hasRemoteStemArtifacts: isRemoteProcessing ? true : track.hasRemoteStemArtifacts,
          hasPendingRemoteQueueItem: isRemoteProcessing ? track.hasPendingRemoteQueueItem : false,
          isRemoteProcessing,
          error: isRemoteProcessing ? undefined : track.error
        }
      : track
  );
}

function markTrackRemoteStemArtifactsState(
  currentTracks: IframeTrack[] | null,
  trackId: string,
  hasRemoteArtifacts: boolean
) {
  if (!currentTracks) {
    return currentTracks;
  }

  return currentTracks.map((track) =>
    track.trackId === trackId
      ? {
          ...track,
          hasRemoteStemArtifacts: hasRemoteArtifacts
        }
      : track
  );
}

function markTrackErrorState(currentTracks: IframeTrack[] | null, trackId: string, error: string) {
  if (!currentTracks) {
    return currentTracks;
  }

  return currentTracks.map((track) =>
    track.trackId === trackId
      ? {
          ...track,
          hasPendingRemoteQueueItem: false,
          remoteOutputStatus: { status: "failed" as const, error },
          isRemoteProcessing: false,
          error
        }
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

function parseConsoleContents(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
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

  return 1;
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

function stateKind(track: IframeTrack): TrackDisplayState {
  if (track.hasLocalOutputMetadata) {
    return "complete";
  }

  if (track.error) {
    return "broken";
  }

  if (
    track.opfsState === "hydrated" ||
    track.hasRemoteStemArtifacts ||
    track.hasPendingRemoteQueueItem ||
    track.isRemoteProcessing
  ) {
    return "in-progress";
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

  if (track.error) {
    return track.error;
  }

  if (
    track.opfsState === "hydrated" ||
    track.hasRemoteStemArtifacts ||
    track.hasPendingRemoteQueueItem ||
    track.isRemoteProcessing
  ) {
    return "In progress";
  }

  if (track.opfsState === "broken") {
    return "Broken OPFS artifact";
  }

  return "Missing from OPFS";
}
