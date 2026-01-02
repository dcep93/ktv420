import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { removeCachedOutputs } from "../indexedDbClient";
import { TrackRow } from "./player/TrackRow";
import {
  AMPLITUDE_WINDOW_SECONDS,
  type CachedTrackFile,
  type PlayerProps,
  type Track,
  type VisualizerType,
} from "./player/types";
import { drawVisualizer } from "./player/visualizers";

const visualizerOptions: Array<{
  value: VisualizerType;
  label: string;
  hint: string;
}> = [
  { value: "time-ribbon", label: "Time Ribbon", hint: "Amplitude Timeline" },
  { value: "laser-ladders", label: "Laser Ladders", hint: "Graphic EQ" },
  { value: "spectrum-safari", label: "Spectrum Safari", hint: "Analyzer" },
  {
    value: "waveform-waterline",
    label: "Waveform Waterline",
    hint: "Oscilloscope",
  },
  { value: "aurora-radar", label: "Aurora Radar", hint: "Radial Sweep" },
  { value: "mirror-peaks", label: "Mirror Peaks", hint: "Symmetric Bars" },
  { value: "pulse-grid", label: "Pulse Grid", hint: "Energy Matrix" },
  { value: "luminous-orbit", label: "Luminous Orbit", hint: "Layered Rings" },
  { value: "prism-bloom", label: "Prism Bloom", hint: "Radiant Arcs" },
  {
    value: "cascade-horizon",
    label: "Cascade Horizon",
    hint: "Layered Terrain",
  },
  { value: "nebula-trails", label: "Nebula Trails", hint: "Shimmering Path" },
  { value: "echo-lantern", label: "Echo Lantern", hint: "Glowing Ripples" },
  { value: "ember-mandala", label: "Ember Mandala", hint: "Radiant Petals" },
  { value: "hippie-mirage", label: "Hippie Mirage", hint: "Tie-Dye Bloom" },
  { value: "hollow-echoes", label: "Hollow Echoes", hint: "Stacked Pillars" },
  { value: "opal-current", label: "Opal Current", hint: "Opalescent Waves" },
  { value: "solstice-waves", label: "Solstice Waves", hint: "Solar Horizon" },
  { value: "ripple-weave", label: "Ripple Weave", hint: "Braided Ribbons" },
  { value: "ectoplasm", label: "Ectoplasm", hint: "Plasma Bloom" },
  {
    value: "super-time-ribbon",
    label: "Super Time Ribbon",
    hint: "Shaking Ribbon",
  },
  {
    value: "prismatic-turbine",
    label: "Prismatic Turbine",
    hint: "Whirling Shards",
  },
  { value: "kaleidoscope", label: "Kaleidoscope", hint: "Mirrored Lenses" },
  { value: "highway", label: "Highway", hint: "Retro Neon Run" },
  { value: "delay-pedal", label: "Delay Pedal", hint: "Echo Ripples" },
];

export default function Player({ record, onClose }: PlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [amplitudeEnvelopes, setAmplitudeEnvelopes] = useState<
    Record<string, number[]>
  >({});
  const [amplitudeMaximums, setAmplitudeMaximums] = useState<
    Record<string, number>
  >({});
  const [visualizerType, setVisualizerType] =
    useState<VisualizerType>("time-ribbon");
  const [trackMuteStates, setTrackMuteStates] = useState<
    Record<string, boolean>
  >({});
  const [trackDeafenStates, setTrackDeafenStates] = useState<
    Record<string, boolean>
  >({});
  const [wahPositions, setWahPositions] = useState<Record<string, number>>({});
  const [readyTrackIds, setReadyTrackIds] = useState<string[]>([]);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const isAnyTrackDeafened = useMemo(
    () => Object.values(trackDeafenStates).some(Boolean),
    [trackDeafenStates]
  );

  const volumesRef = useRef<Record<string, number>>({});
  const trackMuteStatesRef = useRef<Record<string, boolean>>({});
  const trackDeafenStatesRef = useRef<Record<string, boolean>>({});
  const wahPositionsRef = useRef<Record<string, number>>({});

  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Record<string, AudioBuffer>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const wahNodesRef = useRef<Record<string, BiquadFilterNode>>({});
  const analyserNodesRef = useRef<Record<string, AnalyserNode>>({});
  const sourcesRef = useRef<Record<string, AudioBufferSourceNode>>({});
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const drawAnimationFrameRef = useRef<number | null>(null);
  const timeAnimationFrameRef = useRef<number | null>(null);
  const isDraggingSeekRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const startAtCtxTimeRef = useRef(0);
  const startOffsetRef = useRef(0);

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
      }))
      .sort((a, b) => {
        if (a.isInput === b.isInput) {
          return a.name.localeCompare(b.name);
        }

        return a.isInput ? 1 : -1;
      });
  }, [record]);

  const primaryTrack = tracks.find((track) => track.isInput) ?? tracks[0];
  const playerTitle = primaryTrack?.name ?? "Playback";

  const trackLookup = useMemo(() => {
    return tracks.reduce<Record<string, Track>>((lookup, track) => {
      lookup[track.id] = track;
      return lookup;
    }, {});
  }, [tracks]);

  const visualizerButtonStyle = useCallback(
    (isActive: boolean): CSSProperties => ({
      borderRadius: "14px",
      border: isActive ? "1px solid #6ddcff" : "1px solid #1f2a3d",
      background: isActive
        ? "linear-gradient(135deg, rgba(37,99,235,0.9), rgba(14,165,233,0.8))"
        : "linear-gradient(135deg, rgba(17,24,39,0.85), rgba(15,23,42,0.9))",
      color: "#e5e7eb",
      padding: "0.65rem 0.85rem",
      minWidth: "200px",
      textAlign: "left",
      boxShadow: isActive
        ? "0 0 0 1px rgba(109,220,255,0.35), 0 16px 40px rgba(0,0,0,0.45)"
        : "0 10px 28px rgba(0,0,0,0.35)",
      cursor: "pointer",
      transition: "all 160ms ease",
    }),
    []
  );

  useEffect(() => {
    volumesRef.current = volumes;
  }, [volumes]);

  useEffect(() => {
    trackMuteStatesRef.current = trackMuteStates;
  }, [trackMuteStates]);

  useEffect(() => {
    trackDeafenStatesRef.current = trackDeafenStates;
  }, [trackDeafenStates]);

  useEffect(() => {
    wahPositionsRef.current = wahPositions;
  }, [wahPositions]);

  const getEffectiveVolumeFromRefs = useCallback(
    (trackId: string, baseVolume?: number) => {
      const track = trackLookup[trackId];
      const volume = baseVolume ?? volumesRef.current[trackId] ?? 1;

      if (!track) {
        return volume;
      }

      const isTrackMuted = trackMuteStatesRef.current[trackId];
      const isTrackDeafened = trackDeafenStatesRef.current[trackId];
      const isAnyDeafened = Object.values(trackDeafenStatesRef.current).some(
        Boolean
      );

      if (isTrackMuted) {
        return 0;
      }

      if (isAnyDeafened && !isTrackDeafened) {
        return 0;
      }

      return volume;
    },
    [trackLookup]
  );

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
    [
      isAnyTrackDeafened,
      trackDeafenStates,
      trackLookup,
      trackMuteStates,
      volumes,
    ]
  );

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }

    return audioCtxRef.current;
  }, []);

  const stopAllSources = useCallback(() => {
    Object.values(sourcesRef.current).forEach((source) => {
      try {
        source.stop();
      } catch (error) {
        console.warn("Failed to stop source", error);
      }
      source.disconnect();
    });

    sourcesRef.current = {};
  }, []);

  const applyEffectiveVolume = useCallback(
    (trackId: string, baseVolume?: number) => {
      const context = audioCtxRef.current ?? ensureAudioContext();
      const gainNode = gainNodesRef.current[trackId];

      if (!context || !gainNode) {
        return;
      }

      const targetVolume = getEffectiveVolume(trackId, baseVolume);
      const now = context.currentTime;

      gainNode.gain.setTargetAtTime(targetVolume, now, 0.01);
    },
    [ensureAudioContext, getEffectiveVolume]
  );

  const applyWahPosition = useCallback(
    (trackId: string, position?: number) => {
      const context = audioCtxRef.current ?? ensureAudioContext();
      const filterNode = wahNodesRef.current[trackId];

      if (!context || !filterNode) {
        return;
      }

      const normalized = Math.min(
        1,
        Math.max(0, position ?? wahPositionsRef.current[trackId] ?? 0.5)
      );
      const offsetFromCenter = normalized - 0.5;
      const minFrequency = 180;
      const maxFrequency = 7200;
      const frequency =
        minFrequency * Math.pow(maxFrequency / minFrequency, normalized);
      const resonance = 1.2 + Math.abs(offsetFromCenter) * 10;
      const gainDb = 12 + Math.abs(offsetFromCenter) * 18;

      filterNode.type = "peaking";
      filterNode.frequency.setTargetAtTime(
        frequency,
        context.currentTime,
        0.01
      );
      filterNode.Q.setTargetAtTime(resonance, context.currentTime, 0.01);
      filterNode.gain.setTargetAtTime(gainDb, context.currentTime, 0.01);
    },
    [ensureAudioContext]
  );

  const currentPlaybackTime = useCallback(() => {
    const context = audioCtxRef.current;

    if (!context) {
      return startOffsetRef.current;
    }

    if (isPlaying) {
      return (
        context.currentTime - startAtCtxTimeRef.current + startOffsetRef.current
      );
    }

    return startOffsetRef.current;
  }, [isPlaying]);

  useEffect(() => {
    const audioContextSnapshot = audioCtxRef.current;

    return () => {
      if (drawAnimationFrameRef.current !== null) {
        cancelAnimationFrame(drawAnimationFrameRef.current);
      }

      if (timeAnimationFrameRef.current !== null) {
        cancelAnimationFrame(timeAnimationFrameRef.current);
      }

      stopAllSources();
      audioContextSnapshot?.close().catch((error) => {
        console.error("Failed to close audio context", error);
      });
    };
  }, [stopAllSources]);

  useEffect(() => {
    const initialVolumes: Record<string, number> = {};
    const initialMuteStates: Record<string, boolean> = {};
    const initialDeafenStates: Record<string, boolean> = {};

    for (const track of tracks) {
      initialVolumes[track.id] = 1;
      initialMuteStates[track.id] = track.isInput;
      initialDeafenStates[track.id] = false;
    }

    volumesRef.current = initialVolumes;
    trackMuteStatesRef.current = initialMuteStates;
    trackDeafenStatesRef.current = initialDeafenStates;

    setVolumes(initialVolumes);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setReadyTrackIds([]);
    setTrackMuteStates(initialMuteStates);
    setTrackDeafenStates(initialDeafenStates);
    setAmplitudeEnvelopes({});
    setAmplitudeMaximums({});
    startOffsetRef.current = 0;
    startAtCtxTimeRef.current = 0;
    stopAllSources();
    buffersRef.current = {};
    gainNodesRef.current = {};
    wahNodesRef.current = {};
    analyserNodesRef.current = {};

    const tracksSnapshot = tracks;

    return () => {
      tracksSnapshot.forEach((track) => {
        URL.revokeObjectURL(track.url);
      });
    };
  }, [stopAllSources, tracks]);

  useEffect(() => {
    const activeIds = new Set(tracks.map((track) => track.id));

    Object.entries(gainNodesRef.current).forEach(([id, gainNode]) => {
      if (!activeIds.has(id)) {
        gainNode.disconnect();
        delete gainNodesRef.current[id];
      }
    });

    Object.entries(wahNodesRef.current).forEach(([id, filter]) => {
      if (!activeIds.has(id)) {
        filter.disconnect();
        delete wahNodesRef.current[id];
      }
    });

    Object.entries(analyserNodesRef.current).forEach(([id, analyser]) => {
      if (!activeIds.has(id)) {
        analyser.disconnect();
        delete analyserNodesRef.current[id];
      }
    });

    Object.keys(buffersRef.current).forEach((id) => {
      if (!activeIds.has(id)) {
        delete buffersRef.current[id];
      }
    });
  }, [tracks]);

  useEffect(() => {
    let isCancelled = false;
    const context = ensureAudioContext();

    const analyzeTrack = async (track: Track) => {
      try {
        const audioBuffer = await context.decodeAudioData(
          (await track.blob.arrayBuffer()).slice(0)
        );

        if (isCancelled) {
          return;
        }

        buffersRef.current[track.id] = audioBuffer;
        const gain = context.createGain();
        const wahFilter = context.createBiquadFilter();
        const analyser = context.createAnalyser();

        analyser.fftSize = 2048;
        wahFilter.type = "peaking";
        wahFilter.Q.value = 0.8;

        gain.connect(wahFilter);
        wahFilter.connect(analyser);
        analyser.connect(context.destination);

        gainNodesRef.current[track.id] = gain;
        wahNodesRef.current[track.id] = wahFilter;
        analyserNodesRef.current[track.id] = analyser;
        gain.gain.setValueAtTime(
          getEffectiveVolumeFromRefs(track.id, volumesRef.current[track.id]),
          context.currentTime
        );
        applyWahPosition(track.id, wahPositionsRef.current[track.id] ?? 0.5);
        setWahPositions((previous) => ({
          ...previous,
          [track.id]: previous[track.id] ?? 0.5,
        }));

        setDuration((previous) => {
          const maxDuration = Math.max(previous, audioBuffer.duration);
          return Number.isFinite(maxDuration) ? maxDuration : 0;
        });

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
        setReadyTrackIds((previous) => {
          if (previous.includes(track.id)) {
            return previous;
          }

          return [...previous, track.id];
        });
      } catch (error) {
        console.error("Failed to analyze track envelope", track.name, error);
      }
    };

    tracks.forEach((track) => {
      void analyzeTrack(track);
    });

    return () => {
      isCancelled = true;
    };
  }, [
    applyWahPosition,
    ensureAudioContext,
    getEffectiveVolumeFromRefs,
    tracks,
  ]);

  useEffect(() => {
    tracks.forEach((track) => {
      applyEffectiveVolume(track.id);
    });
  }, [applyEffectiveVolume, getEffectiveVolume, tracks]);

  useEffect(() => {
    const resizeCanvases = () => {
      Object.values(canvasRefs.current).forEach((canvas) => {
        if (!canvas) {
          return;
        }

        const parentWidth =
          canvas.parentElement?.clientWidth ?? window.innerWidth;
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

  useEffect(() => {
    const draw = () => {
      const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
      const playbackTime = currentPlaybackTime();

      tracks.forEach((track) => {
        const analyser = analyserNodesRef.current[track.id];
        const canvas = canvasRefs.current[track.id];

        if (!analyser || !canvas) {
          return;
        }

        try {
          drawVisualizer({
            analyser,
            canvas,
            visualizerType,
            amplitudeEnvelope: amplitudeEnvelopes[track.id],
            amplitudeMaximum: amplitudeMaximums[track.id],
            sampleRate,
            currentTime: playbackTime,
            duration: duration || 0,
          });
        } catch (error) {
          console.error("Failed to draw visualizer", track.name, error);
        }
      });

      drawAnimationFrameRef.current = requestAnimationFrame(draw);
    };

    drawAnimationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (drawAnimationFrameRef.current !== null) {
        cancelAnimationFrame(drawAnimationFrameRef.current);
      }
    };
  }, [
    amplitudeEnvelopes,
    amplitudeMaximums,
    currentPlaybackTime,
    duration,
    tracks,
    visualizerType,
  ]);

  useEffect(() => {
    const updateTime = () => {
      const playbackTime = currentPlaybackTime();
      if (isDraggingSeekRef.current) {
        const pendingTime = pendingSeekRef.current;

        if (pendingTime !== null) {
          setCurrentTime(Math.min(duration || pendingTime, pendingTime));
        }
      } else {
        setCurrentTime(Math.min(duration || playbackTime, playbackTime));
      }

      if (isPlaying && duration && playbackTime >= duration) {
        stopAllSources();
        startOffsetRef.current = duration;
        setIsPlaying(false);
      }

      timeAnimationFrameRef.current = requestAnimationFrame(updateTime);
    };

    timeAnimationFrameRef.current = requestAnimationFrame(updateTime);

    return () => {
      if (timeAnimationFrameRef.current !== null) {
        cancelAnimationFrame(timeAnimationFrameRef.current);
      }
    };
  }, [currentPlaybackTime, duration, isPlaying, stopAllSources]);

  const schedulePlayback = useCallback(
    async (offsetSeconds: number) => {
      if (!tracks.length) {
        return;
      }

      const readyTracks = tracks.filter(
        (track) =>
          buffersRef.current[track.id] && gainNodesRef.current[track.id]
      );

      if (!readyTracks.length) {
        return;
      }

      const context = ensureAudioContext();
      await context.resume();
      const startAt = context.currentTime + 0.02;
      const newSources: Record<string, AudioBufferSourceNode> = {};

      readyTracks.forEach((track) => {
        const buffer = buffersRef.current[track.id];
        const gainNode = gainNodesRef.current[track.id];

        if (!buffer || !gainNode) {
          return;
        }

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNode);
        source.start(startAt, offsetSeconds);
        newSources[track.id] = source;
      });

      sourcesRef.current = newSources;
      startAtCtxTimeRef.current = startAt;
      setIsPlaying(true);
    },
    [ensureAudioContext, tracks]
  );

  const commitSeek = useCallback(
    async (targetTime: number) => {
      const clampedTime = Math.max(0, Math.min(targetTime, duration || 0));

      if (isPlaying) {
        stopAllSources();
        startOffsetRef.current = clampedTime;
        await schedulePlayback(clampedTime);
      } else {
        startOffsetRef.current = clampedTime;
        setCurrentTime(clampedTime);
      }
    },
    [duration, isPlaying, schedulePlayback, stopAllSources]
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

  const handlePlayPause = useCallback(async () => {
    if (!tracks.length) {
      return;
    }

    if (isPlaying) {
      const context = audioCtxRef.current;

      if (!context) {
        setIsPlaying(false);
        return;
      }

      startOffsetRef.current =
        context.currentTime -
        startAtCtxTimeRef.current +
        startOffsetRef.current;
      stopAllSources();
      setIsPlaying(false);
      return;
    }

    await schedulePlayback(startOffsetRef.current);
  }, [isPlaying, schedulePlayback, stopAllSources, tracks.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInteractiveTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        target?.isContentEditable;

      if (isInteractiveTarget) {
        return;
      }

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        void handlePlayPause();
        return;
      }

      if (event.code === "ArrowRight" || event.key === "ArrowRight") {
        event.preventDefault();
        setVisualizerType((current) => {
          const currentIndex = visualizerOptions.findIndex(
            (option) => option.value === current
          );

          if (currentIndex === -1) {
            return visualizerOptions[0]?.value ?? "time-ribbon";
          }

          return visualizerOptions[
            (currentIndex + 1) % visualizerOptions.length
          ]?.value;
        });
        return;
      }

      if (event.code === "ArrowLeft" || event.key === "ArrowLeft") {
        event.preventDefault();
        setVisualizerType((current) => {
          const currentIndex = visualizerOptions.findIndex(
            (option) => option.value === current
          );

          if (currentIndex === -1) {
            return visualizerOptions[0]?.value ?? "time-ribbon";
          }

          return visualizerOptions[
            (currentIndex - 1 + visualizerOptions.length) %
              visualizerOptions.length
          ]?.value;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handlePlayPause]);

  const handleVolumeChange = (trackId: string, value: number) => {
    setVolumes((previous) => ({ ...previous, [trackId]: value }));
    applyEffectiveVolume(trackId, value);
  };

  const handleWahChange = (trackId: string, value: number) => {
    const clamped = Math.min(1, Math.max(0, value));

    setWahPositions((previous) => ({ ...previous, [trackId]: clamped }));
    applyWahPosition(trackId, clamped);
  };

  const toggleTrackMute = (trackId: string) => {
    setTrackMuteStates((previous) => ({
      ...previous,
      [trackId]: !previous[trackId],
    }));
    applyEffectiveVolume(trackId);
  };

  const toggleTrackDeafen = (trackId: string) => {
    setTrackDeafenStates((previous) => ({
      ...previous,
      [trackId]: !previous[trackId],
    }));
    applyEffectiveVolume(trackId);
  };

  const formattedTime = (time: number) => {
    const safeTime = Math.max(0, Math.floor(time));
    const minutes = Math.floor(safeTime / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (safeTime % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  const areTracksReady =
    tracks.length > 0 && readyTrackIds.length === tracks.length;

  const handleClearCache = useCallback(async () => {
    setIsClearingCache(true);

    try {
      await removeCachedOutputs(record.md5);
      onClose();
    } catch (clearError) {
      console.error("Failed to clear cache for record", clearError);
    } finally {
      setIsClearingCache(false);
    }
  }, [onClose, record.md5]);

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
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h3 style={{ margin: 0 }}>{playerTitle}</h3>
          <button
            type="button"
            onClick={() => void handleClearCache()}
            disabled={isClearingCache}
          >
            {isClearingCache ? "Clearing..." : "Clear cache"}
          </button>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div style={{ marginTop: "1rem" }}>
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            volume={volumes[track.id] ?? 1}
            isMuted={!!trackMuteStates[track.id]}
            isDeafened={!!trackDeafenStates[track.id]}
            wahValue={wahPositions[track.id] ?? 0.5}
            onVolumeChange={handleVolumeChange}
            onWahChange={handleWahChange}
            onToggleMute={toggleTrackMute}
            onToggleDeafen={toggleTrackDeafen}
            registerCanvas={(ref) => {
              canvasRefs.current[track.id] = ref;
            }}
          />
        ))}
      </div>
      <div
        style={{
          marginTop: "1rem",
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
        <button
          type="button"
          onClick={() => void handlePlayPause()}
          disabled={!areTracksReady}
        >
          {isPlaying ? "Pause" : areTracksReady ? "Play" : "Loading..."}
        </button>
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          <span style={{ fontWeight: 700, color: "#e5e7eb" }}>Visualizer</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
          {visualizerOptions.map((option) => {
            const isActive = visualizerType === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setVisualizerType(option.value)}
                style={visualizerButtonStyle(isActive)}
                aria-pressed={isActive}
              >
                <div style={{ fontWeight: 700, letterSpacing: "0.02em" }}>
                  {option.label}
                </div>
                <div
                  style={{
                    color: isActive ? "#eaf2ff" : "#c7d2fe",
                    fontSize: "0.9rem",
                    marginTop: "0.1rem",
                  }}
                >
                  {option.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
