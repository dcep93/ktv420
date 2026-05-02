import { useEffect, useState } from "react";

import {
  readSpotifyContext,
  readTrackManifest,
  readTrackOutputMetadata,
  type SavedSpotifyContext
} from "./iframeArtifacts";

type PlayTrack = {
  trackId: string;
  trackName: string;
  trackArtist: string;
  trackArtworkSrc: string;
  outputMetadata: Record<string, unknown> | null;
};

export default function PlayPage() {
  const [spotifyPath, setSpotifyPath] = useState(readSpotifyPathHash);
  const [record, setRecord] = useState<SavedSpotifyContext | null>(null);
  const [tracks, setTracks] = useState<PlayTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleHashChange = () => setSpotifyPath(readSpotifyPathHash());
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
          return;
        }

        const nextRecord = await readSpotifyContext(spotifyPath);
        if (!nextRecord) {
          setRecord(null);
          setTracks([]);
          return;
        }

        const nextTracks = await Promise.all(nextRecord.tracks.map(loadPlayTrack));
        if (!cancelled) {
          setRecord(nextRecord);
          setTracks(nextTracks);
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

  return (
    <main className="standalone-page" aria-label="ktv420 play">
      <header className="standalone-header">
        <h1>{spotifyPath || "Play"}</h1>
        {record ? <span>{record.tracks.length} track(s)</span> : null}
      </header>
      {error ? (
        <p className="settings-error">{error}</p>
      ) : loading ? (
        <p className="settings-empty">Loading...</p>
      ) : !record ? (
        <p className="settings-empty">No saved tracklist found.</p>
      ) : (
        <ol className="play-track-list">
          {tracks.map((track, index) => (
            <li className="play-track-row" key={`${track.trackId}-${index}`}>
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
                {track.outputMetadata ? "ready" : "missing output"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

async function loadPlayTrack(trackId: string): Promise<PlayTrack> {
  const [manifest, outputMetadata] = await Promise.all([
    readTrackManifest(trackId),
    readTrackOutputMetadata(trackId)
  ]);
  const metadata = isRecord(manifest) && isRecord(manifest.metadata) ? manifest.metadata : null;

  return {
    trackId,
    trackName: readString(metadata?.trackName),
    trackArtist: readString(metadata?.trackArtist),
    trackArtworkSrc: readString(metadata?.trackArtworkSrc),
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
