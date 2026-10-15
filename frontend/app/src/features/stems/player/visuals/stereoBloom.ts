import { waveform, stereoPoint, type StereoTap } from './analysis';
import { beginVisualizer } from './canvas';
export function drawStereoBloom(canvas: HTMLCanvasElement, tap: StereoTap) {
  const view = beginVisualizer(canvas); if (!view) return;
  const {context, width, height, background} = view;
  try {
    context.fillStyle = background; context.fillRect(0, 0, width, height);
    const left = waveform(tap.left), right = waveform(tap.right);
    const cx = width / 2, cy = height / 2, scaleX = width * .43, scaleY = height * .43;
    context.strokeStyle = 'rgba(201,156,102,.22)'; context.lineWidth = 1;
    context.beginPath(); context.moveTo(cx, 8); context.lineTo(cx, height - 8); context.stroke();
    // Fixed soft compression retains level differences without flickering auto gain.
    for (const mirror of [-1, 1]) {
      context.beginPath();
      for (let i = 0; i < left.length; i += 2) {
        const {side, mid} = stereoPoint(left[i], right[i]);
        const x = cx + Math.tanh(side * 3) * scaleX * mirror, y = cy - Math.tanh(mid * 3) * scaleY;
        if (!i) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.strokeStyle = mirror === 1 ? 'rgba(255,123,195,.7)' : 'rgba(127,209,204,.45)';
      context.lineWidth = 1.2; context.stroke();
    }
  } finally { context.restore(); }
}
