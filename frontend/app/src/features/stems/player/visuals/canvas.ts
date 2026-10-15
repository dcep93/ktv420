const MAX_PIXELS = 1_500_000;
export function canvasResolution(width: number, height: number, deviceRatio: number) {
  const ratio = Math.min(2, Math.max(1, deviceRatio || 1), Math.sqrt(MAX_PIXELS / Math.max(1, width * height)));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
type Surface = { width: number; height: number; background: string; text: string; font: string };
const surfaces = new WeakMap<HTMLCanvasElement, Surface>();
export function resizeVisualizer(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const size = canvasResolution(width, height, window.devicePixelRatio);
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
  const style = getComputedStyle(canvas);
  surfaces.set(canvas, { width, height, background: style.getPropertyValue('--ww-bg-bottom').trim() || '#120d0b',
    text: style.getPropertyValue('--ww-text-soft').trim() || '#c9beb6', font: `12px ${style.fontFamily}` });
}
export function surfaceFor(canvas: HTMLCanvasElement): Surface {
  return surfaces.get(canvas) ?? { width: canvas.width, height: canvas.height, background: '#120d0b', text: '#c9beb6', font: '12px "Comic Relief", "Comic Sans MS", sans-serif' };
}
export function beginVisualizer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const surface = surfaceFor(canvas);
  context.save();
  context.setTransform(canvas.width / surface.width, 0, 0, canvas.height / surface.height, 0, 0);
  context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.shadowBlur = 0;
  context.font = surface.font;
  return { context, ...surface };
}
export function canvasVisible(canvas: HTMLCanvasElement) {
  if (!canvas.checkVisibility()) return false;
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}
