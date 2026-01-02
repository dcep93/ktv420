import { useEffect, useMemo, useRef, useState } from "react";

import { type CachedOutputRecord } from "../indexedDbClient";

type PlayerProps = {
  record: CachedOutputRecord;
  onClose: () => void;
};

type Track = {
  id: string;
  name: string;
  path: string;
  isInput: boolean;
  url: string;
};

export default function Player({ record, onClose }: PlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumes, setVolumes] = useState<Record<string, number>>({});

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const durationMap = useRef<Record<string, number>>({});

  const tracks = useMemo<Track[]>(() => {
    return record.files
      .filter((file) => file.name.toLowerCase().endsWith(".mp3"))
      .map((file, index) => ({
        id: `${record.md5}-${index}`,
        name: file.name,
        path: file.path,
        isInput: file.path.includes("/input/"),
        url: URL.createObjectURL(file.blob),
      }));
  }, [record]);

  const primaryTrack = tracks.find((track) => track.isInput) ?? tracks[0];
  const primaryTrackId = primaryTrack?.id ?? null;

  useEffect(() => {
    const initialVolumes: Record<string, number> = {};

    for (const track of tracks) {
      initialVolumes[track.id] = 1;
    }

    setVolumes(initialVolumes);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    durationMap.current = {};

    return () => {
      tracks.forEach((track) => {
        URL.revokeObjectURL(track.url);
        const audio = audioRefs.current[track.id];

        if (audio) {
          audio.pause();
        }
      });
    };
  }, [tracks]);

  useEffect(() => {
    if (!primaryTrackId) {
      return;
    }

    const primaryAudio = audioRefs.current[primaryTrackId];

    if (!primaryAudio) {
      return;
    }

    const handleTimeUpdate = () => {
      setCurrentTime(primaryAudio.currentTime);

      Object.entries(audioRefs.current).forEach(([id, audio]) => {
        if (!audio || id === primaryTrackId) {
          return;
        }

        if (Math.abs(audio.currentTime - primaryAudio.currentTime) > 0.05) {
          audio.currentTime = primaryAudio.currentTime;
        }
      });
    };

    const handleLoadedMetadata = () => {
      durationMap.current[primaryTrackId] = primaryAudio.duration;
      const durations = Object.values(durationMap.current);
      const maxDuration = durations.length
        ? Math.max(...durations)
        : primaryAudio.duration;

      setDuration(Number.isFinite(maxDuration) ? maxDuration : 0);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    primaryAudio.addEventListener("timeupdate", handleTimeUpdate);
    primaryAudio.addEventListener("loadedmetadata", handleLoadedMetadata);
    primaryAudio.addEventListener("ended", handleEnded);

    return () => {
      primaryAudio.removeEventListener("timeupdate", handleTimeUpdate);
      primaryAudio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      primaryAudio.removeEventListener("ended", handleEnded);
    };
  }, [primaryTrackId]);

  useEffect(() => {
    const cleanups = tracks.map((track) => {
      const audio = audioRefs.current[track.id];

      if (!audio) {
        return undefined;
      }

      const handleMetadata = () => {
        durationMap.current[track.id] = audio.duration;
        const durations = Object.values(durationMap.current);
        const maxDuration = durations.length ? Math.max(...durations) : 0;
        setDuration(Number.isFinite(maxDuration) ? maxDuration : 0);
      };

      audio.addEventListener("loadedmetadata", handleMetadata);

      return () => {
        audio.removeEventListener("loadedmetadata", handleMetadata);
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup && cleanup());
    };
  }, [tracks]);

  const updateAllCurrentTime = (newTime: number) => {
    Object.values(audioRefs.current).forEach((audio) => {
      if (!audio) {
        return;
      }

      audio.currentTime = newTime;
    });
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(event.target.value);
    setCurrentTime(newTime);
    updateAllCurrentTime(newTime);
  };

  const handlePlayPause = async () => {
    if (!primaryTrackId) {
      return;
    }

    const nextPlaying = !isPlaying;

    if (!nextPlaying) {
      setIsPlaying(false);
      Object.values(audioRefs.current).forEach((audio) => audio?.pause());
      return;
    }

    const playPromises = tracks.map((track) => {
      const audio = audioRefs.current[track.id];

      if (!audio) {
        return Promise.resolve();
      }

      audio.currentTime = currentTime;
      audio.volume = volumes[track.id] ?? 1;

      return audio.play();
    });

    try {
      await Promise.all(playPromises);
      setIsPlaying(true);
    } catch (error) {
      console.error("Failed to play audio", error);
      setIsPlaying(false);
    }
  };

  const handleVolumeChange = (trackId: string, value: number) => {
    setVolumes((previous) => ({ ...previous, [trackId]: value }));
    const audio = audioRefs.current[trackId];

    if (audio) {
      audio.volume = value;
    }
  };

  const formattedTime = (time: number) => {
    const safeTime = Math.max(0, Math.floor(time));
    const minutes = Math.floor(safeTime / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (safeTime % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  if (!tracks.length) {
    return null;
  }

  return (
    <div style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #444" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Cached Player for {record.md5}</h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={() => void handlePlayPause()} style={{ marginRight: "0.5rem" }}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          style={{ width: "60%", marginRight: "0.5rem", verticalAlign: "middle" }}
        />
        <span>
          {formattedTime(currentTime)} / {formattedTime(duration)}
        </span>
      </div>
      <div style={{ marginTop: "1rem" }}>
        {tracks.map((track) => {
          const label = track.isInput ? `Input: ${track.name}` : `Output: ${track.name}`;

          return (
            <div key={track.id} style={{ marginBottom: "0.75rem" }}>
              <div style={{ marginBottom: "0.25rem" }}>{label}</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volumes[track.id] ?? 1}
                onChange={(event) =>
                  handleVolumeChange(track.id, Number(event.target.value))
                }
                style={{ width: "50%" }}
              />
              <audio
                ref={(ref) => {
                  audioRefs.current[track.id] = ref;
                }}
                src={track.url}
                preload="auto"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
