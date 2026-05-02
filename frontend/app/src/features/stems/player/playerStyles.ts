import { type CSSProperties } from "react";

export const getVisualizerButtonStyle = (
  isActive: boolean
): CSSProperties => ({
  borderRadius: "14px",
  border: isActive
    ? "1px solid var(--ww-border-strong)"
    : "1px solid var(--ww-border)",
  background: isActive
    ? "linear-gradient(135deg, rgba(232,206,171,0.16), rgba(201,156,107,0.18))"
    : "var(--ww-panel-soft)",
  color: "var(--ww-text)",
  padding: "0.65rem 0.85rem",
  minWidth: "200px",
  textAlign: "left",
  boxShadow: isActive
    ? "0 0 0 1px rgba(228,193,150,0.22), 0 16px 40px rgba(0,0,0,0.45)"
    : "0 10px 28px rgba(0,0,0,0.35)",
  cursor: "pointer",
  transition: "all 160ms ease",
});
