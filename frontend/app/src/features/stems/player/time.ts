export const formatPlaybackTime = (time: number) => {
  const safeTime = Math.max(0, Math.floor(time));
  const minutes = Math.floor(safeTime / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safeTime % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
};
