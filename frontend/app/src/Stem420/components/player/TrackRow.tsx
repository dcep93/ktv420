import { type Track } from "./types";

type TrackRowProps = {
  track: Track;
  durationLabel: string;
  volume: number;
  isMuted: boolean;
  isDeafened: boolean;
  onVolumeChange: (trackId: string, value: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleDeafen: (trackId: string) => void;
  registerCanvas: (canvas: HTMLCanvasElement | null) => void;
  registerAudio: (audio: HTMLAudioElement | null) => void;
};

export function TrackRow({
  track,
  durationLabel,
  volume,
  isMuted,
  isDeafened,
  onVolumeChange,
  onToggleMute,
  onToggleDeafen,
  registerCanvas,
  registerAudio,
}: TrackRowProps) {
  const label = track.isInput ? `Input: ${track.name}` : `Output: ${track.name}`;

  return (
    <div key={track.id} style={{ marginBottom: "0.75rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          marginBottom: "0.4rem",
        }}
      >
        <div style={{ minWidth: "220px" }}>
          {label} <span style={{ color: "#aaa" }}>({durationLabel})</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => onVolumeChange(track.id, Number(event.target.value))}
          style={{ flex: 1, minWidth: "160px", maxWidth: "360px" }}
        />
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button type="button" onClick={() => onToggleMute(track.id)}>
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button type="button" onClick={() => onToggleDeafen(track.id)}>
            {isDeafened ? "Undeafen" : "Deafen"}
          </button>
        </div>
      </div>
      <div style={{ marginTop: "0.4rem" }}>
        <canvas
          ref={registerCanvas}
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
      <audio ref={registerAudio} src={track.url} preload="auto" />
    </div>
  );
}
