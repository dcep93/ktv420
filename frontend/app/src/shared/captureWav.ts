import type { QueuedCapture } from './captureFormat';
export function wavHeader(capture: QueuedCapture) {
  const header = new ArrayBuffer(58),
    view = new DataView(header),
    channels = Number(capture.metadata.audioChannelCount),
    rate = Number(capture.metadata.audioSampleRate),
    size = capture.expectedBytes;
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 50 + size, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 18, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 4, true);
  view.setUint16(32, channels * 4, true);
  view.setUint16(34, 32, true);
  text(38, 'fact');
  view.setUint32(42, 4, true);
  view.setUint32(46, size / (channels * 4), true);
  text(50, 'data');
  view.setUint32(54, size, true);
  return header;
}
