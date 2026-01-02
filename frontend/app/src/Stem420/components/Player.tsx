import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TrackRow } from "./player/TrackRow";
import { drawVisualizer } from "./player/visualizers";
import {
  AMPLITUDE_WINDOW_SECONDS,
  type CachedTrackFile,
  type PlayerProps,
  type Track,
  type VisualizerType,
} from "./player/types";

export default function Player({ record, onClose }: PlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackDurations, setTrackDurations] = useState<Record<string, number>>(
    {}
  );
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [amplitudeEnvelopes, setAmplitudeEnvelopes] = useState<
    Record<string, number[]>
  >({});
  const [amplitudeMaximums, setAmplitudeMaximums] = useState<
    Record<string, number>
  >({});
  const [visualizerType, setVisualizerType] =
    useState<VisualizerType>("laser-ladders");
  const [trackMuteStates, setTrackMuteStates] = useState<Record<string, boolean>>({});
  const [trackDeafenStates, setTrackDeafenStates] =
    useState<Record<string, boolean>>({});
  const isAnyTrackDeafened = useMemo(
    () => Object.values(trackDeafenStates).some(Boolean),
    [trackDeafenStates]
  );

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const durationMap = useRef<Record<string, number>>({});
  const audioContexts = useRef<Record<string, AudioContext | null>>({});
  const analyserNodes = useRef<Record<string, AnalyserNode | null>>({});
  const sourceNodes = useRef<
    Record<string, MediaElementAudioSourceNode | null>
  >({});
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const animationFrameRef = useRef<number | null>(null);
  const syncAnimationFrameRef = useRef<number | null>(null);
  const suppressSyncUntilRef = useRef<number>(0);
  const seekingRef = useRef(false);
  const isPlayingRef = useRef(false);
  const isDraggingSeekRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);

  const tracks = useMemo<Track[]>(() => {
    return record.files
      .filter(
        (file: CachedTrackFile) => !file.name.toLowerCase().endsWith(".json")
      )
      .map((file: CachedTrackFile, index: number) => ({
        id: `${record.md5}-${index}`,
        name: file.name,
        path: file.path,
        isInput: file.path.includes("/input/"),
        url: URL.createObjectURL(file.blob),
        blob: file.blob,
      }));
  }, [record]);

  const primaryTrack = tracks.find((track) => track.isInput) ?? tracks[0];
  const primaryTrackId = primaryTrack?.id ?? null;
  const playerTitle = primaryTrack?.name ?? "Playback";

  const trackLookup = useMemo(() => {
    return tracks.reduce<Record<string, Track>>((lookup, track) => {
      lookup[track.id] = track;
      return lookup;
    }, {});
  }, [tracks]);

  const getEffectiveVolume = useCallback(
    (trackId: string, baseVolume?: number) => {
      const track = trackLookup[trackId];
      const volume = baseVolume ?? volumes[trackId] ?? 1;

      if (!track) {
        return volume;
      }

      const isTrackMuted = trackMuteStates[trackId];
      const isTrackDeafened = trackDeafenStates[trackId];

      if (isTrackMuted) {
        return 0;
      }

      if (isAnyTrackDeafened && !isTrackDeafened) {
        return 0;
      }

      return volume;
    },
    [isAnyTrackDeafened, trackDeafenStates, trackLookup, trackMuteStates, volumes]
  );

  useEffect(() => {
    const audioContextsSnapshot = audioContexts.current;

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      if (syncAnimationFrameRef.current !== null) {
        cancelAnimationFrame(syncAnimationFrameRef.current);
      }

      Object.values(audioContextsSnapshot).forEach((context) => {
        context?.close().catch((error) => {
          console.error("Failed to close audio context", error);
        });
      });
    };
  }, []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const initialVolumes: Record<string, number> = {};

    for (const track of tracks) {
      initialVolumes[track.id] = 1;
    }

    setVolumes(initialVolumes);
    setCurrentTime(0);
    setDuration(0);
    setTrackDurations({});
    setIsPlaying(false);
    setTrackMuteStates({});
    setTrackDeafenStates({});
    durationMap.current = {};

    const audioRefsSnapshot = audioRefs.current;

    return () => {
      tracks.forEach((track) => {
        URL.revokeObjectURL(track.url);
        const audio = audioRefsSnapshot[track.id];

        if (audio) {
          audio.pause();
        }
      });
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tracks]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    let isCancelled = false;
    const analysisContext = new AudioContext();

    const analyzeTrack = async (track: Track) => {
      try {
        const audioBuffer = await analysisContext.decodeAudioData(
          (await track.blob.arrayBuffer()).slice(0)
        );

        const windowSize = Math.max(
          1,
          Math.floor(audioBuffer.sampleRate * AMPLITUDE_WINDOW_SECONDS)
        );
        const envelope: number[] = [];
        const channelCount = audioBuffer.numberOfChannels;
        const totalWindows = Math.ceil(audioBuffer.length / windowSize);

        for (let windowIndex = 0; windowIndex < totalWindows; windowIndex++) {
          let sumSquares = 0;
          const start = windowIndex * windowSize;
          const end = Math.min(start + windowSize, audioBuffer.length);

          for (let channel = 0; channel < channelCount; channel++) {
            const channelData = audioBuffer.getChannelData(channel);
            for (let i = start; i < end; i++) {
              sumSquares += channelData[i]! * channelData[i]!;
            }
          }

          const sampleCount = (end - start) * channelCount;
          const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
          envelope.push(rms);
        }

        if (isCancelled) {
          return;
        }

        const peak = envelope.reduce((max, value) => Math.max(max, value), 0);
        setAmplitudeMaximums((previous) => ({
          ...previous,
          [track.id]: peak > 0 ? peak : 1,
        }));
        setAmplitudeEnvelopes((previous) => ({
          ...previous,
          [track.id]: envelope,
        }));
      } catch (error) {
        console.error("Failed to analyze track envelope", track.name, error);
      }
    };

    setAmplitudeEnvelopes({});
    setAmplitudeMaximums({});
    tracks.forEach((track) => {
      void analyzeTrack(track);
    });

    return () => {
      isCancelled = true;
      void analysisContext.close();
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tracks]);

  useEffect(() => {
    tracks.forEach((track) => {
      const audio = audioRefs.current[track.id];

      if (!audio) {
        return;
      }

      audio.volume = getEffectiveVolume(track.id);
    });
  }, [getEffectiveVolume, tracks]);

  useEffect(() => {
    if (!primaryTrackId) {
      return;
    }

    const primaryAudio = audioRefs.current[primaryTrackId];

    if (!primaryAudio) {
      return;
    }

    const handleLoadedMetadata = () => {
      durationMap.current[primaryTrackId] = primaryAudio.duration;
      setTrackDurations((previous) => ({
        ...previous,
        [primaryTrackId]: primaryAudio.duration,
      }));
      const durations = Object.values(durationMap.current);
      const maxDuration = durations.length
        ? Math.max(...durations)
        : primaryAudio.duration;

      setDuration(Number.isFinite(maxDuration) ? maxDuration : 0);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    primaryAudio.addEventListener("loadedmetadata", handleLoadedMetadata);
    primaryAudio.addEventListener("ended", handleEnded);

    return () => {
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
        setTrackDurations((previous) => ({
          ...previous,
          [track.id]: audio.duration,
        }));
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

  useEffect(() => {
    isPlayingRef.current = isPlaying;

    if (!isPlaying) {
      Object.values(audioRefs.current).forEach((audio) => {
        if (audio) {
          audio.playbackRate = 1;
        }
      });
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!primaryTrackId) {
      return undefined;
    }

    const syncTracks = () => {
      const primaryAudio = audioRefs.current[primaryTrackId];

      if (!primaryAudio) {
        syncAnimationFrameRef.current = null;
        return;
      }

      setCurrentTime(primaryAudio.currentTime);

      const now = performance.now();
      const suppressSync = seekingRef.current || now < suppressSyncUntilRef.current;

      Object.entries(audioRefs.current).forEach(([id, audio]) => {
        if (!audio || id === primaryTrackId) {
          return;
        }

        const drift = audio.currentTime - primaryAudio.currentTime;
        const absDrift = Math.abs(drift);

        if (!isPlayingRef.current || suppressSync) {
          audio.playbackRate = 1;
          return;
        }

        if (absDrift > 0.05) {
          audio.currentTime = primaryAudio.currentTime;
          audio.playbackRate = 1;
          return;
        }

        if (absDrift > 0.01) {
          const ratio = Math.min(absDrift, 0.05) / 0.05;
          const adjustment = ratio * 0.02;
          const direction = drift > 0 ? -1 : 1;
          const nextRate = Math.min(
            1.02,
            Math.max(0.98, 1 + direction * adjustment)
          );

          audio.playbackRate = nextRate;
          return;
        }

        audio.playbackRate = 1;
      });

      syncAnimationFrameRef.current = requestAnimationFrame(syncTracks);
    };

    if (isPlaying) {
      syncAnimationFrameRef.current = requestAnimationFrame(syncTracks);
    } else if (syncAnimationFrameRef.current !== null) {
      cancelAnimationFrame(syncAnimationFrameRef.current);
      syncAnimationFrameRef.current = null;
    }

    return () => {
      if (syncAnimationFrameRef.current !== null) {
        cancelAnimationFrame(syncAnimationFrameRef.current);
        syncAnimationFrameRef.current = null;
      }
    };
  }, [isPlaying, primaryTrackId, tracks]);

  useEffect(() => {
    const cleanups = tracks.map((track) => {
      if (track.id === primaryTrackId) {
        return undefined;
      }

      const audio = audioRefs.current[track.id];

      if (!audio) {
        return undefined;
      }

      const handleRecovery = () => {
        const primaryAudio = primaryTrackId
          ? audioRefs.current[primaryTrackId]
          : null;

        if (!primaryAudio || !isPlayingRef.current) {
          return;
        }

        const drift = audio.currentTime - primaryAudio.currentTime;

        if (Math.abs(drift) > 0.03) {
          audio.currentTime = primaryAudio.currentTime;
          audio.playbackRate = 1;
        }
      };

      audio.addEventListener("playing", handleRecovery);
      audio.addEventListener("canplay", handleRecovery);

      return () => {
        audio.removeEventListener("playing", handleRecovery);
        audio.removeEventListener("canplay", handleRecovery);
      };
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup && cleanup());
    };
  }, [primaryTrackId, tracks]);

  useEffect(() => {
    const activeIds = new Set(tracks.map((track) => track.id));

    Object.keys(audioContexts.current).forEach((id) => {
      if (activeIds.has(id)) {
        return;
      }

      audioContexts.current[id]?.close().catch((error) => {
        console.error("Failed to close audio context", error);
      });
      delete audioContexts.current[id];
      delete analyserNodes.current[id];
      delete sourceNodes.current[id];
      delete canvasRefs.current[id];
    });

    const ensureAnalyser = (track: Track) => {
      const audio = audioRefs.current[track.id];

      if (!audio) {
        return null;
      }

      const existingAnalyser = analyserNodes.current[track.id];

      if (existingAnalyser) {
        const context = audioContexts.current[track.id];

        if (context?.state === "suspended") {
          void context.resume();
        }

        return existingAnalyser;
      }

      const context = new AudioContext();
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();

      analyser.fftSize = 2048;
      source.connect(analyser);
      analyser.connect(context.destination);

      audioContexts.current[track.id] = context;
      analyserNodes.current[track.id] = analyser;
      sourceNodes.current[track.id] = source;

      return analyser;
    };

    const draw = () => {
      tracks.forEach((track) => {
        const analyser = ensureAnalyser(track);
        const canvas = canvasRefs.current[track.id];
        const audio = audioRefs.current[track.id];

        if (!analyser || !canvas || !audio) {
          return;
        }

        const sampleRate = audioContexts.current[track.id]?.sampleRate ?? 44100;
        drawVisualizer({
          analyser,
          canvas,
          audio,
          visualizerType,
          amplitudeEnvelope: amplitudeEnvelopes[track.id],
          amplitudeMaximum: amplitudeMaximums[track.id],
          sampleRate,
        });
      });

      animationFrameRef.current = requestAnimationFrame(draw);
    };


    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    tracks,
    visualizerType,
    amplitudeEnvelopes,
    amplitudeMaximums,
  ]);

  useEffect(() => {
    const resizeCanvases = () => {
      Object.values(canvasRefs.current).forEach((canvas) => {
        if (!canvas) {
          return;
        }

        const parentWidth = canvas.parentElement?.clientWidth ?? window.innerWidth;
        const nextWidth = Math.max(0, Math.floor(parentWidth));

        if (nextWidth && canvas.width !== nextWidth) {
          canvas.width = nextWidth;
        }
      });
    };

    resizeCanvases();
    window.addEventListener("resize", resizeCanvases);

    return () => {
      window.removeEventListener("resize", resizeCanvases);
    };
  }, [tracks]);

  const commitSeek = useCallback(
    async (targetTime: number) => {
      if (!primaryTrackId) {
        setCurrentTime(targetTime);
        return;
      }

      seekingRef.current = true;
      suppressSyncUntilRef.current = performance.now() + 250;
      const wasPlaying = isPlayingRef.current;

      Object.values(audioRefs.current).forEach((audio) => {
        if (!audio) {
          return;
        }

        audio.pause();
        audio.playbackRate = 1;
      });

      const seekPromises = Object.values(audioRefs.current).map((audio) => {
        if (!audio) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          const handleSeeked = () => {
            finalize();
          };

          const timeoutId = window.setTimeout(handleSeeked, 500);

          const finalize = () => {
            window.clearTimeout(timeoutId);

            audio.removeEventListener("seeked", handleSeeked);
            audio.removeEventListener("error", handleSeeked);
            resolve();
          };

          audio.addEventListener("seeked", handleSeeked);
          audio.addEventListener("error", handleSeeked);

          audio.currentTime = targetTime;
        });
      });

      await Promise.all(seekPromises);

      seekingRef.current = false;
      suppressSyncUntilRef.current = performance.now() + 250;

      const primaryAudio = audioRefs.current[primaryTrackId];

      setCurrentTime(targetTime);

      if (!primaryAudio) {
        return;
      }

      if (wasPlaying) {
        try {
          await primaryAudio.play();
        } catch (error) {
          console.error("Failed to resume primary track after seek", error);
          setIsPlaying(false);
          return;
        }

        const secondaryPromises = Object.entries(audioRefs.current).map(
          async ([id, audio]) => {
            if (!audio || id === primaryTrackId) {
              return;
            }

            audio.currentTime = primaryAudio.currentTime;
            audio.playbackRate = 1;

            try {
              await audio.play();
            } catch (error) {
              console.error("Failed to resume track after seek", error);
            }
          }
        );

        await Promise.all(secondaryPromises);
        setIsPlaying(true);
      } else {
        Object.values(audioRefs.current).forEach((audio) => {
          if (!audio) {
            return;
          }

          audio.currentTime = targetTime;
          audio.playbackRate = 1;
        });
      }
    },
    [primaryTrackId]
  );

  const handleSeekChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(event.target.value);
    setCurrentTime(newTime);
    pendingSeekRef.current = newTime;

    if (!isDraggingSeekRef.current) {
      void commitSeek(newTime);
    }
  };

  const handleSeekStart = () => {
    isDraggingSeekRef.current = true;
  };

  const handleSeekEnd = () => {
    isDraggingSeekRef.current = false;
    const pending = pendingSeekRef.current;

    if (pending !== null) {
      void commitSeek(pending);
    }

    pendingSeekRef.current = null;
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
      audio.volume = getEffectiveVolume(track.id);

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
    const track = trackLookup[trackId];

    if (!audio || !track) {
      return;
    }

    audio.volume = getEffectiveVolume(trackId, value);
  };

  const toggleTrackMute = (trackId: string) => {
    setTrackMuteStates((previous) => ({
      ...previous,
      [trackId]: !previous[trackId],
    }));
    const audio = audioRefs.current[trackId];

    if (audio) {
      audio.volume = getEffectiveVolume(trackId);
    }
  };

  const toggleTrackDeafen = (trackId: string) => {
    setTrackDeafenStates((previous) => ({
      ...previous,
      [trackId]: !previous[trackId],
    }));
    const audio = audioRefs.current[trackId];

    if (audio) {
      audio.volume = getEffectiveVolume(trackId);
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
    <div
      style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #444" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3 style={{ margin: 0 }}>{playerTitle}</h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div
        style={{
          marginTop: "0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeekChange}
          onPointerDown={handleSeekStart}
          onPointerUp={handleSeekEnd}
          onPointerCancel={handleSeekEnd}
          style={{
            width: "60%",
            minWidth: "240px",
            verticalAlign: "middle",
          }}
        />
        <span style={{ marginRight: "0.5rem" }}>
          {formattedTime(currentTime)} / {formattedTime(duration)}
        </span>
      </div>
      <div style={{ marginTop: "0.5rem" }}>
        <button type="button" onClick={() => void handlePlayPause()}>
          {isPlaying ? "Pause" : "Play"}
        </button>
      </div>
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
        <label htmlFor="visualizer-type" style={{ fontWeight: 600 }}>
          Visualizer
        </label>
        <select
          id="visualizer-type"
          value={visualizerType}
          onChange={(event) =>
            setVisualizerType(event.target.value as VisualizerType)
          }
        >
          <option value="laser-ladders">Laser Ladders (Graphic EQ)</option>
          <option value="spectrum-safari">Spectrum Safari (Analyzer)</option>
          <option value="waveform-waterline">
            Waveform Waterline (Oscilloscope)
          </option>
          <option value="aurora-radar">Aurora Radar (Radial Sweep)</option>
          <option value="mirror-peaks">Mirror Peaks (Symmetric Bars)</option>
          <option value="pulse-grid">Pulse Grid (Energy Matrix)</option>
          <option value="luminous-orbit">Luminous Orbit (Layered Rings)</option>
          <option value="nebula-trails">Nebula Trails (Shimmering Path)</option>
          <option value="time-ribbon">Time Ribbon (Amplitude Timeline)</option>
        </select>
      </div>
      <div style={{ marginTop: "1rem" }}>
        {tracks.map((track) => {
          const trackDuration = trackDurations[track.id];
          const durationLabel = Number.isFinite(trackDuration)
            ? `${trackDuration.toFixed(4)}s`
            : "Loading duration...";

          return (
            <TrackRow
              key={track.id}
              track={track}
              durationLabel={durationLabel}
              volume={volumes[track.id] ?? 1}
              isMuted={!!trackMuteStates[track.id]}
              isDeafened={!!trackDeafenStates[track.id]}
              onVolumeChange={handleVolumeChange}
              onToggleMute={toggleTrackMute}
              onToggleDeafen={toggleTrackDeafen}
              registerCanvas={(ref) => {
                canvasRefs.current[track.id] = ref;
              }}
              registerAudio={(ref) => {
                audioRefs.current[track.id] = ref;
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
