import {
  Fragment,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  cacheChordTimeline,
  getCachedChordTimeline,
} from "../services/indexedDbClient";
import {
  applyAudioEffect,
  audioEffectOptions,
  type AudioEffectType,
  createEffectNodes,
  type EffectNodes,
  getDefaultEffectValue,
} from "./audioEffects";
import {
  analyzeChordTimeline,
  CHORD_ANALYZER_VERSION,
  type ChordSnapshot,
} from "./chordAnalyzer";
import { getVisualizerButtonStyle } from "./playerStyles";
import { formatPlaybackTime } from "./time";
import { TrackRow } from "./TrackRow";
import {
  AMPLITUDE_WINDOW_SECONDS,
  type CachedTrackFile,
  FUTURE_WINDOW_SECONDS,
  PAST_WINDOW_SECONDS,
  type PlayerProps,
  type Track,
  type VisualizerType,
} from "./types";
import { visualizerOptions } from "./visualizerOptions";
import { drawVisualizer } from "./visualizers";

export default function Player({
  record,
  title,
  spotifyTrackId,
  trackArtworkSrc,
  trackMetadata,
  unavailableMessage,
  hasPreviousTrack = false,
  hasNextTrack = false,
  onPreviousTrack,
  onNextTrack,
}: PlayerProps) {
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
  const [visualizerType, setVisualizerType] = useState<VisualizerType>(
    visualizerOptions[0].value
  );
  const [trackMuteStates, setTrackMuteStates] = useState<
    Record<string, boolean>
  >({});
  const [trackDeafenStates, setTrackDeafenStates] = useState<
    Record<string, boolean>
  >({});
  const [effectValues, setEffectValues] = useState<Record<string, number>>({});
  const [effectTypes, setEffectTypes] = useState<
    Record<string, AudioEffectType>
  >({});
  const [readyTrackIds, setReadyTrackIds] = useState<string[]>([]);
  const [lyricsJson, setLyricsJson] = useState("");
  const [lyricsError, setLyricsError] = useState("");
  const [chordTimeline, setChordTimeline] = useState<ChordSnapshot[]>([]);
  const [chordStatus, setChordStatus] = useState<string>(
    "Harmonic analyzer standing by"
  );
  const [currentChord, setCurrentChord] = useState<string>("Detecting...");
  const [isHarmonicAnalysisRunning, setIsHarmonicAnalysisRunning] =
    useState(false);
  const isAnyTrackDeafened = useMemo(
    () => Object.values(trackDeafenStates).some(Boolean),
    [trackDeafenStates]
  );

  const volumesRef = useRef<Record<string, number>>({});
  const trackMuteStatesRef = useRef<Record<string, boolean>>({});
  const trackDeafenStatesRef = useRef<Record<string, boolean>>({});
  const effectValuesRef = useRef<Record<string, number>>({});
  const effectTypesRef = useRef<Record<string, AudioEffectType>>({});

  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Record<string, AudioBuffer>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const effectNodesRef = useRef<Record<string, EffectNodes>>({});
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

  const inputTrack = useMemo(
    () =>
      tracks.find(
        (track) => track.isInput && track.name.toLowerCase().endsWith(".mp3")
      ) ??
      tracks.find((track) => track.isInput) ??
      null,
    [tracks]
  );
  const inputTrackId = inputTrack?.id ?? null;
  const spotifyLyricsUrl = useMemo(() => {
    if (!spotifyTrackId || !trackArtworkSrc) {
      return "";
    }

    return buildSpotifyLyricsUrl(spotifyTrackId, trackArtworkSrc);
  }, [spotifyTrackId, trackArtworkSrc]);

  const primaryTrack = tracks.find((track) => track.isInput) ?? tracks[0];
  const playerTitle = title ?? primaryTrack?.name ?? "Playback";
  const chordDisplay = chordTimeline.length
    ? currentChord
    : chordStatus ?? "Analyzing harmony...";
  const isInputTrackReady = useMemo(() => {
    if (!inputTrackId) {
      return false;
    }

    return readyTrackIds.includes(inputTrackId);
  }, [inputTrackId, readyTrackIds]);

  const trackLookup = useMemo(() => {
    return tracks.reduce<Record<string, Track>>((lookup, track) => {
      lookup[track.id] = track;
      return lookup;
    }, {});
  }, [tracks]);

  useEffect(() => {
    console.log("Loaded track metadata", {
      trackId: record.md5,
      metadata: trackMetadata ?? null,
    });
  }, [record.md5, trackMetadata]);

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
    effectValuesRef.current = effectValues;
  }, [effectValues]);

  useEffect(() => {
    effectTypesRef.current = effectTypes;
  }, [effectTypes]);

  useEffect(() => {
    const controller = new AbortController();

    setLyricsJson("");
    setLyricsError("");

    if (!spotifyLyricsUrl) {
      return () => controller.abort();
    }

    const loadLyrics = async () => {
      try {
        const response = await fetch(spotifyLyricsUrl, {
          credentials: "include",
          signal: controller.signal,
        });
        const text = await response.text();

        if (!response.ok) {
          throw new Error(text || `Lyrics request failed with ${response.status}`);
        }

        setLyricsJson(text);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setLyricsError(error instanceof Error ? error.message : String(error));
      }
    };

    void loadLyrics();

    return () => controller.abort();
  }, [spotifyLyricsUrl]);

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

  const applyEffectValue = useCallback(
    (trackId: string, value?: number, effectOverride?: AudioEffectType) => {
      const context = audioCtxRef.current ?? ensureAudioContext();
      const effectNodes = effectNodesRef.current[trackId];

      if (!context || !effectNodes) {
        return;
      }

      const effectType =
        effectOverride ?? effectTypesRef.current[trackId] ?? "wah";
      const effectValue =
        value ??
        effectValuesRef.current[trackId] ??
        getDefaultEffectValue(effectType);

      applyAudioEffect({
        context,
        nodes: effectNodes,
        effect: effectType,
        value: effectValue,
      });
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
    const initialEffectValues: Record<string, number> = {};
    const initialEffectTypes: Record<string, AudioEffectType> = {};

    for (const track of tracks) {
      initialVolumes[track.id] = 1;
      initialMuteStates[track.id] = track.isInput;
      initialDeafenStates[track.id] = false;
      initialEffectValues[track.id] = getDefaultEffectValue("wah");
      initialEffectTypes[track.id] = "wah";
    }

    volumesRef.current = initialVolumes;
    trackMuteStatesRef.current = initialMuteStates;
    trackDeafenStatesRef.current = initialDeafenStates;
    effectValuesRef.current = initialEffectValues;
    effectTypesRef.current = initialEffectTypes;

    setVolumes(initialVolumes);
    setEffectValues(initialEffectValues);
    setEffectTypes(initialEffectTypes);
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
    effectNodesRef.current = {};
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

    Object.entries(effectNodesRef.current).forEach(([id, effectNodes]) => {
      if (!activeIds.has(id)) {
        effectNodes.filter.disconnect();
        effectNodes.phaserStages.forEach((stage) => stage.disconnect());
        effectNodes.phaserFeedbackGain.disconnect();
        effectNodes.wetGain.disconnect();
        effectNodes.dryGain.disconnect();
        effectNodes.delay.disconnect();
        effectNodes.feedbackGain.disconnect();
        effectNodes.shaper.disconnect();
        effectNodes.convolver.disconnect();
        effectNodes.delayLfoGain.disconnect();
        effectNodes.filterLfoGain.disconnect();
        try {
          effectNodes.lfo.stop();
        } catch (error) {
          console.warn("Failed to stop LFO", error);
        }
        effectNodes.lfo.disconnect();
        delete effectNodesRef.current[id];
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
    const activeTrackIds = new Set(tracks.map((track) => track.id));

    const analyzeTrack = async (track: Track) => {
      try {
        const audioBuffer = await context.decodeAudioData(
          (await track.blob.arrayBuffer()).slice(0)
        );

        if (isCancelled || !activeTrackIds.has(track.id)) {
          return;
        }

        buffersRef.current[track.id] = audioBuffer;
        const gain = context.createGain();
        const effectNodes = createEffectNodes(context);
        const analyser = context.createAnalyser();

        analyser.fftSize = 2048;

        gain.connect(effectNodes.filter);
        gain.connect(effectNodes.dryGain);
        effectNodes.wetGain.connect(analyser);
        effectNodes.dryGain.connect(analyser);
        analyser.connect(context.destination);

        gainNodesRef.current[track.id] = gain;
        effectNodesRef.current[track.id] = effectNodes;
        analyserNodesRef.current[track.id] = analyser;
        gain.gain.setValueAtTime(
          getEffectiveVolumeFromRefs(track.id, volumesRef.current[track.id]),
          context.currentTime
        );
        const startingEffect =
          effectTypesRef.current[track.id] ?? ("wah" as AudioEffectType);
        const startingValue =
          effectValuesRef.current[track.id] ??
          getDefaultEffectValue(startingEffect);

        applyEffectValue(track.id, startingValue, startingEffect);

        if (isCancelled || !activeTrackIds.has(track.id)) {
          return;
        }

        setEffectValues((previous) => ({
          ...previous,
          [track.id]:
            previous[track.id] ?? getDefaultEffectValue(startingEffect),
        }));
        setEffectTypes((previous) => ({
          ...previous,
          [track.id]: previous[track.id] ?? startingEffect,
        }));

        if (isCancelled || !activeTrackIds.has(track.id)) {
          return;
        }

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

        if (isCancelled || !activeTrackIds.has(track.id)) {
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

        if (track.id === inputTrackId) {
          setChordStatus("Harmonic analyzer ready");
          setCurrentChord("Press Analyze");
        }
      } catch (error) {
        console.error("Failed to analyze track envelope", track.name, error);
      }
    };

    void (async () => {
      await Promise.all(tracks.map((track) => analyzeTrack(track)));
    })();

    return () => {
      isCancelled = true;
    };
  }, [
    applyEffectValue,
    ensureAudioContext,
    getEffectiveVolumeFromRefs,
    inputTrackId,
    record.md5,
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
          const effectiveVolume = getEffectiveVolumeFromRefs(track.id);
          drawVisualizer({
            analyser,
            canvas,
            visualizerType,
            amplitudeEnvelope: amplitudeEnvelopes[track.id],
            amplitudeMaximum: amplitudeMaximums[track.id],
            sampleRate,
            currentTime: playbackTime,
            duration: duration || 0,
            isPlaying,
            effectiveVolume,
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
    getEffectiveVolumeFromRefs,
    isPlaying,
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

  useEffect(() => {
    // Keep the displayed chord in sync with the transport position.
    if (!chordTimeline.length) {
      setCurrentChord(chordStatus ?? "Analyzing harmony...");
      return;
    }

    let activeChord = chordTimeline[0]?.chord ?? "Unclear";

    for (let i = 0; i < chordTimeline.length; i++) {
      const snapshot = chordTimeline[i];

      if (!snapshot) {
        continue;
      }

      if (snapshot.time <= currentTime) {
        activeChord = snapshot.chord;
      } else {
        break;
      }
    }

    setCurrentChord(activeChord);
  }, [chordStatus, chordTimeline, currentTime]);

  const handleHarmonicAnalyze = useCallback(async () => {
    if (!inputTrackId) {
      setChordStatus("No input MP3 available for analysis");
      setCurrentChord("No input MP3 available");
      return;
    }

    const audioBuffer = buffersRef.current[inputTrackId];

    if (!audioBuffer) {
      setChordStatus("Input MP3 still loading...");
      setCurrentChord("Please wait");
      return;
    }

    setIsHarmonicAnalysisRunning(true);
    setChordStatus("Checking cached harmony...");

    try {
      try {
        const cachedRecord = await getCachedChordTimeline(record.md5);

        if (cachedRecord?.analyzerVersion === CHORD_ANALYZER_VERSION) {
          const cachedTimeline = cachedRecord.timeline ?? [];
          setChordTimeline(cachedTimeline);
          setChordStatus(
            cachedTimeline.length
              ? "Harmonic map ready"
              : "No obvious chords detected"
          );
          return;
        }
      } catch (cacheError) {
        console.warn("Failed to load cached chord timeline", cacheError);
      }

      setChordStatus("Analyzing harmony from input MP3...");

      try {
        const timeline = await analyzeChordTimeline(audioBuffer, {
          stableFrameCount: 2,
          minimumConfidence: 0.16,
          windowSeconds: 1.6,
          hopSeconds: 0.5,
          targetSampleRate: 11025,
          yieldEveryFrames: 6,
        });

        setChordTimeline(timeline);
        setChordStatus(
          timeline.length ? "Harmonic map ready" : "No obvious chords detected"
        );

        try {
          await cacheChordTimeline(
            record.md5,
            timeline,
            CHORD_ANALYZER_VERSION
          );
        } catch (cacheError) {
          console.warn("Failed to cache chord timeline", cacheError);
        }
      } catch (chordError) {
        console.error("Failed to analyze chord timeline", chordError);
        setChordStatus("Unable to analyze chords for this input");
      }
    } finally {
      setIsHarmonicAnalysisRunning(false);
    }
  }, [inputTrackId, record.md5]);

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

  const handleCanvasSeek = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (
        visualizerType !== "time-ribbon" &&
        visualizerType !== "super-time-ribbon"
      ) {
        return;
      }

      if (!duration) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const position = rect.width
        ? (event.clientX - rect.left) / rect.width
        : 0;
      const clamped = Math.min(1, Math.max(0, position));
      const totalWindowSeconds = PAST_WINDOW_SECONDS + FUTURE_WINDOW_SECONDS;
      const timeOffset = clamped * totalWindowSeconds - PAST_WINDOW_SECONDS;
      const targetTime = currentTime + timeOffset;
      pendingSeekRef.current = targetTime;
      void commitSeek(targetTime);
    },
    [commitSeek, currentTime, duration, visualizerType]
  );

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

  const handleVolumeReset = (trackId: string) => {
    setVolumes((previous) => ({ ...previous, [trackId]: 1 }));
    applyEffectiveVolume(trackId, 1);
  };

  const handleEffectValueChange = (trackId: string, value: number) => {
    const clamped = Math.min(1, Math.max(0, value));

    setEffectValues((previous) => ({ ...previous, [trackId]: clamped }));
    applyEffectValue(trackId, clamped);
  };

  const handleEffectTypeChange = (
    trackId: string,
    effectType: AudioEffectType
  ) => {
    const defaultValue = getDefaultEffectValue(effectType);
    effectValuesRef.current[trackId] = defaultValue;
    setEffectValues((previous) => ({ ...previous, [trackId]: defaultValue }));
    setEffectTypes((previous) => ({ ...previous, [trackId]: effectType }));
    applyEffectValue(trackId, defaultValue, effectType);
  };

  const handleEffectReset = (trackId: string) => {
    const defaultValue = getDefaultEffectValue(
      effectTypesRef.current[trackId] ?? "wah"
    );
    effectValuesRef.current[trackId] = defaultValue;
    setEffectValues((previous) => ({
      ...previous,
      [trackId]: defaultValue,
    }));
    applyEffectValue(trackId, defaultValue);
  };

  const toggleTrackMute = (trackId: string) => {
    setTrackMuteStates((previous) => ({
      ...previous,
      [trackId]: !previous[trackId],
    }));
    applyEffectiveVolume(trackId);
  };

  const toggleTrackDeafen = (trackId: string) => {
    setTrackDeafenStates((previous) => {
      const nextValue = !previous[trackId];

      if (nextValue) {
        setTrackMuteStates((mutePrevious) => ({
          ...mutePrevious,
          [trackId]: false,
        }));
      }

      return {
        ...previous,
        [trackId]: nextValue,
      };
    });
    applyEffectiveVolume(trackId);
  };

  const areTracksReady =
    tracks.length > 0 && readyTrackIds.length === tracks.length;

  useEffect(() => {
    // Reset chord-related UI when the primary track changes.
    setChordTimeline([]);
    setChordStatus(
      inputTrackId
        ? "Harmonic analyzer standing by"
        : "No input MP3 available for analysis"
    );
    setCurrentChord(inputTrackId ? "Press Analyze" : "No input MP3 available");
    setIsHarmonicAnalysisRunning(false);
  }, [inputTrackId]);

  return (
    <div
      style={{
        padding: 0,
        background: "transparent",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            flexWrap: "wrap",
            flex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <button
              type="button"
              onClick={onPreviousTrack}
              disabled={!hasPreviousTrack}
              aria-label="Previous track"
              style={{
                fontSize: "20px",
                height: "40px",
                lineHeight: 1,
                minWidth: "40px",
                padding: "0 0.45rem",
              }}
            >
              ⏮️
            </button>
            <button
              type="button"
              onClick={() => void handlePlayPause()}
              disabled={!areTracksReady}
              aria-label={isPlaying ? "Pause" : "Play"}
              style={{
                fontSize: "20px",
                height: "40px",
                lineHeight: 1,
                minWidth: "44px",
                padding: "0 0.5rem",
              }}
            >
              {isPlaying ? "⏸️" : "▶️"}
            </button>
            <button
              type="button"
              onClick={onNextTrack}
              disabled={!hasNextTrack}
              aria-label="Next track"
              style={{
                fontSize: "20px",
                height: "40px",
                lineHeight: 1,
                minWidth: "40px",
                padding: "0 0.45rem",
              }}
            >
              ⏭️
            </button>
          </div>
          {tracks.length ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  flex: 1,
                  minWidth: "200px",
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
                  style={{ width: "100%", verticalAlign: "middle" }}
                />
                <span style={{ whiteSpace: "nowrap", minWidth: "100px", fontSize: "0.85em" }}>
                  {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
                </span>
              </div>
              <h3 style={{ fontSize: "1em", margin: 0 }}>{playerTitle}</h3>
              <div
                style={{
                  alignItems: "center",
                  background: "var(--ktv-control-bg)",
                  border: "1px solid var(--ww-border)",
                  borderRadius: "999px",
                  color: "var(--ww-text-soft)",
                  display: "flex",
                  gap: "0.5rem",
                  minHeight: "40px",
                  minWidth: "160px",
                  padding: "0 0.35rem 0 0.7rem",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "0.3rem",
                  }}
                  aria-label="Detected chord"
                >
                  <span style={{ fontWeight: 700, color: "var(--ww-text)" }}>Chord:</span>
                  <span
                    style={{ fontStyle: chordTimeline.length ? "normal" : "italic" }}
                  >
                    {chordDisplay}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleHarmonicAnalyze()}
                  disabled={!isInputTrackReady || isHarmonicAnalysisRunning}
                  style={{
                    fontSize: "0.9em",
                    height: "32px",
                    padding: "0 0.6rem",
                  }}
                >
                  {isHarmonicAnalysisRunning
                    ? "Analyzing..."
                    : chordTimeline.length
                      ? "Re-run harmony scan"
                      : "Analyze harmony"}
                </button>
              </div>
            </>
          ) : (
            <p
              style={{
                color: "var(--ww-text-muted)",
                margin: 0,
              }}
            >
              {unavailableMessage ?? "No playable local files found."}
            </p>
          )}
        </div>
      </div>
      {tracks.length ? (
        <>
          <div style={{ marginTop: "1rem" }}>
            {tracks.map((track) => (
              <Fragment key={track.id}>
                {track.id === inputTrackId ? (
                  <LyricsJsonBubble
                    lyricsJson={lyricsJson}
                    lyricsError={lyricsError}
                    lyricsUrl={spotifyLyricsUrl}
                  />
                ) : null}
                <TrackRow
                  track={track}
                  volume={volumes[track.id] ?? 1}
                  isMuted={!!trackMuteStates[track.id]}
                  isDeafened={!!trackDeafenStates[track.id]}
                  effectType={effectTypes[track.id] ?? "wah"}
                  effectValue={
                    effectValues[track.id] ??
                    getDefaultEffectValue(effectTypes[track.id] ?? "wah")
                  }
                  effectOptions={audioEffectOptions}
                  onVolumeChange={handleVolumeChange}
                  onVolumeReset={handleVolumeReset}
                  onEffectValueChange={handleEffectValueChange}
                  onEffectTypeChange={handleEffectTypeChange}
                  onResetEffect={handleEffectReset}
                  onToggleMute={toggleTrackMute}
                  onToggleDeafen={toggleTrackDeafen}
                  registerCanvas={(ref) => {
                    canvasRefs.current[track.id] = ref;
                  }}
                  onCanvasSeek={handleCanvasSeek}
                />
              </Fragment>
            ))}
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
              <span style={{ fontWeight: 700, color: "var(--ww-text)" }}>
                Visualizer
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.6rem",
                justifyContent: "space-around",
              }}
            >
              {visualizerOptions.map((option) => {
                const isActive = visualizerType === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVisualizerType(option.value)}
                    style={getVisualizerButtonStyle(isActive)}
                    aria-pressed={isActive}
                  >
                    <div style={{ fontWeight: 700, letterSpacing: "0.02em" }}>
                      {option.label}
                    </div>
                    <div
                      style={{
                        color: isActive ? "var(--ww-text)" : "var(--ww-text-muted)",
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
        </>
      ) : null}
    </div>
  );
}

function LyricsJsonBubble({
  lyricsJson,
  lyricsError,
  lyricsUrl,
}: {
  lyricsJson: string;
  lyricsError: string;
  lyricsUrl: string;
}) {
  const content = lyricsJson || lyricsError || (lyricsUrl ? "Loading lyrics JSON..." : "Missing Spotify lyrics URL.");

  return (
    <div
      style={{
        background: "rgba(8, 6, 5, 0.72)",
        border: "1px solid rgba(228, 193, 150, 0.34)",
        borderRadius: "7px",
        boxShadow: "0 9px 20px rgba(0, 0, 0, 0.24)",
        marginBottom: "0.72rem",
        padding: "0.64rem",
      }}
    >
      <div
        style={{
          color: "var(--ww-text)",
          fontWeight: 600,
          marginBottom: "0.34rem",
        }}
      >
        Lyrics
      </div>
      <pre
        style={{
          background: "linear-gradient(90deg, #120d0b, #1a1411)",
          border: "1px solid var(--ww-border)",
          color: lyricsError ? "var(--ww-danger)" : "var(--ww-text-soft)",
          margin: 0,
          maxHeight: "220px",
          overflow: "auto",
          padding: "0.64rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {content}
      </pre>
    </div>
  );
}

function buildSpotifyLyricsUrl(trackId: string, trackArtworkSrc: string) {
  return `https://spclient.wg.spotify.com/color-lyrics/v2/track/${encodeURIComponent(
    trackId
  )}/image/${encodeURIComponent(
    trackArtworkSrc
  )}?format=json&vocalRemoval=false&market=from_token`;
}
