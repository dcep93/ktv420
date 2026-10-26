import { type CSSProperties } from "react";

export const getVisualizerButtonStyle = (
  isActive: boolean
): CSSProperties => ({
  borderRadius: "0.5rem",
  border: isActive
    ? "0.0625rem solid var(--ww-accent-amber)"
    : "0.0625rem solid var(--ww-border)",
  background: isActive
    ? "var(--ww-audio-bg)"
    : "var(--ww-panel-soft)",
  color: isActive ? "var(--ww-text-strong)" : "var(--ww-text)",
  padding: "0.4em 0.7em",
  whiteSpace: "normal",
  width: "100%",
  minWidth: 0,
  minHeight: "2.6rem",
  height: "100%",
  boxSizing: "border-box",
  fontSize: "0.85rem",
  textAlign: "left",
  fontWeight: 600,
  boxShadow: isActive
    ? "inset 0 0 0 0.0625rem var(--ww-audio-border)"
    : "none",
  cursor: "pointer",
  transition: "all 160ms ease",
});
