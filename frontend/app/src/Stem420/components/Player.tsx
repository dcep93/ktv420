import { useEffect, useMemo, useRef, useState } from "react";

import { type CachedOutputRecord } from "../indexedDbClient";

type VisualizerType =
  | "laser-ladders"
  | "spectrum-safari"
  | "time-ribbon";

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
  blob: Blob;
};

const PAST_WINDOW_SECONDS = 5;
const FUTURE_WINDOW_SECONDS = 25;
const AMPLITUDE_WINDOW_SECONDS = 0.05;

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

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const durationMap = useRef<Record<string, number>>({});
  const audioContexts = useRef<Record<string, AudioContext | null>>({});
  const analyserNodes = useRef<Record<string, AnalyserNode | null>>({});
  const sourceNodes = useRef<
    Record<string, MediaElementAudioSourceNode | null>
  >({});
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const animationFrameRef = useRef<number | null>(null);

  const tracks = useMemo<Track[]>(() => {
    return record.files
      .filter((file) => !file.name.toLowerCase().endsWith(".json"))
      .map((file, index) => ({
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

  useEffect(() => {
    const audioContextsSnapshot = audioContexts.current;

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
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

        if (Math.abs(audio.currentTime - primaryAudio.currentTime) > 0.01) {
          audio.currentTime = primaryAudio.currentTime;
        }
      });
    };

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

        const context = canvas.getContext("2d");

        if (!context) {
          return;
        }

        const { width, height } = canvas;
        context.clearRect(0, 0, width, height);

        const timeDisplay = `${audio.currentTime.toFixed(2)}s / ${Math.max(
          audio.duration,
          duration || 0
        ).toFixed(2)}s`;

        context.fillStyle = "#0a0a0a";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#999";
        context.font = "12px sans-serif";
        context.fillText(timeDisplay, 10, 16);

        if (visualizerType === "laser-ladders") {
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteFrequencyData(dataArray);
          const barWidth = (width / bufferLength) * 2.5;

          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i];
            const gradient = context.createLinearGradient(
              0,
              height,
              0,
              height - barHeight
            );
            gradient.addColorStop(0, "#1dd3b0");
            gradient.addColorStop(1, "#6c43f3");
            context.fillStyle = gradient;
            context.fillRect(x, height - barHeight, barWidth - 1, barHeight);
            x += barWidth;
          }
        } else if (visualizerType === "spectrum-safari") {
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteFrequencyData(dataArray);
          const sliceWidth = width / bufferLength;
          context.beginPath();
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 255;
            const y = height - v * height;
            if (i === 0) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }
            x += sliceWidth;
          }

          context.strokeStyle = "#f2b705";
          context.lineWidth = 2;
          context.stroke();
          context.fillStyle = "rgba(242, 183, 5, 0.15)";
          context.fill();
        } else {
          const envelope = amplitudeEnvelopes[track.id];
          const maxAmplitude = amplitudeMaximums[track.id] ?? 1;
          const totalWindowSeconds = PAST_WINDOW_SECONDS + FUTURE_WINDOW_SECONDS;
          const baseY = height - 24;
          const ribbonHeight = height - 40;

          context.fillStyle = "#070b14";
          context.fillRect(0, 0, width, height);

          context.strokeStyle = "rgba(255, 255, 255, 0.08)";
          context.lineWidth = 1;
          const subtleGap = 48;
          for (let x = 0; x < width; x += subtleGap) {
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, height);
            context.stroke();
          }

          if (!envelope || !envelope.length) {
            context.fillStyle = "#ccc";
            context.font = "12px sans-serif";
            context.fillText(
              "Analyzing track envelope for ribbon view...",
              10,
              baseY
            );
            return;
          }

          const amplitudeAtTime = (time: number) => {
            const index = time / AMPLITUDE_WINDOW_SECONDS;
            const baseIndex = Math.floor(index);
            const nextIndex = Math.min(baseIndex + 1, envelope.length - 1);
            const fraction = index - baseIndex;
            const first = envelope[Math.max(0, Math.min(baseIndex, envelope.length - 1))] ?? 0;
            const second = envelope[nextIndex] ?? first;
            return first + (second - first) * fraction;
          };

          const centerX = (PAST_WINDOW_SECONDS / totalWindowSeconds) * width;
          const gradient = context.createLinearGradient(0, 0, width, 0);
          gradient.addColorStop(0, "#1dd3b0");
          gradient.addColorStop(0.5, "#f2b705");
          gradient.addColorStop(1, "#6c43f3");

          context.beginPath();

          for (let x = 0; x <= width; x += 2) {
            const timeOffset = (x / width) * totalWindowSeconds - PAST_WINDOW_SECONDS;
            const sampleTime = audio.currentTime + timeOffset;
            const amplitude =
              sampleTime >= 0
                ? amplitudeAtTime(sampleTime)
                : amplitudeAtTime(0);
            const normalized = Math.min(1, amplitude / maxAmplitude);
            const y = baseY - normalized * ribbonHeight;

            if (x === 0) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }
          }

          context.strokeStyle = gradient;
          context.lineWidth = 3;
          context.stroke();

          context.lineTo(width, baseY);
          context.lineTo(0, baseY);
          context.closePath();
          context.fillStyle = "rgba(29, 211, 176, 0.08)";
          context.fill();

          context.strokeStyle = "rgba(255, 255, 255, 0.65)";
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(centerX, 0);
          context.lineTo(centerX, height);
          context.stroke();
        }
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
    duration,
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

    if (!audio) {
      return;
    }

    audio.volume = value;
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
        <h3 style={{ margin: 0 }}>Cached Player for {record.md5}</h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          onClick={() => void handlePlayPause()}
          style={{ marginRight: "0.5rem" }}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={handleSeek}
          style={{
            width: "60%",
            marginRight: "0.5rem",
            verticalAlign: "middle",
          }}
        />
        <span>
          {formattedTime(currentTime)} / {formattedTime(duration)}
        </span>
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
          <option value="time-ribbon">Time Ribbon (Amplitude Timeline)</option>
        </select>
      </div>
      <div style={{ marginTop: "1rem" }}>
        {tracks.map((track) => {
          const label = track.isInput
            ? `Input: ${track.name}`
            : `Output: ${track.name}`;
          const trackDuration = trackDurations[track.id];
          const durationLabel = Number.isFinite(trackDuration)
            ? `${trackDuration.toFixed(4)}s`
            : "Loading duration...";

          return (
            <div key={track.id} style={{ marginBottom: "0.75rem" }}>
              <div style={{ marginBottom: "0.25rem" }}>
                {label} <span style={{ color: "#aaa" }}>({durationLabel})</span>
              </div>
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
              <div style={{ marginTop: "0.4rem" }}>
                <canvas
                  ref={(ref) => {
                    canvasRefs.current[track.id] = ref;
                  }}
                  width={520}
                  height={120}
                  style={{
                    border: "1px solid #333",
                    background: "linear-gradient(90deg, #0b0f19, #0f0b19)",
                    width: "100%",
                    display: "block",
                  }}
                />
              </div>
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
