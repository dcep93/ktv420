import { useCallback, useEffect, useRef, useState } from "react";

import Player from "../features/stems/player/Player";
import {
  type PlaybackRecording,
  type RecordingEvent,
  type RecordingStartRequest
} from "../features/stems/player/types";
import {
  recordingExists,
  renameRecording,
  readTrackPlaybackRecord,
  readSpotifyContext,
  readTrackMetadata,
  readTrackOutputMetadata,
  savePlaybackRecording,
  type LocalPlaybackRecord,
  type SavedSpotifyContext
} from "./iframeArtifacts";

type PlayTrack = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  metadata: Record<string, unknown> | null;
  outputMetadata: Record<string, unknown> | null;
};

const emptyPlaybackRecord = (trackId: string): LocalPlaybackRecord => ({
  md5: trackId,
  files: []
});

const RECORDING_VERSION = 1;

export default function PlayPage() {
  const [hashSpotifyPath, setHashSpotifyPath] = useState(readSpotifyPathHash);
  const spotifyPath = hashSpotifyPath;
  const spotifyUrl = spotifyPath ? `https://open.spotify.com/${spotifyPath}` : "";
  const spotifyLabel = spotifyPath ? `open.spotify.com/${spotifyPath}` : "";
  const [record, setRecord] = useState<SavedSpotifyContext | null>(null);
  const [tracks, setTracks] = useState<PlayTrack[]>([]);
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
  const [activePlaybackRecord, setActivePlaybackRecord] = useState<LocalPlaybackRecord | null>(null);
  const [activePlaybackLoading, setActivePlaybackLoading] = useState(false);
  const [activePlaybackError, setActivePlaybackError] = useState("");
  const [autoPlayActiveTrack, setAutoPlayActiveTrack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef<PlaybackRecording | null>(null);
  const recordingFileNameRef = useRef("");
  const flushPlayerRecordingEventsRef = useRef<() => void>(() => {});

  useEffect(() => {
    const handleHashChange = () => setHashSpotifyPath(readSpotifyPathHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        if (!spotifyPath) {
          setRecord(null);
          setTracks([]);
          setActiveTrackIndex(0);
          setAutoPlayActiveTrack(false);
          return;
        }

        const nextRecord = await readSpotifyContext(spotifyPath);
        if (!nextRecord) {
          setRecord(null);
          setTracks([]);
          setActiveTrackIndex(0);
          setAutoPlayActiveTrack(false);
          return;
        }

        const nextTracks = await Promise.all(nextRecord.tracks.map(loadPlayTrack));
        if (!cancelled) {
          setRecord(nextRecord);
          setTracks(nextTracks);
          setActiveTrackIndex(0);
          setAutoPlayActiveTrack(false);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setRecord(null);
          setTracks([]);
          setAutoPlayActiveTrack(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [spotifyPath]);

  const activeTrack = tracks[activeTrackIndex] ?? null;

  const appendRecordingEvent = useCallback((event: RecordingEvent) => {
    const recording = recordingRef.current;

    if (!recording) {
      return;
    }

    recording.events.push(event);

    if (event.type !== "track_started" || !isRecord(event.payload)) {
      return;
    }

    const trackId = readString(event.payload.trackId);
    if (trackId && !recording.trackIds.includes(trackId)) {
      recording.trackIds.push(trackId);
    }
  }, []);

  const appendTrackStarted = useCallback(
    (trackId: string, trackTimeSeconds = 0) => {
      appendRecordingEvent({
        type: "track_started",
        trackTimeSeconds: roundTrackTime(trackTimeSeconds),
        payload: { trackId }
      });
    },
    [appendRecordingEvent]
  );

  const appendTrackStartedForIndex = useCallback(
    (index: number) => {
      const track = tracks[index];

      if (!isRecording || !track) {
        return;
      }

      flushPlayerRecordingEventsRef.current();
      appendTrackStarted(track.trackId);
    },
    [appendTrackStarted, isRecording, tracks]
  );

  const handleStartRecording = useCallback(
    async ({ trackTimeSeconds, snapshotPayload }: RecordingStartRequest) => {
      if (!activeTrack) {
        return false;
      }

      const fileName = window.prompt("Name this recording");
      if (fileName === null) {
        return false;
      }

      const recordingFileName = toRecordingFileName(fileName);
      if (!recordingFileName) {
        window.alert("Recording names cannot be empty or contain path separators.");
        return false;
      }

      try {
        if (!(await resolveRecordingNameConflict(recordingFileName))) {
          return false;
        }
      } catch (conflictError) {
        window.alert(formatError(conflictError));
        return false;
      }

      const recording: PlaybackRecording = {
        version: RECORDING_VERSION,
        name: recordingFileName,
        createdAt: new Date().toISOString(),
        trackIds: [],
        events: []
      };
      recordingRef.current = recording;
      recordingFileNameRef.current = recordingFileName;
      setIsRecording(true);

      appendRecordingEvent({
        type: "record_start_snapshot",
        trackTimeSeconds: roundTrackTime(trackTimeSeconds),
        ...(snapshotPayload === undefined ? {} : { payload: snapshotPayload })
      });
      appendTrackStarted(activeTrack.trackId, trackTimeSeconds);
      return true;
    },
    [activeTrack, appendRecordingEvent, appendTrackStarted]
  );

  const handleStopRecording = useCallback(
    async (event: RecordingEvent) => {
      const recording = recordingRef.current;
      const fileName = recordingFileNameRef.current;

      if (!recording || !fileName) {
        return;
      }

      appendRecordingEvent(event);

      try {
        await savePlaybackRecording(fileName, recording);
        window.alert(
          `Recording saved with ${recording.events.length} event${recording.events.length === 1 ? "" : "s"}.`
        );
        recordingRef.current = null;
        recordingFileNameRef.current = "";
        setIsRecording(false);
      } catch (saveError) {
        recording.events.pop();
        window.alert(formatError(saveError));
      }
    },
    [appendRecordingEvent]
  );

  useEffect(() => {
    let cancelled = false;

    const loadActivePlaybackRecord = async () => {
      setActivePlaybackRecord(null);
      setActivePlaybackError("");
      setActivePlaybackLoading(false);

      if (!activeTrack) {
        return;
      }

      if (!activeTrack.outputMetadata) {
        return;
      }

      setActivePlaybackLoading(true);

      try {
        const nextRecord = await readTrackPlaybackRecord(activeTrack.trackId);
        if (!cancelled) {
          setActivePlaybackRecord(nextRecord);
        }
      } catch (loadError) {
        if (!cancelled) {
          setActivePlaybackError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) {
          setActivePlaybackLoading(false);
        }
      }
    };

    void loadActivePlaybackRecord();
    return () => {
      cancelled = true;
    };
  }, [activeTrack]);

  const activeTrackPlaybackRecord =
    activeTrack && activePlaybackRecord?.md5 === activeTrack.trackId
      ? activePlaybackRecord
      : null;
  const playbackRecord = activeTrack
    ? activeTrackPlaybackRecord ?? emptyPlaybackRecord(activeTrack.trackId)
    : null;
  const playbackFileCount = playbackRecord?.files.length ?? 0;
  const activeTrackTitle = activeTrack
    ? activeTrack.trackName || activeTrack.trackId
    : "Playback";
  const activeUnavailableMessage = activePlaybackError
    ? activePlaybackError
    : activePlaybackLoading
      ? "Loading local playback files..."
      : activeTrack?.outputMetadata
        ? "No playable local files found for this track."
        : "Missing local output for this track.";

  useEffect(() => {
    if (
      autoPlayActiveTrack &&
      activeTrack &&
      !activePlaybackLoading &&
      (!activeTrack.outputMetadata ||
        Boolean(activePlaybackError) ||
        (Boolean(activeTrackPlaybackRecord) && playbackFileCount === 0))
    ) {
      setAutoPlayActiveTrack(false);
    }
  }, [
    activePlaybackError,
    activePlaybackLoading,
    activeTrack,
    activeTrackPlaybackRecord,
    autoPlayActiveTrack,
    playbackFileCount,
  ]);

  return (
    <main className="standalone-page play-page" aria-label="ktv420 play">
      {error ? (
        <p className="settings-error">{error}</p>
      ) : loading ? (
        <p className="settings-empty">Loading...</p>
      ) : !record ? (
        <p className="settings-empty">No saved tracklist found.</p>
      ) : (
        <>
          {playbackRecord ? (
            <section className="play-player" aria-label="Active track player">
              <Player
                record={playbackRecord}
                title={activeTrackTitle}
                trackMetadata={activeTrack?.metadata}
                unavailableMessage={activeUnavailableMessage}
                hasPreviousTrack={activeTrackIndex > 0}
                hasNextTrack={activeTrackIndex < tracks.length - 1}
                autoPlayOnReady={autoPlayActiveTrack && Boolean(activeTrackPlaybackRecord)}
                onPreviousTrack={() => {
                  setAutoPlayActiveTrack(false);
                  const nextIndex = Math.max(0, activeTrackIndex - 1);
                  if (nextIndex !== activeTrackIndex) {
                    appendTrackStartedForIndex(nextIndex);
                  }
                  setActiveTrackIndex(nextIndex);
                }}
                onNextTrack={() => {
                  setAutoPlayActiveTrack(false);
                  const nextIndex = Math.min(tracks.length - 1, activeTrackIndex + 1);
                  if (nextIndex !== activeTrackIndex) {
                    appendTrackStartedForIndex(nextIndex);
                  }
                  setActiveTrackIndex(nextIndex);
                }}
                onTrackEnd={() => {
                  setAutoPlayActiveTrack(true);
                  const nextIndex = Math.min(tracks.length - 1, activeTrackIndex + 1);
                  if (nextIndex !== activeTrackIndex) {
                    appendTrackStartedForIndex(nextIndex);
                  }
                  setActiveTrackIndex(nextIndex);
                }}
                onAutoPlayOnReadyHandled={() => setAutoPlayActiveTrack(false)}
                isRecording={isRecording}
                onStartRecording={handleStartRecording}
                onStopRecording={handleStopRecording}
                onRecordingEvent={appendRecordingEvent}
                onRegisterRecordingFlush={(flush) => {
                  flushPlayerRecordingEventsRef.current = flush ?? (() => {});
                }}
              />
            </section>
          ) : null}
          {spotifyPath ? (
            <div className="play-source-row">
              <a className="play-spotify-link" href={spotifyUrl} rel="noreferrer" target="_blank">
                {spotifyLabel}
              </a>
              <span>{record.tracks.length} track(s)</span>
            </div>
          ) : null}
          <ol className="play-track-list">
            {tracks.map((track, index) => {
              const isActive = index === activeTrackIndex;
              const trackState = isActive ? "active" : track.outputMetadata ? "available" : "missing";

              return (
                <li key={`${track.trackId}-${index}`}>
                  <button
                    type="button"
                    className="play-track-row"
                    data-state={trackState}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      setAutoPlayActiveTrack(false);
                      if (index !== activeTrackIndex) {
                        appendTrackStartedForIndex(index);
                      }
                      setActiveTrackIndex(index);
                    }}
                  >
                    <span className="play-track-index">{index + 1}</span>
                    {track.trackArtworkSrc ? (
                      <img className="iframe-track-artwork" alt="" src={track.trackArtworkSrc} />
                    ) : (
                      <span className="play-track-artwork-placeholder" aria-hidden="true" />
                    )}
                    <span className="iframe-track-copy">
                      <span className="iframe-track-name">{track.trackName || track.trackId}</span>
                      <span className="iframe-track-artist">{track.trackArtist || track.trackId}</span>
                    </span>
                    <span className="play-track-status">
                      {track.outputMetadata ? "" : "missing output"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}

async function resolveRecordingNameConflict(fileName: string): Promise<boolean> {
  if (!(await recordingExists(fileName))) {
    return true;
  }

  const renameInput = window.prompt(
    `A recording named "${fileName}" already exists. Rename the existing saved recording to (leave blank to overwrite):`
  );

  if (renameInput === null) {
    return false;
  }

  if (renameInput.trim() === "") {
    return true;
  }

  const renameFileName = toRecordingFileName(renameInput);
  if (!renameFileName) {
    window.alert("Recording names cannot be empty or contain path separators.");
    return await resolveRecordingNameConflict(fileName);
  }

  if (renameFileName === fileName) {
    return await resolveRecordingNameConflict(fileName);
  }

  if (!(await resolveRecordingNameConflict(renameFileName))) {
    return false;
  }

  await renameRecording(fileName, renameFileName);
  return true;
}

function toRecordingFileName(input: string) {
  const trimmed = input.trim();

  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }

  return `${trimmed}.json`;
}

function roundTrackTime(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value * 1000) / 1000);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadPlayTrack(trackId: string): Promise<PlayTrack> {
  const [metadata, outputMetadata] = await Promise.all([
    readTrackMetadata(trackId),
    readTrackOutputMetadata(trackId)
  ]);
  const trackMetadata = isRecord(metadata) ? metadata : null;

  return {
    trackId,
    trackName: readString(trackMetadata?.trackName),
    trackArtist: readString(trackMetadata?.trackArtist),
    trackArtworkSrc: readString(trackMetadata?.trackArtworkSrc),
    metadata: trackMetadata,
    outputMetadata: isRecord(outputMetadata) ? outputMetadata : null
  };
}

function readSpotifyPathHash() {
  return decodeURIComponent(window.location.hash.replace(/^#/, ""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}
