import { type CSSProperties, type PointerEvent } from "react";

import { type AudioEffectOption, type AudioEffectType } from "./audioEffects";
import { type Track } from "./types";

type TrackRowProps = {
  track: Track;
  volume: number;
  isMuted: boolean;
  isDeafened: boolean;
  effectType: AudioEffectType;
  effectValue: number;
  effectOptions: AudioEffectOption[];
  onVolumeChange: (trackId: string, value: number) => void;
  onVolumeReset: (trackId: string) => void;
  onEffectValueChange: (trackId: string, value: number) => void;
  onEffectTypeChange: (trackId: string, value: AudioEffectType) => void;
  onResetEffect: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleDeafen: (trackId: string) => void;
  registerCanvas: (canvas: HTMLCanvasElement | null) => void;
  onCanvasSeek: (event: PointerEvent<HTMLCanvasElement>) => void;
};

export function TrackRow({
  track,
  volume,
  isMuted,
  isDeafened,
  effectType,
  effectValue,
  effectOptions,
  onVolumeChange,
  onVolumeReset,
  onEffectValueChange,
  onEffectTypeChange,
  onResetEffect,
  onToggleMute,
  onToggleDeafen,
  registerCanvas,
  onCanvasSeek,
}: TrackRowProps) {
  const label = track.isInput
    ? `Input: ${track.name}`
    : `Output: ${track.name}`;
  const selectedEffect = effectOptions.find(
    (option) => option.value === effectType
  );
  const effectDescription = selectedEffect?.description ?? "";

  const controlButtonStyle = (isActive: boolean): CSSProperties => ({
    borderRadius: "999px",
    border: "1px solid var(--ww-border)",
    background: isActive
      ? "linear-gradient(135deg, rgba(232,206,171,0.16), rgba(201,156,107,0.18))"
      : "var(--ktv-control-bg)",
    color: "var(--ww-text)",
    padding: "0.45rem 0.9rem",
    letterSpacing: "0.02em",
    fontWeight: 600,
    minWidth: "92px",
    boxShadow: isActive
      ? "0 6px 18px rgba(0,0,0,0.3)"
      : "0 4px 12px rgba(0,0,0,0.22)",
    transition: "all 160ms ease",
    cursor: "pointer",
  });

  return (
    <div
      key={track.id}
      style={{
        borderTop: "1px solid var(--ww-border-soft)",
        marginBottom: "0.75rem",
        paddingTop: "0.75rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          justifyContent: "space-between",
          marginBottom: "0.4rem",
        }}
      >
        <div
          style={{ minWidth: "220px", fontWeight: 600, color: "var(--ww-text)" }}
        >
          {label}
        </div>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flex: "0 1 420px",
            gap: "0.4rem",
            minWidth: "280px",
          }}
        >
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={volume}
            onChange={(event) =>
              onVolumeChange(track.id, Number(event.target.value))
            }
            onDoubleClick={() => onVolumeReset(track.id)}
            style={{ flex: "0 1 220px", minWidth: "140px" }}
          />
          <button
            type="button"
            onClick={() => onToggleMute(track.id)}
            style={controlButtonStyle(isMuted)}
            aria-pressed={isMuted}
            aria-label={isMuted ? "Unmute" : "Mute"}
            title={isMuted ? "Unmute" : "Mute"}
          >
            🔇
          </button>
          <button
            type="button"
            onClick={() => onToggleDeafen(track.id)}
            style={controlButtonStyle(isDeafened)}
            aria-pressed={isDeafened}
            aria-label={isDeafened ? "Undeafen" : "Deafen"}
            title={isDeafened ? "Undeafen" : "Deafen"}
          >
            {isDeafened ? "🎧" : "🎧"}
          </button>
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <label
            style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
          >
            <span
              title={effectDescription}
              style={{ color: "var(--ww-text-soft)", fontWeight: 600 }}
            >
              Effect
            </span>
            <select
              value={effectType}
              onChange={(event) =>
                onEffectTypeChange(track.id, event.target.value as AudioEffectType)
              }
              style={{
                background: "var(--ww-panel-strong)",
                border: "1px solid var(--ww-border)",
                color: "var(--ww-text)",
                padding: "0.25rem 0.4rem",
                borderRadius: "8px",
              }}
            >
              {effectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={effectValue}
              onChange={(event) =>
                onEffectValueChange(track.id, Number(event.target.value))
              }
              onDoubleClick={() => onResetEffect(track.id)}
              style={{ width: "120px" }}
            />
          </label>
        </div>
      </div>
      <div style={{ marginTop: "0.4rem" }}>
        <canvas
          ref={registerCanvas}
          width={520}
          height={120}
          onPointerDown={onCanvasSeek}
          style={{
            border: "1px solid var(--ww-border)",
            background: "linear-gradient(90deg, #120d0b, #1a1411)",
            width: "100%",
            display: "block",
            cursor: "pointer",
          }}
        />
      </div>
    </div>
  );
}
