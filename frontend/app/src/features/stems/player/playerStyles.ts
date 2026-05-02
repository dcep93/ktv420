import { type CSSProperties } from "react";

export const getVisualizerButtonStyle = (
  isActive: boolean
): CSSProperties => ({
  borderRadius: "14px",
  border: isActive
    ? "1px solid var(--ww-title-pink)"
    : "1px solid var(--ww-border)",
  background: isActive
    ? "linear-gradient(135deg, rgba(255,123,195,0.34), rgba(201,156,107,0.26))"
    : "var(--ww-panel-soft)",
  color: isActive ? "var(--ww-text-strong)" : "var(--ww-text)",
  padding: "0.65rem 0.85rem",
  minWidth: "200px",
  textAlign: "left",
  fontWeight: 600,
  boxShadow: isActive
    ? "0 0 0 2px rgba(255,123,195,0.16), 0 8px 20px rgba(0,0,0,0.34)"
    : "0 10px 28px rgba(0,0,0,0.35)",
  cursor: "pointer",
  transition: "all 160ms ease",
});
