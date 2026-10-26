import { type CSSProperties, type PointerEvent } from "react";

import { type AudioEffectOption, type AudioEffectType, type EffectSettings, getEffectOption, getDefaultEffectValue, effectAmountLabel, beatOptions } from "./audioEffects";
import { type Track } from "./types";

type TrackRowProps = {
  track: Track;
  hideCanvas?: boolean;
  seekable?: boolean;
  volume: number;
  isMuted: boolean;
  isDeafened: boolean;
  effectType: AudioEffectType;
  effectValue: number;
  effectOptions: AudioEffectOption[];
  effectSettings: EffectSettings;
  onEffectSettingsChange: (trackId:string,settings:EffectSettings) => void;
  onVolumeChange: (trackId: string, value: number) => void;
  onVolumeReset: (trackId: string) => void;
  onEffectValueChange: (trackId: string, value: number) => void;
  onEffectTypeChange: (trackId: string, value: AudioEffectType) => void;
  onResetEffect: (trackId: string) => void;
  onToggleMute: (trackId: string) => void;
  onToggleDeafen: (trackId: string) => void;
  isSpotlighted: boolean;
  onToggleSpotlight: () => void;
  registerCanvas: (canvas: HTMLCanvasElement | null) => void;
  onCanvasSeek: (event: PointerEvent<HTMLCanvasElement>) => void;
};

export function TrackRow({
  track,
  hideCanvas = false,
  seekable = false,
  volume,
  isMuted,
  isDeafened,
  effectType,
  effectValue,
  effectOptions, effectSettings, onEffectSettingsChange,
  onVolumeChange,
  onVolumeReset,
  onEffectValueChange,
  onEffectTypeChange,
  onResetEffect,
  onToggleMute,
  onToggleDeafen,
  isSpotlighted,
  onToggleSpotlight,
  registerCanvas,
  onCanvasSeek,
}: TrackRowProps) {
  const label = track.isInput
    ? "Original"
    : track.name.replace(/\.(wav|mp3)$/i, "").replace(/^./, (letter) => letter.toUpperCase());
  const selectedEffect = getEffectOption(effectType);
  const effectDescription = selectedEffect?.description ?? "";

  const controlButtonStyle = (isActive: boolean): CSSProperties => ({
    borderRadius: "99rem",
    border: isActive
      ? "0.0625rem solid var(--ww-accent-amber)"
      : "0.0625rem solid var(--ww-border)",
    background: isActive
      ? "var(--ww-audio-bg)"
      : "var(--ktv-control-bg)",
    color: isActive ? "var(--ww-text-strong)" : "var(--ww-text)",
    padding: "0.38rem 0.77rem",
    letterSpacing: "0.02em",
    fontWeight: isActive ? 800 : 600,
    minWidth: "4.875rem",
    boxShadow: isActive
      ? "inset 0 0 0 0.0625rem var(--ww-audio-border)"
      : "none",
    transition: "all 160ms ease",
    cursor: "pointer",
  });

  return (
    <div
      key={track.id}
      className={`player-track-row${isSpotlighted ? " player-track-row--spotlight" : ""}`}
      style={{
        background: "var(--ww-panel-strong)",
        border: "0.0625rem solid var(--ww-border-strong)",
        borderRadius: "0.4375rem",
        boxShadow: "0 0.5625rem 1.25rem rgba(0, 0, 0, 0.24)",
        marginBottom: "0.72rem",
        padding: "0.64rem",
      }}
    >
      <div
        className="player-track-row__header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.43rem",
          flexWrap: "wrap",
          justifyContent: "space-between",
          marginBottom: "0.34rem",
        }}
      >
        <button
          type="button"
          className="player-track-row__name"
          onClick={onToggleSpotlight}
          disabled={hideCanvas}
          aria-pressed={isSpotlighted}
          title={hideCanvas ? "This visualizer shows the whole mix" : isSpotlighted ? "Exit spotlight view" : "Spotlight track"}
          style={{ minWidth: "187px", fontWeight: 600, color: "var(--ww-text)" }}
        >
          {label}
        </button>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flex: "0 1 357px",
            gap: "0.34rem",
            minWidth: "238px",
          }}
        >
          <input
            type="range"
            aria-label={`${label} volume`}
            min={0}
            max={2}
            step={0.01}
            value={volume}
            onChange={(event) =>
              onVolumeChange(track.id, Number(event.target.value))
            }
            onDoubleClick={() => onVolumeReset(track.id)}
            style={{ flex: "0 1 187px", minWidth: "119px" }}
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
        <div className="stem-effect-controls">
          <label
            style={{ display: "flex", alignItems: "center", gap: "0.34rem" }}
          >
            <span
              title={effectDescription}
              style={{ color: "var(--ww-text-soft)", fontWeight: 600 }}
            >
              Effect
            </span>
            <select
              aria-label={`${label} effect`}
              value={effectType}
              onChange={(event) =>
                onEffectTypeChange(track.id, event.target.value as AudioEffectType)
              }
              style={{
                background: "var(--ww-panel-strong)",
                border: "1px solid var(--ww-border)",
                color: "var(--ww-text)",
                padding: "0.21rem 0.34rem",
                borderRadius: "7px",
              }}
            >
              {!effectOptions.some(option=>option.value===effectType) && <option value={effectType}>{selectedEffect.label} (saved)</option>}
              {effectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="range"
              aria-label={`${label} effect amount`}
              min={0}
              max={1}
              step={0.01}
              value={effectValue}
              aria-valuetext={effectAmountLabel(effectType,effectValue)}
              disabled={effectSettings.bypass}
              title={effectDescription}
              onChange={(event) =>
                onEffectValueChange(track.id, Number(event.target.value))
              }
              onDoubleClick={() => onResetEffect(track.id)}
              style={{ width: "102px" }}
            />
          </label>
          <button type="button" className="stem-effect-value" aria-label={`Reset ${label} effect`} title="Reset to clean"
            onClick={()=>onResetEffect(track.id)}>{effectSettings.bypass?'Bypassed':effectAmountLabel(effectType,effectValue)}</button>
          <button type="button" className="stem-effect-bypass" aria-label={`Bypass ${label} effect`} aria-pressed={effectSettings.bypass}
            title={effectSettings.bypass?'Enable effect':'Bypass effect'} onClick={()=>onEffectSettingsChange(track.id,{...effectSettings,bypass:!effectSettings.bypass})}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 2v9M6 5a9 9 0 1 0 12 0"/></svg>
          </button>
          {effectType==='delay-pedal' && <div className="stem-echo-timing">
            <label>BPM <input type="number" min="40" max="240" step="1" aria-label={`${label} echo BPM`} key={effectSettings.bpm} defaultValue={effectSettings.bpm}
              onBlur={event=>{const n=Number(event.target.value),bpm=Number.isFinite(n)&&event.target.value?Math.max(40,Math.min(240,n)):effectSettings.bpm;event.target.value=String(bpm);onEffectSettingsChange(track.id,{...effectSettings,bpm});}}
              onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} /></label>
            <select aria-label={`${label} echo interval`} value={effectSettings.beats} onChange={event=>onEffectSettingsChange(track.id,{...effectSettings,beats:Number(event.target.value)})}>
              {beatOptions.map(beats=><option key={beats} value={beats}>{beats===.25?'¼':beats===.5?'½':beats} {beats===1?'beat':'beats'}</option>)}
            </select>
          </div>}
          <span className="stem-effect-neutral" aria-hidden="true">{getDefaultEffectValue(effectType)===.5?'Center = clean':'Left = clean'}</span>
        </div>
      </div>
      {!hideCanvas && <div className="player-track-row__canvas" style={{ marginTop: "0.34rem" }}>
        <canvas
          ref={registerCanvas}
          width={520}
          height={102}
          aria-label={`${label} visualization`}
          onPointerDown={seekable ? onCanvasSeek : undefined}
          style={{
            border: "1px solid var(--ww-border)",
            background: "linear-gradient(90deg, #120d0b, #1a1411)",
            width: "100%",
            display: "block",
            cursor: seekable ? "pointer" : "default",
          }}
        />
      </div>}
    </div>
  );
}
