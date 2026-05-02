import { useEffect, useState } from "react";

import Player from "../features/stems/player/Player";
import {
  readTrackPlaybackRecord,
  readSpotifyContext,
  readTrackMetadata,
  readTrackOutputMetadata,
  type LocalPlaybackRecord,
  type SavedSpotifyContext
} from "./iframeArtifacts";

type PlayTrack = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  outputMetadata: Record<string, unknown> | null;
};

const emptyPlaybackRecord = (trackId: string): LocalPlaybackRecord => ({
  md5: trackId,
  files: []
});

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          return;
        }

        const nextRecord = await readSpotifyContext(spotifyPath);
        if (!nextRecord) {
          setRecord(null);
          setTracks([]);
          setActiveTrackIndex(0);
          return;
        }

        const nextTracks = await Promise.all(nextRecord.tracks.map(loadPlayTrack));
        if (!cancelled) {
          setRecord(nextRecord);
          setTracks(nextTracks);
          setActiveTrackIndex(0);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setRecord(null);
          setTracks([]);
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

  const playbackRecord = activeTrack
    ? activePlaybackRecord ?? emptyPlaybackRecord(activeTrack.trackId)
    : null;
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
                spotifyTrackId={activeTrack?.trackId}
                trackArtworkSrc={activeTrack?.trackArtworkSrc}
                unavailableMessage={activeUnavailableMessage}
                hasPreviousTrack={activeTrackIndex > 0}
                hasNextTrack={activeTrackIndex < tracks.length - 1}
                onPreviousTrack={() => setActiveTrackIndex((index) => Math.max(0, index - 1))}
                onNextTrack={() =>
                  setActiveTrackIndex((index) => Math.min(tracks.length - 1, index + 1))
                }
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
                    onClick={() => setActiveTrackIndex(index)}
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
