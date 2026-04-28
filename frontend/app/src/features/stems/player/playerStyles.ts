import { type CSSProperties } from "react";

export const getVisualizerButtonStyle = (
  isActive: boolean
): CSSProperties => ({
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
});
