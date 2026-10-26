import { loadPlateArtwork, musicNoteArtwork } from './visuals/plateArtwork';
import { CombinedVisualizerPanel } from './CombinedVisualizerPanel';
import { settingsForTracks } from './mixerSettings';
import { SpotifyRemoteObserver } from '../../local/spotifySync';
import { resizeVisualizer, canvasVisible } from './visuals/canvas';
import { createStereoTap, type StereoTap } from './visuals/analysis';
import { drawSpectrogram, resetSpectrogram } from './visuals/spectrogram';
import { drawStereoBloom } from './visuals/stereoBloom';
import { isCombinedVisualizer, drawCombinedVisualizer, resetCombinedVisualizer } from './visuals/combinedVisualizers';
import { getLogarithmicVolumeGain } from './mixerGain';
import { connectStemEffects } from './stemGraph';
import { TempoEngine } from './tempoEngine';
import { validTempo, validPitch } from './tempo';
import type { MixerSnapshot } from '../../local/recording';
import {
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
  createEffectNodes, prepareAudioEffects, disposeAudioEffects, syncAudioEffects, defaultEffectSettings, type EffectSettings, isAudioEffect,
  type EffectNodes,
  getDefaultEffectValue,
} from "./audioEffects";
import {
  analyzeChordTimeline,
  CHORD_ANALYZER_VERSION,
  chordAtTime,
  type ChordSnapshot,
} from "./chordAnalyzer";
import { VisualizerPicker } from "./VisualizerPicker";
import { formatPlaybackTime } from "./time";
import { TrackRow } from "./TrackRow";
import {
  AMPLITUDE_WINDOW_SECONDS,
  type CachedTrackFile,
  FUTURE_WINDOW_SECONDS,
  PAST_WINDOW_SECONDS,
  type PlayerProps,
  type RecordingEvent,
  type RecordingEventPayload,
  type RecordingEventType,
  type Track,
  type VisualizerType,
} from "./types";
import { visualizerOptions, supportsVisualizer } from "./visualizerOptions";
import { drawVisualizer, resetVisualizerState } from "./visualizers";

type SpotlightIntent =
  | {
    kind: "input";
  }
  | {
    kind: "output";
    name: string;
  };
type SpotlightLevel = "track" | "track-with-selectors";
type SpotlightState = {
  intent: SpotlightIntent;
  level: SpotlightLevel;
};

export default function Player({
  record, replaying = false, onControls, initialSettings, onSettingsChange,
  combinedVisualizerExpanded, onCombinedVisualizerExpandedChange,
  masterVolume = 1, tempoSupported = true, transport, onTransportCommand, onPlaybackError,
  title,
  trackMetadata,
  unavailableMessage,
  hasPreviousTrack = false,
  hasNextTrack = false,
  autoPlayOnReady = false,
  onPreviousTrack,
  onNextTrack,
  onTrackEnd,
  onAutoPlayOnReadyHandled,
  isRecording = false,
  onStartRecording,
  onStopRecording,
  onRecordingEvent,
  onRegisterRecordingFlush,
}: PlayerProps) {
  const inheritedSettings = useRef(initialSettings);
  const controlsCallback = useRef(onControls); controlsCallback.current=onControls;
  useEffect(() => () => controlsCallback.current?.(null), []);
  const playbackErrorRef = useRef(onPlaybackError);
  useEffect(() => { playbackErrorRef.current = onPlaybackError; }, [onPlaybackError]);
  const [transportError, setTransportError] = useState('');
  const playbackEpoch = useRef(0);
  const masterGain = useRef<GainNode | null>(null);
  const engine = useRef<TempoEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [tempo, setTempo] = useState(initialSettings?.tempo ?? 1);
  const [pitch, setPitch] = useState(initialSettings?.pitch ?? 0);
  const tempoRef = useRef(tempo), pitchRef = useRef(pitch);
  const applyTempoPitch = useCallback((rate: number, semitones: number) => {
    if (!validTempo(rate) || !validPitch(semitones)) throw new Error('Invalid tempo or pitch.');
    engine.current?.set(rate, semitones);
    const context=audioCtxRef.current;
    if(context)Object.values(effectNodesRef.current).forEach(nodes=>{
      nodes.node.parameters.get('tempo')!.setValueAtTime(rate,context.currentTime);
      const playing=nodes.node.parameters.get('clockRate')!.value>0;
      syncAudioEffects(nodes,engine.current?.position ?? startOffsetRef.current,playing?rate:0,context.currentTime);
    });
    tempoRef.current = rate; pitchRef.current = semitones;
    setTempo(rate); setPitch(semitones);
  }, []);
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
    (initialSettings?.visualizer as VisualizerType) ?? visualizerOptions[0].value
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
  const [chordTimeline, setChordTimeline] = useState<ChordSnapshot[]>([]);
  const [chordStatus, setChordStatus] = useState<string>(
    "Harmonic analyzer standing by"
  );
  const harmonicRun = useRef<AbortController | null>(null);
  const [isHarmonicAnalysisRunning, setIsHarmonicAnalysisRunning] =
    useState(false);
  const [spotlightState, setSpotlightState] =
    useState<SpotlightState | null>((initialSettings?.spotlight as SpotlightState) ?? null);
  const isAnyTrackDeafened = useMemo(
    () => Object.values(trackDeafenStates).some(Boolean),
    [trackDeafenStates]
  );

  const volumesRef = useRef<Record<string, number>>({});
  const trackMuteStatesRef = useRef<Record<string, boolean>>({});
  const trackDeafenStatesRef = useRef<Record<string, boolean>>({});
  const effectValuesRef = useRef<Record<string, number>>({});
  const [effectSettings,setEffectSettings] = useState<Record<string,EffectSettings>>({});
  const effectSettingsRef = useRef<Record<string,EffectSettings>>({});
  const effectTypesRef = useRef<Record<string, AudioEffectType>>({});
  const isRecordingRef = useRef(isRecording);
  const onRecordingEventRef = useRef(onRecordingEvent);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Record<string, AudioBuffer>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const effectNodesRef = useRef<Record<string, EffectNodes>>({});
  const analyserNodesRef = useRef<Record<string, AnalyserNode>>({});
  const combinedCanvas = useRef<HTMLCanvasElement | null>(null);
  const visualRevision = useRef(0);
  useEffect(() => { visualRevision.current++; }, [volumes, trackMuteStates, trackDeafenStates, effectValues, effectTypes, effectSettings]);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const drawAnimationFrameRef = useRef<number | null>(null);
  const timeAnimationFrameRef = useRef<number | null>(null);
  const isDraggingSeekRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const startAtCtxTimeRef = useRef(0);
  const startOffsetRef = useRef(0);
  const hasHandledPlaybackEndRef = useRef(false);
  const hasAttemptedAutoPlayOnReadyRef = useRef(false);
  const spotlightModeKeyRef = useRef("default");
  const pausedAtPerformanceTimeRef = useRef<number | null>(null);
  const debouncedRecordingEventsRef = useRef(
    new Map<string, { timeoutId: number; event: RecordingEvent }>()
  );

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

        return a.isInput ? -1 : 1;
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
  const spotlightTrack = useMemo(() => {
    const spotlightIntent = spotlightState?.intent;

    if (!spotlightIntent) {
      return null;
    }

    if (spotlightIntent.kind === "input") {
      return inputTrack;
    }

    return (
      tracks.find(
        (track) => !track.isInput && track.name === spotlightIntent.name
      ) ?? null
    );
  }, [inputTrack, spotlightState, tracks]);
  const spotlightTrackId = isCombinedVisualizer(visualizerType) ? null : spotlightTrack?.id ?? null;
  const spotlightModeKey = spotlightTrackId
    ? `${spotlightTrackId}:${spotlightState?.level ?? "track"}`
    : "default";
  const shouldShowVisualizerPicker =
    !spotlightTrackId || spotlightState?.level === "track-with-selectors";

  const primaryTrack = tracks.find((track) => track.isInput) ?? tracks[0];
  const playerTitle = title ?? primaryTrack?.name ?? "Playback";
  const currentChord = chordAtTime(chordTimeline, currentTime);
  const chordDisplay = isHarmonicAnalysisRunning ? chordStatus : currentChord?.chord ?? chordStatus;
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
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    onRecordingEventRef.current = onRecordingEvent;
  }, [onRecordingEvent]);

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
    if (!spotlightTrackId) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [spotlightTrackId]);

  useEffect(() => {
    if (
      tracks.length > 0 &&
      spotlightState?.intent.kind === "output" &&
      !spotlightTrackId
    ) {
      setSpotlightState(null);
    }
  }, [spotlightState, spotlightTrackId, tracks.length]);

  useEffect(() => {
    if (spotlightModeKeyRef.current === spotlightModeKey) {
      return;
    }

    spotlightModeKeyRef.current = spotlightModeKey;

    const resetCanvases = () => {
      Object.values(canvasRefs.current).forEach((canvas) => {
        if (!canvas) {
          return;
        }

        resetVisualizerState(canvas);

        const context = canvas.getContext("2d");
        context?.clearRect(0, 0, canvas.width, canvas.height);
      });
    };

    resetCanvases();
    const animationFrame = window.requestAnimationFrame(resetCanvases);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [spotlightModeKey]);

  const getEffectiveVolumeFromRefs = useCallback(
    (trackId: string, baseVolume?: number) => {
      const track = trackLookup[trackId];
      const volume = baseVolume ?? volumesRef.current[trackId] ?? 1;
      const volumeGain = getLogarithmicVolumeGain(volume);

      if (!track) {
        return volumeGain;
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

      return volumeGain;
    },
    [trackLookup]
  );

  const getEffectiveVolume = useCallback(
    (trackId: string, baseVolume?: number) => {
      const track = trackLookup[trackId];
      const volume = baseVolume ?? volumes[trackId] ?? 1;
      const volumeGain = getLogarithmicVolumeGain(volume);

      if (!track) {
        return volumeGain;
      }

      const isTrackMuted = trackMuteStates[trackId];
      const isTrackDeafened = trackDeafenStates[trackId];

      if (isTrackMuted) {
        return 0;
      }

      if (isAnyTrackDeafened && !isTrackDeafened) {
        return 0;
      }

      return volumeGain;
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
      masterGain.current = audioCtxRef.current.createGain();
      masterGain.current.gain.value = 0;
      masterGain.current.connect(audioCtxRef.current.destination);
    }

    return audioCtxRef.current;
  }, []);

  const stopAllSources = useCallback(() => {
    playbackEpoch.current++;
    const position=engine.current?.pause() ?? startOffsetRef.current;
    const context=audioCtxRef.current;
    if(context)Object.values(effectNodesRef.current).forEach(nodes=>syncAudioEffects(nodes,position,0,context.currentTime));
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
        value: effectValue, settings: effectSettingsRef.current[trackId], tempo: tempoRef.current,
      });
    },
    [ensureAudioContext]
  );

  const currentPlaybackTime = useCallback(() => {
    return isPlaying && engine.current ? engine.current.position : startOffsetRef.current;
  }, [isPlaying]);

  const createRecordingEvent = useCallback(
    (
      type: RecordingEventType,
      payload?: RecordingEventPayload,
      trackTimeSeconds = currentPlaybackTime()
    ): RecordingEvent => ({
      type,
      trackTimeSeconds: roundTrackTime(trackTimeSeconds),
      ...(payload === undefined ? {} : { payload }),
    }),
    [currentPlaybackTime]
  );

  const emitRecordingEvent = useCallback(
    (
      type: RecordingEventType,
      payload?: RecordingEventPayload,
      trackTimeSeconds?: number
    ) => {
      if (!isRecordingRef.current) {
        return;
      }

      onRecordingEventRef.current?.(
        createRecordingEvent(type, payload, trackTimeSeconds)
      );
    },
    [createRecordingEvent]
  );

  const queueDebouncedRecordingEvent = useCallback((_key: string, event: RecordingEvent) => {
    if (isRecordingRef.current) onRecordingEventRef.current?.(event);
  }, []);

  const cancelDebouncedRecordingEvent = useCallback((key: string) => {
    const existing = debouncedRecordingEventsRef.current.get(key);

    if (!existing) {
      return;
    }

    window.clearTimeout(existing.timeoutId);
    debouncedRecordingEventsRef.current.delete(key);
  }, []);

  const flushDebouncedRecordingEvents = useCallback(() => {
    for (const { timeoutId, event } of debouncedRecordingEventsRef.current.values()) {
      window.clearTimeout(timeoutId);

      if (isRecordingRef.current) {
        onRecordingEventRef.current?.(event);
      }
    }

    debouncedRecordingEventsRef.current.clear();
  }, []);

  const getStemRecordingPayload = useCallback(
    (trackId: string) => {
      const track = trackLookup[trackId];

      return {
        stemName: track?.name ?? "Unknown stem",
        stemKind: track?.isInput ? "input" : "output",
      };
    },
    [trackLookup]
  );

  useEffect(() => {
    onRegisterRecordingFlush?.(flushDebouncedRecordingEvents);

    return () => onRegisterRecordingFlush?.(null);
  }, [flushDebouncedRecordingEvents, onRegisterRecordingFlush]);

  const snapshot = useCallback((): MixerSnapshot => ({
    tempo: tempoRef.current, pitch: pitchRef.current,
    visualizer: visualizerType,
    stems: tracks.map(track => ({name:track.name,input:track.isInput,volume:volumesRef.current[track.id] ?? 1,
      mute:trackMuteStatesRef.current[track.id] ?? false,deafen:trackDeafenStatesRef.current[track.id] ?? false,
      effect:effectTypesRef.current[track.id] ?? 'wah',value:effectValuesRef.current[track.id] ?? getDefaultEffectValue('wah'),effectSettings:{...(effectSettingsRef.current[track.id] ?? defaultEffectSettings)}})),
    spotlight: spotlightState,
  }), [tracks,visualizerType,spotlightState]);

  useEffect(() => {

    return () => {
      flushDebouncedRecordingEvents();

      if (drawAnimationFrameRef.current !== null) {
        cancelAnimationFrame(drawAnimationFrameRef.current);
      }

      if (timeAnimationFrameRef.current !== null) {
        cancelAnimationFrame(timeAnimationFrameRef.current);
      }

      stopAllSources();
      engine.current?.dispose(); engine.current = null;
      audioCtxRef.current?.close().catch((error) => {
        console.error("Failed to close audio context", error);
      });
    };
  }, [flushDebouncedRecordingEvents, stopAllSources]);

  useEffect(() => {
    flushDebouncedRecordingEvents();

    const initialVolumes: Record<string, number> = {};
    const initialMuteStates: Record<string, boolean> = {};
    const initialDeafenStates: Record<string, boolean> = {};
    const initialEffectValues: Record<string, number> = {};
    const initialEffectSettings: Record<string,EffectSettings> = {};
    const initialEffectTypes: Record<string, AudioEffectType> = {};

    const inherited = settingsForTracks(inheritedSettings.current, tracks);
    for (const [index, track] of tracks.entries()) {
      const stem = inherited.stems[index];
      initialVolumes[track.id] = stem.volume;
      initialMuteStates[track.id] = stem.mute;
      initialDeafenStates[track.id] = stem.deafen;
      initialEffectValues[track.id] = stem.value;
      initialEffectSettings[track.id] = {...(stem.effectSettings ?? defaultEffectSettings)};
      initialEffectTypes[track.id] = stem.effect as AudioEffectType;
    }

    volumesRef.current = initialVolumes;
    trackMuteStatesRef.current = initialMuteStates;
    trackDeafenStatesRef.current = initialDeafenStates;
    effectValuesRef.current = initialEffectValues;
    effectSettingsRef.current=initialEffectSettings;setEffectSettings(initialEffectSettings);
    effectTypesRef.current = initialEffectTypes;

    setVolumes(initialVolumes);
    setEffectValues(initialEffectValues);
    setEffectTypes(initialEffectTypes);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setReadyTrackIds([]);
    setEngineReady(false);
    tempoRef.current = inherited.tempo ?? 1; pitchRef.current = inherited.pitch ?? 0;
    setTempo(tempoRef.current); setPitch(pitchRef.current);
    setSpotlightState(inherited.spotlight as SpotlightState | null);
    setVisualizerType(inherited.visualizer as VisualizerType);
    setTrackMuteStates(initialMuteStates);
    setTrackDeafenStates(initialDeafenStates);
    setAmplitudeEnvelopes({});
    setAmplitudeMaximums({});
    startOffsetRef.current = 0;
    startAtCtxTimeRef.current = 0;
    pausedAtPerformanceTimeRef.current = null;
    stopAllSources();
    engine.current?.dispose(); engine.current = null;
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
  }, [flushDebouncedRecordingEvents, stopAllSources, tracks]);

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
        disposeAudioEffects(effectNodes);
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
        if (record.playbackGain && record.playbackGain !== 1) {
          for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const samples = audioBuffer.getChannelData(channel);
            for (let i = 0; i < samples.length; i++) samples[i] /= record.playbackGain;
          }
        }

        if (isCancelled || !activeTrackIds.has(track.id)) {
          return;
        }

        await prepareAudioEffects(context);
        if (isCancelled) return;
        buffersRef.current[track.id] = audioBuffer;
        const gain = context.createGain();
        const effectNodes = createEffectNodes(context);
        effectNodes.node.onprocessorerror = () => playbackErrorRef.current?.('Audio effects stopped. Reload the player to retry.');
        const analyser = context.createAnalyser();

        analyser.fftSize = 2048;

        connectStemEffects(gain, effectNodes, analyser);
        analyser.connect(masterGain.current!);

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
        }
      } catch (error) {
        if (!isCancelled) playbackErrorRef.current?.(`Could not load ${track.name}. Playing the Spotify capture instead.`);
        console.error("Failed to analyze track envelope", track.name, error);
      }
    };

    void (async () => {
      await Promise.all(tracks.map((track) => analyzeTrack(track)));
      if (isCancelled || !tracks.length || tracks.some(track => !buffersRef.current[track.id])) return;
      try {
        const next = await TempoEngine.create(context, tracks.map(t => buffersRef.current[t.id]), tracks.map(t => gainNodesRef.current[t.id]), message => {
          setTransportError(message); setIsPlaying(false); playbackErrorRef.current?.(message);
        });
        if (isCancelled) { next.dispose(); return; }
        engine.current = next; next.set(tempoRef.current, pitchRef.current); setEngineReady(true);
      } catch (reason) { if (!isCancelled) setTransportError(`Could not prepare tempo processing: ${String(reason)}`); }
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
    record.playbackGain,
    tracks,
  ]);

  useEffect(() => {
    tracks.forEach((track) => {
      applyEffectiveVolume(track.id);
    });
  }, [applyEffectiveVolume, getEffectiveVolume, tracks]);

  useEffect(() => {
    const canvases = [...Object.values(canvasRefs.current), combinedCanvas.current].filter((c): c is HTMLCanvasElement => !!c);
    const resize = () => { canvases.forEach(resizeVisualizer); visualRevision.current++; };
    const observer = new ResizeObserver(resize);
    canvases.forEach(canvas => observer.observe(canvas));
    resize(); window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, [shouldShowVisualizerPicker, spotlightTrackId, tracks, visualizerType]);

  useEffect(() => {
    const canvases = [...Object.values(canvasRefs.current), combinedCanvas.current].filter((c): c is HTMLCanvasElement => !!c);
    canvases.forEach(canvas => { resetVisualizerState(canvas); resetSpectrogram(canvas); resetCombinedVisualizer(canvas); });
    return () => canvases.forEach(canvas => { resetVisualizerState(canvas); resetSpectrogram(canvas); resetCombinedVisualizer(canvas); });
  }, [tracks, visualizerType]);

  const plateArtwork = useRef(musicNoteArtwork);
  const artworkSrc = typeof trackMetadata?.trackArtworkSrc === 'string' ? trackMetadata.trackArtworkSrc : '';
  useEffect(() => {
    const controller = new AbortController();
    plateArtwork.current = musicNoteArtwork; visualRevision.current++;
    if (visualizerType === 'resonance-plate') void loadPlateArtwork(artworkSrc, controller.signal).then(field => {
      if (controller.signal.aborted) return;
      plateArtwork.current = field; visualRevision.current++;
    });
    return () => controller.abort();
  }, [artworkSrc, visualizerType]);

  useEffect(() => {
    const taps = new Map<string, StereoTap>();
    const canvases = [...Object.values(canvasRefs.current), combinedCanvas.current].filter((c): c is HTMLCanvasElement => !!c);
    const visible = new Set(canvases.filter(canvasVisible));
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const canvas = entry.target as HTMLCanvasElement;
        if (entry.isIntersecting) {
          if (!visible.has(canvas)) { resetSpectrogram(canvas); resetCombinedVisualizer(canvas); }
          visible.add(canvas);
        }
        else visible.delete(canvas);
      });
      visualRevision.current++;
    });
    canvases.forEach(canvas => observer.observe(canvas));
    const visibilityChanged = () => {
      if (!document.hidden) { canvases.forEach(canvas => { resetSpectrogram(canvas); resetCombinedVisualizer(canvas); }); visualRevision.current++; }
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    let revision = -1, settleUntil = performance.now() + 1500, lastPosition = -1;
    const draw = (now: number) => {
      drawAnimationFrameRef.current = requestAnimationFrame(draw);
      if (document.hidden) return;
      const playbackTime = currentPlaybackTime();
      if (visualRevision.current !== revision || playbackTime !== lastPosition) {
        revision = visualRevision.current; lastPosition = playbackTime; settleUntil = now + 1500;
      }
      if (!isPlaying && now > settleUntil) return;
      const canDraw = (canvas: HTMLCanvasElement) => visible.has(canvas) && canvas.checkVisibility();
      if (isCombinedVisualizer(visualizerType)) {
        const canvas = combinedCanvas.current;
        if (canvas && canDraw(canvas)) drawCombinedVisualizer(visualizerType, canvas, tracks.flatMap(track => {
          const analyser = analyserNodesRef.current[track.id];
          return analyser ? [{name: track.name, input: track.isInput, analyser, audible: getEffectiveVolumeFromRefs(track.id) > 0}] : [];
        }), playbackTime, isPlaying, plateArtwork.current);
        return;
      }
      const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
      for (const track of tracks) {
        const analyser = analyserNodesRef.current[track.id], canvas = canvasRefs.current[track.id];
        if (!analyser || !canvas || !canDraw(canvas)) {
          taps.get(track.id)?.dispose(); taps.delete(track.id); continue;
        }
        if (visualizerType === 'spectrogram') drawSpectrogram(canvas, analyser, playbackTime, isPlaying);
        else if (visualizerType === 'stereo-bloom') {
          let tap = taps.get(track.id);
          if (!tap) { tap = createStereoTap(analyser); taps.set(track.id, tap); }
          drawStereoBloom(canvas, tap);
        } else drawVisualizer({ analyser, canvas, visualizerType, amplitudeEnvelope: amplitudeEnvelopes[track.id],
          amplitudeMaximum: amplitudeMaximums[track.id], sampleRate, currentTime: playbackTime, duration: duration || 0,
          isPlaying, effectiveVolume: getEffectiveVolumeFromRefs(track.id) });
      }
    };
    drawAnimationFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (drawAnimationFrameRef.current !== null) cancelAnimationFrame(drawAnimationFrameRef.current);
      observer.disconnect(); document.removeEventListener("visibilitychange", visibilityChanged); taps.forEach(tap => tap.dispose());
    };
  }, [amplitudeEnvelopes, amplitudeMaximums, currentPlaybackTime, duration, getEffectiveVolumeFromRefs, isPlaying, tracks, visualizerType]);

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
        if (hasHandledPlaybackEndRef.current) {
          timeAnimationFrameRef.current = requestAnimationFrame(updateTime);
          return;
        }

        hasHandledPlaybackEndRef.current = true;
        stopAllSources();
        startOffsetRef.current = hasNextTrack && onTrackEnd ? 0 : duration;
        setCurrentTime(hasNextTrack && onTrackEnd ? 0 : duration);
        setIsPlaying(false);
        if (hasNextTrack && onTrackEnd) {
          onTrackEnd();
        }
      }

      timeAnimationFrameRef.current = requestAnimationFrame(updateTime);
    };

    timeAnimationFrameRef.current = requestAnimationFrame(updateTime);

    return () => {
      if (timeAnimationFrameRef.current !== null) {
        cancelAnimationFrame(timeAnimationFrameRef.current);
      }
    };
  }, [
    currentPlaybackTime,
    duration,
    hasNextTrack,
    isPlaying,
    onTrackEnd,
    stopAllSources,
  ]);

  const handleHarmonicAnalyze = useCallback(async (force = false) => {
    const audioBuffer = inputTrackId ? buffersRef.current[inputTrackId] : undefined;
    if (!audioBuffer) { setChordStatus("Original audio still loading..."); return; }
    harmonicRun.current?.abort();
    const run = new AbortController(); harmonicRun.current = run;
    const current = () => harmonicRun.current === run && !run.signal.aborted;
    setIsHarmonicAnalysisRunning(true);
    setChordStatus("Checking harmony...");
    try {
      if (!force) {
        try {
          const cached = await getCachedChordTimeline(record.md5);
          if (!current()) return;
          if (cached?.analyzerVersion === CHORD_ANALYZER_VERSION) {
            setChordTimeline(cached.timeline); setChordStatus("Harmony ready"); return;
          }
        } catch (error) { console.warn("Failed to load cached harmony", error); }
      }
      if (!current()) return;
      const timeline = await analyzeChordTimeline(audioBuffer, {
        signal: run.signal,
        onProgress: fraction => { if (current()) setChordStatus(`Analyzing harmony… ${Math.round(fraction * 100)}%`); },
      });
      if (!current()) return;
      setChordTimeline(timeline);
      setChordStatus(timeline.some(frame => frame.chord !== "Unclear") ? "Harmony ready" : "No clear chords detected");
      try { await cacheChordTimeline(record.md5, timeline, CHORD_ANALYZER_VERSION); }
      catch (error) { console.warn("Failed to cache harmony", error); }
    } catch (error) {
      if (harmonicRun.current !== run) return;
      if (run.signal.aborted) setChordStatus("Scan canceled");
      else { console.error("Harmony scan failed", error); setChordStatus("Unable to analyze harmony. Try again."); }
    } finally {
      if (harmonicRun.current === run) { harmonicRun.current = null; setIsHarmonicAnalysisRunning(false); }
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
      const epoch = playbackEpoch.current;
      await context.resume();
      if (epoch !== playbackEpoch.current) return;
      if (context.state !== 'running') { setTransportError('Click Play to enable sound.'); return; }
      setTransportError('');
      if (!engine.current) throw new Error('Audio processor is still loading.');
      engine.current.set(tempoRef.current, pitchRef.current);
      Object.values(effectNodesRef.current).forEach(nodes=>syncAudioEffects(nodes,offsetSeconds,tempoRef.current,context.currentTime+.02));
      await engine.current.start(offsetSeconds);
      if (epoch !== playbackEpoch.current) return;
      startOffsetRef.current = offsetSeconds;
      hasHandledPlaybackEndRef.current = false;
      setIsPlaying(true);
    },
    [ensureAudioContext, tracks]
  );

  const commitSeek = useCallback(
    async (targetTime: number) => {
      Object.values(canvasRefs.current).forEach(canvas => { if (canvas) resetSpectrogram(canvas); });
      remoteObserver.current.commanded();
      const clampedTime = Math.max(0, Math.min(targetTime, duration || 0));

      if (isPlaying) {
        stopAllSources();
        startOffsetRef.current = clampedTime;
        await schedulePlayback(clampedTime);
      } else {
        startOffsetRef.current = clampedTime;
        setCurrentTime(clampedTime);
      }
      onTransportCommand?.({ action: 'seek', position: clampedTime });
    },
    [duration, isPlaying, schedulePlayback, stopAllSources, onTransportCommand]
  );

  const handleSeekChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(event.target.value);
    setCurrentTime(newTime);
    pendingSeekRef.current = newTime;

    if (!isDraggingSeekRef.current) {
      void commitSeek(newTime);
      emitRecordingEvent(
        "seek_commit",
        { targetSeconds: roundTrackTime(newTime), source: "slider" },
        newTime
      );
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
      emitRecordingEvent(
        "seek_commit",
        { targetSeconds: roundTrackTime(pending), source: "slider" },
        pending
      );
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
      emitRecordingEvent(
        "seek_commit",
        { targetSeconds: roundTrackTime(targetTime), source: "canvas" },
        targetTime
      );
    },
    [commitSeek, currentTime, duration, emitRecordingEvent, visualizerType]
  );

  const pausePlayback = useCallback(() => {
    const context = audioCtxRef.current;

    if (!context) {
      setIsPlaying(false);
      return startOffsetRef.current;
    }

    startOffsetRef.current = engine.current?.pause() ?? startOffsetRef.current;
    if(audioCtxRef.current)Object.values(effectNodesRef.current).forEach(nodes=>syncAudioEffects(nodes,startOffsetRef.current,0,audioCtxRef.current!.currentTime));
    stopAllSources();
    setIsPlaying(false);
    return startOffsetRef.current;
  }, [stopAllSources]);

  const handlePlayPause = useCallback(async () => {
    remoteObserver.current.commanded();
    if (!tracks.length) {
      return;
    }

    if (isPlaying) {
      const pausedAt = pausePlayback();
      pausedAtPerformanceTimeRef.current = performance.now();
      emitRecordingEvent("transport_pause", undefined, pausedAt);
      onTransportCommand?.({action:'pause'});
      return;
    }

    const playPayload = pausedAtPerformanceTimeRef.current
      ? {
        durationSeconds: roundDuration(
          (performance.now() - pausedAtPerformanceTimeRef.current) / 1000
        ),
      }
      : undefined;
    pausedAtPerformanceTimeRef.current = null;
    await schedulePlayback(startOffsetRef.current);
    emitRecordingEvent("transport_play", playPayload);
    onTransportCommand?.({action:'play'});
  }, [
    emitRecordingEvent,
    isPlaying,
    pausePlayback,
    schedulePlayback,
    tracks.length, onTransportCommand,
  ]);

  const selectVisualizerType = useCallback(
    (nextVisualizerType: VisualizerType | undefined) => {
      if (!nextVisualizerType || nextVisualizerType === visualizerType) {
        return;
      }

      emitRecordingEvent("visualizer_change", {
        previous: visualizerType,
        next: nextVisualizerType,
      });
      if (isCombinedVisualizer(nextVisualizerType)) setSpotlightState(null);
      setVisualizerType(nextVisualizerType);
    },
    [emitRecordingEvent, visualizerType]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (replaying) return;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
          (target instanceof Element && target.closest('input,textarea,select,button,a,[contenteditable="true"],[role="slider"]'))) return;
      if (event.repeat) return;
      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        void handlePlayPause();
        return;
      }

      if (event.code === "ArrowRight" || event.key === "ArrowRight") {
        event.preventDefault();
        const currentIndex = visualizerOptions.findIndex(
          (option) => option.value === visualizerType
        );

        if (currentIndex === -1) {
          selectVisualizerType(visualizerOptions[0]?.value ?? "time-ribbon");
          return;
        }

        selectVisualizerType(
          visualizerOptions[
            (currentIndex + 1) % visualizerOptions.length
          ]?.value
        );
        return;
      }

      if (event.code === "ArrowLeft" || event.key === "ArrowLeft") {
        event.preventDefault();
        const currentIndex = visualizerOptions.findIndex(
          (option) => option.value === visualizerType
        );

        if (currentIndex === -1) {
          selectVisualizerType(visualizerOptions[0]?.value ?? "time-ribbon");
          return;
        }

        selectVisualizerType(
          visualizerOptions[
            (currentIndex - 1 + visualizerOptions.length) %
            visualizerOptions.length
          ]?.value
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handlePlayPause, selectVisualizerType, visualizerType,replaying]);

  const handleVolumeChange = (trackId: string, value: number) => {
    setVolumes((previous) => ({ ...previous, [trackId]: value }));
    applyEffectiveVolume(trackId, value);
    queueDebouncedRecordingEvent(
      `volume:${trackId}`,
      createRecordingEvent("volume_change", {
        ...getStemRecordingPayload(trackId),
        value,
      })
    );
  };

  const handleVolumeReset = (trackId: string) => {
    cancelDebouncedRecordingEvent(`volume:${trackId}`);
    setVolumes((previous) => ({ ...previous, [trackId]: 1 }));
    applyEffectiveVolume(trackId, 1);
    emitRecordingEvent("volume_reset", getStemRecordingPayload(trackId));
  };

  const enableEditedEffect = (trackId: string) => {
    const settings = effectSettingsRef.current[trackId];
    // Old recordings/settings can contain bypass. Keep their playback intact,
    // but editing the effect must work without a separate enable button.
    if (!settings?.bypass) return;
    effectSettingsRef.current = { ...effectSettingsRef.current, [trackId]: { ...settings, bypass: false } };
    setEffectSettings(effectSettingsRef.current);
  };

  const handleEffectValueChange = (trackId: string, value: number) => {
    enableEditedEffect(trackId);
    const clamped = Math.min(1, Math.max(0, value));

    effectValuesRef.current[trackId]=clamped;
    setEffectValues((previous) => ({ ...previous, [trackId]: clamped }));
    applyEffectValue(trackId, clamped);
    queueDebouncedRecordingEvent(
      `effect-value:${trackId}`,
      createRecordingEvent("effect_value_change", {
        ...getStemRecordingPayload(trackId),
        value: clamped,
      })
    );
  };

  const handleEffectSettingsChange = (trackId:string,settings:EffectSettings) => {
    effectSettingsRef.current={...effectSettingsRef.current,[trackId]:settings};
    setEffectSettings(effectSettingsRef.current);
    applyEffectValue(trackId);
    emitRecordingEvent('effect_value_change',getStemRecordingPayload(trackId));
  };

  const handleEffectTypeChange = (
    trackId: string,
    effectType: AudioEffectType
  ) => {
    enableEditedEffect(trackId);
    cancelDebouncedRecordingEvent(`effect-value:${trackId}`);
    const defaultValue = getDefaultEffectValue(effectType);
    effectValuesRef.current[trackId] = defaultValue;
    setEffectValues((previous) => ({ ...previous, [trackId]: defaultValue }));
    effectTypesRef.current[trackId]=effectType;
    setEffectTypes((previous) => ({ ...previous, [trackId]: effectType }));
    applyEffectValue(trackId, defaultValue, effectType);
    emitRecordingEvent("effect_type_change", {
      ...getStemRecordingPayload(trackId),
      effectType,
    });
  };

  const handleEffectReset = (trackId: string) => {
    enableEditedEffect(trackId);
    cancelDebouncedRecordingEvent(`effect-value:${trackId}`);
    const defaultValue = getDefaultEffectValue(
      effectTypesRef.current[trackId] ?? "wah"
    );
    effectValuesRef.current[trackId] = defaultValue;
    setEffectValues((previous) => ({
      ...previous,
      [trackId]: defaultValue,
    }));
    applyEffectValue(trackId, defaultValue);
    emitRecordingEvent("effect_reset", getStemRecordingPayload(trackId));
  };

  const toggleTrackSpotlight = useCallback((track: Track) => {
    const nextState = nextSpotlightState(spotlightState, track);

    setSpotlightState(nextState);
    emitRecordingEvent(
      "spotlight_toggle",
      nextState ? serializeSpotlightState(nextState) : null
    );
  }, [emitRecordingEvent, spotlightState]);

  const toggleTrackMute = (trackId: string) => {
    const nextValue = !trackMuteStates[trackId];

    setTrackMuteStates((previous) => ({
      ...previous,
      [trackId]: !previous[trackId],
    }));
    applyEffectiveVolume(trackId);
    emitRecordingEvent("mute_toggle", {
      ...getStemRecordingPayload(trackId),
      value: nextValue,
    });
  };

  const toggleTrackDeafen = (trackId: string) => {
    const nextValue = !trackDeafenStates[trackId];

    setTrackDeafenStates((previous) => {
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
    emitRecordingEvent("deafen_toggle", {
      ...getStemRecordingPayload(trackId),
      value: nextValue,
    });
  };

  const areTracksReady =
    engineReady && tracks.length > 0 && readyTrackIds.length === tracks.length;
  useEffect(() => {
    const update = () => {
      const context = audioCtxRef.current, gain = masterGain.current;
      if (context && gain) {
        const volume = Math.max(0, Math.min(1, masterVolume));
        gain.gain.cancelScheduledValues(context.currentTime);
        if (volume === 0) gain.gain.setValueAtTime(0, context.currentTime);
        else gain.gain.setTargetAtTime(volume, context.currentTime, 0.005);
      }
    };
    update(); const timer = setInterval(update, 200); return () => clearInterval(timer);
  }, [masterVolume]);
  const remoteObserver = useRef(new SpotifyRemoteObserver());
  useEffect(() => {
    const change = remoteObserver.current.observe(transport);
    if (!change || !transport || !areTracksReady || record.md5 !== `spotify-${transport.trackId}`) return;
    if (change.playing === false) {
      const position = pausePlayback();
      emitRecordingEvent('transport_pause', undefined, position);
    }
    if (change.position !== undefined) {
      const position = Math.max(0, Math.min(duration, change.position));
      stopAllSources(); startOffsetRef.current = position; setCurrentTime(position);
      emitRecordingEvent('seek_commit', {source:'remote'}, position);
    }
    if (change.playing === true || (change.position !== undefined && isPlaying && change.playing !== false)) {
      void schedulePlayback(startOffsetRef.current).then(() => {
        if (change.playing === true) emitRecordingEvent('transport_play');
      }).catch(reason => setTransportError(String(reason)));
    }
  }, [transport, areTracksReady, record.md5, duration, isPlaying, pausePlayback, schedulePlayback, stopAllSources, emitRecordingEvent]);
  useEffect(() => {
    if (transport && tracks.length && readyTrackIds.length < tracks.length && unavailableMessage) onPlaybackError?.(unavailableMessage);
  }, [transport, tracks.length, readyTrackIds.length, unavailableMessage, onPlaybackError]);
  useEffect(() => {
    if (isRecording && areTracksReady) onRecordingEventRef.current?.({type:'mixer_snapshot',trackTimeSeconds:currentPlaybackTime(),payload:{snapshot:snapshot()}});
  }, [isRecording,areTracksReady,tempo,pitch,volumes,trackMuteStates,trackDeafenStates,effectValues,effectTypes,effectSettings,visualizerType,spotlightState,snapshot,currentPlaybackTime]);

  useEffect(() => {
    if (areTracksReady && !replaying) onSettingsChange?.(snapshot());
  }, [areTracksReady, replaying, onSettingsChange, snapshot, tempo, pitch, volumes, trackMuteStates, trackDeafenStates, effectValues, effectTypes, effectSettings]);

  useEffect(() => {
    onControls?.({
      trackId:record.md5,ready:areTracksReady,position:currentPlaybackTime,snapshot,playing:()=>isPlaying,
      play:async () => { stopAllSources(); await schedulePlayback(startOffsetRef.current); },
      pause:pausePlayback,
      seek:async position => { Object.values(canvasRefs.current).forEach(canvas => { if (canvas) resetSpectrogram(canvas); }); const resume = isPlaying; stopAllSources(); startOffsetRef.current = Math.max(0,Math.min(duration,position)); setCurrentTime(startOffsetRef.current); if (resume) await schedulePlayback(startOffsetRef.current); },
      apply:value => {
        applyTempoPitch(value.tempo ?? 1, value.pitch ?? 0);
        if (!supportsVisualizer(value.visualizer) || value.stems.length !== tracks.length) throw new Error('Recording requires an unsupported mixer layout.');
        const v: Record<string,number> = {}, m: Record<string,boolean> = {}, d: Record<string,boolean> = {}, e: Record<string,AudioEffectType> = {}, x: Record<string,number> = {}, options: Record<string,EffectSettings> = {};
        for (const track of tracks) {
          const stem = value.stems.find(stem => stem.name === track.name && stem.input === track.isInput);
          if (!stem || !isAudioEffect(stem.effect)) throw new Error('Recording requires a different stem or effect version.');
          v[track.id]=stem.volume; m[track.id]=stem.mute; d[track.id]=stem.deafen; e[track.id]=stem.effect as AudioEffectType; x[track.id]=stem.value;options[track.id]={...(stem.effectSettings ?? defaultEffectSettings)};
        }
        effectSettingsRef.current=options;setEffectSettings(options);
        volumesRef.current=v; trackMuteStatesRef.current=m; trackDeafenStatesRef.current=d; effectTypesRef.current=e; effectValuesRef.current=x;
        setVolumes(v);setTrackMuteStates(m);setTrackDeafenStates(d);setEffectTypes(e);setEffectValues(x);
        setVisualizerType(value.visualizer as VisualizerType);setSpotlightState(value.spotlight as SpotlightState | null);
        for (const track of tracks) {
          const gain = gainNodesRef.current[track.id], ctx = audioCtxRef.current;
          if (gain && ctx) gain.gain.setTargetAtTime(getEffectiveVolumeFromRefs(track.id),ctx.currentTime,0.01);
          applyEffectValue(track.id,x[track.id],e[track.id]);
        }
      },
    });

  }, [onControls,applyTempoPitch,record.md5,areTracksReady,currentPlaybackTime,snapshot,stopAllSources,schedulePlayback,pausePlayback,isPlaying,duration,tracks,applyEffectValue,getEffectiveVolumeFromRefs]);

  const recordingButtonDisabled = isRecording
    ? !onStopRecording
    : replaying || !areTracksReady || isPlaying || !onStartRecording;

  const handleRecordingButton = useCallback(async () => {
    if (isRecording) {
      flushDebouncedRecordingEvents();
      remoteObserver.current.commanded();
      onTransportCommand?.({action:'pause'});
      const stoppedAt = isPlaying ? pausePlayback() : currentPlaybackTime();
      pausedAtPerformanceTimeRef.current = null;
      await onStopRecording?.(
        createRecordingEvent("record_stop", undefined, stoppedAt)
      );
      return;
    }

    if (isPlaying || !areTracksReady || !onStartRecording) {
      return;
    }

    const startTime = currentPlaybackTime();
    const didStart = await onStartRecording({
      trackTimeSeconds: roundTrackTime(startTime),
      snapshot: snapshot(),
    });

    if (!didStart) {
      return;
    }

    pausedAtPerformanceTimeRef.current = null;
    isRecordingRef.current = true;
    remoteObserver.current.commanded();
    await schedulePlayback(startOffsetRef.current);
    emitRecordingEvent('transport_play');
    onTransportCommand?.({action: 'play'});
  }, [
    onTransportCommand,
    emitRecordingEvent,
    areTracksReady,
    snapshot,
    createRecordingEvent,
    currentPlaybackTime,
    flushDebouncedRecordingEvents,
    isPlaying,
    isRecording,
    onStartRecording,
    onStopRecording,
    pausePlayback,
    schedulePlayback,
  ]);

  useEffect(() => {
    if (!autoPlayOnReady) {
      hasAttemptedAutoPlayOnReadyRef.current = false;
      return;
    }

    if (
      hasAttemptedAutoPlayOnReadyRef.current ||
      isPlaying ||
      !areTracksReady
    ) {
      return;
    }

    hasAttemptedAutoPlayOnReadyRef.current = true;
    startOffsetRef.current = 0;
    setCurrentTime(0);

    const playWhenReady = async () => {
      try {
        await schedulePlayback(0);
        emitRecordingEvent('transport_play', undefined, 0);
      } catch (error) {
        console.error("Failed to auto-play next track", error);
      } finally {
        onAutoPlayOnReadyHandled?.();
      }
    };

    void playWhenReady();
  }, [
    areTracksReady,
    autoPlayOnReady,
    isPlaying,
    onAutoPlayOnReadyHandled,
    schedulePlayback,
    emitRecordingEvent,
  ]);

  useEffect(() => {
    // Track changes/unmounts cancel analysis before stale results can update the UI.
    harmonicRun.current?.abort(); harmonicRun.current = null;
    setChordTimeline([]);
    setChordStatus(
      inputTrackId
        ? "Harmonic analyzer standing by"
        : "No original audio available for analysis"
    );
    setIsHarmonicAnalysisRunning(false);
    return () => { harmonicRun.current?.abort(); harmonicRun.current = null; };
  }, [inputTrackId, record.md5]);

  return (
    <div
      className={`player-shell${spotlightTrackId ? " player-shell--spotlight" : ""}`}
      style={{
        padding: 0,
        background: "transparent",
      }}
    >
      <div
        className="player-main-controls"
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
              className="player-transport-button"
              onClick={() => {
                flushDebouncedRecordingEvents();
                onPreviousTrack?.();
              }}
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
              <span
                className="player-transport-icon player-transport-icon--previous"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className={`player-transport-button${isPlaying ? " player-transport-button--active" : ""}`}
              onClick={() => void handlePlayPause()}
              disabled={!areTracksReady}
              title={transportError || undefined}
              aria-label={isPlaying ? "Pause" : "Play"}
              style={{
                fontSize: "20px",
                height: "40px",
                lineHeight: 1,
                minWidth: "44px",
                padding: "0 0.5rem",
              }}
            >
              <span
                className={`player-transport-icon player-transport-icon--${isPlaying ? "pause" : "play"}`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className="player-transport-button"
              onClick={() => {
                flushDebouncedRecordingEvents();
                onNextTrack?.();
              }}
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
              <span
                className="player-transport-icon player-transport-icon--next"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className={`player-record-button${isRecording ? " player-record-button--active" : ""}`}
              onClick={() => void handleRecordingButton()}
              disabled={recordingButtonDisabled}
              aria-label={
                isRecording ? "Stop and save recording" : "Start recording"
              }
              aria-pressed={isRecording}
              title={
                isRecording
                  ? "Stop and save recording"
                  : isPlaying
                    ? "Pause playback before recording"
                    : "Start recording"
              }
            >
              <span className="player-record-button__mark" aria-hidden="true" />
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
                  aria-label="Playback position"
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
              <div className="player-tuning" aria-label="Tempo and pitch">
                <label>Tempo<input type="range" aria-label="Tempo" min="0.5" max="1.5" step="0.01" value={tempo}
                  disabled={!areTracksReady || !tempoSupported || replaying} title={!tempoSupported ? 'Update the ktv420 extension to change tempo.' : 'Change tempo, preserve pitch'}
                  onChange={event => { const rate = Number(event.target.value); applyTempoPitch(rate,pitchRef.current); }} /></label>
                <button type="button" className="player-tuning-reset" aria-label="Reset tempo" disabled={!tempoSupported || replaying} onClick={() => { applyTempoPitch(1,pitchRef.current); }}>{tempo.toFixed(2)}×</button>
                <label>Pitch<input type="range" aria-label="Pitch" min="-12" max="12" step="1" value={pitch} disabled={!areTracksReady || replaying}
                  onChange={event => applyTempoPitch(tempoRef.current,Number(event.target.value))} /></label>
                <button type="button" className="player-tuning-reset" aria-label="Reset pitch" disabled={replaying} onClick={() => applyTempoPitch(tempoRef.current,0)}>{pitch > 0 ? '+' : ''}{pitch} st</button>
              </div>
              {transportError && <p role="status">{transportError}</p>}
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
                  title={currentChord ? (currentChord.chord === "Unclear" ? "Not enough tonal evidence for a chord" : `${currentChord.confidence >= .85 ? "Strong" : "Tentative"} chord estimate from the original audio`) : undefined}
                >
                  <span style={{ fontWeight: 700, color: "var(--ww-text)" }}>{pitch ? 'Source chord:' : 'Chord:'}</span>
                  <span
                    style={{ fontStyle: chordTimeline.length ? "normal" : "italic" }}
                  >
                    {chordDisplay}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => { if (isHarmonicAnalysisRunning) harmonicRun.current?.abort(); else void handleHarmonicAnalyze(chordTimeline.length > 0); }}
                  disabled={!isInputTrackReady && !isHarmonicAnalysisRunning}
                  style={{
                    fontSize: "0.9em",
                    height: "32px",
                    padding: "0 0.6rem",
                  }}
                >
                  {isHarmonicAnalysisRunning
                    ? "Cancel scan"
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
          <div className="player-track-list" style={{ marginTop: "1rem" }}>
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                hideCanvas={isCombinedVisualizer(visualizerType)}
                seekable={visualizerType === "time-ribbon" || visualizerType === "super-time-ribbon"}
                volume={volumes[track.id] ?? 1}
                isMuted={!!trackMuteStates[track.id]}
                isDeafened={!!trackDeafenStates[track.id]}
                effectType={effectTypes[track.id] ?? "wah"}
                effectValue={
                  effectValues[track.id] ??
                  getDefaultEffectValue(effectTypes[track.id] ?? "wah")
                }
                effectOptions={audioEffectOptions}
                effectSettings={effectSettings[track.id] ?? defaultEffectSettings}
                onEffectSettingsChange={handleEffectSettingsChange}
                onVolumeChange={handleVolumeChange}
                onVolumeReset={handleVolumeReset}
                onEffectValueChange={handleEffectValueChange}
                onEffectTypeChange={handleEffectTypeChange}
                onResetEffect={handleEffectReset}
                onToggleMute={toggleTrackMute}
                onToggleDeafen={toggleTrackDeafen}
                isSpotlighted={spotlightTrackId === track.id}
                onToggleSpotlight={() => { if (!isCombinedVisualizer(visualizerType)) toggleTrackSpotlight(track); }}
                registerCanvas={(ref) => {
                  canvasRefs.current[track.id] = ref;
                }}
                onCanvasSeek={handleCanvasSeek}
              />
            ))}
          </div>
          {isCombinedVisualizer(visualizerType) && <CombinedVisualizerPanel type={visualizerType} canvasRef={combinedCanvas}
            expanded={combinedVisualizerExpanded} onExpandedChange={onCombinedVisualizerExpandedChange} />}
          <VisualizerPicker value={visualizerType} onChange={selectVisualizerType} hidden={!shouldShowVisualizerPicker} />
        </>
      ) : null}
    </div>
  );
}

function nextSpotlightState(
  current: SpotlightState | null,
  track: Track
): SpotlightState | null {
  const nextIntent: SpotlightIntent = track.isInput
    ? { kind: "input" }
    : { kind: "output", name: track.name };
  const currentIntent = current?.intent;
  const isCurrentIntent =
    currentIntent?.kind === nextIntent.kind &&
    (nextIntent.kind === "input" ||
      (currentIntent?.kind === "output" &&
        currentIntent.name === nextIntent.name));

  if (!isCurrentIntent) {
    return { intent: nextIntent, level: "track" };
  }

  if (current?.level === "track") {
    return { intent: nextIntent, level: "track-with-selectors" };
  }

  return null;
}

function serializeSpotlightState(state: SpotlightState) {
  return {
    level: state.level,
    intent:
      state.intent.kind === "input"
        ? { kind: "input" }
        : { kind: "output", name: state.intent.name },
  };
}

function roundTrackTime(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value * 1000) / 1000);
}

function roundDuration(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value * 1000) / 1000);
}
