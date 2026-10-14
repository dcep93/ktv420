// Development-only browser fixture; not a production build entry point.
import { beginCapture, appendCapture, finishCapture } from './extension/capture';
import { deleteTrack } from './features/local/library';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const frame = document.querySelector('iframe')!;
const status = document.getElementById('status')!;
const tracks = [
  { trackId: 'overlayTestOne', trackName: 'Synthetic capture one', trackArtist: 'Browser validation', rowIndex: 0 },
  { trackId: 'overlayTestTwo', trackName: 'Synthetic capture two', trackArtist: 'Browser validation', rowIndex: 1 },
];
let active = false;
const post = () => frame.contentWindow!.postMessage({ source: 'ktv420-parent', version: 2, type: 'state', tracks, active, starting: false, supported: true }, location.origin);
window.addEventListener('message', async event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.source !== 'ktv420-overlay') return;
  if (event.data.type === 'ready') post();
  if (event.data.type === 'close') frame.style.display = 'none';
  if (event.data.type !== 'toggle-capture') return;
  if (active) { active = false; post(); return; }
  active = true; post();
  try {
    for (const track of tracks) {
      if (!active) break;
      const samples = new Float32Array(44100 * 2);
      for (let i = 0; i < 44100; i++) {
        samples[i * 2] = 0.1 * Math.sin(i * 2 * Math.PI * 220 / 44100);
        samples[i * 2 + 1] = 0.1 * Math.sin(i * 2 * Math.PI * 330 / 44100);
      }
      const bytes = new Uint8Array(samples.buffer);
      const id = await beginCapture(999, { ...track, audioSampleRate: 44100, audioChannelCount: 2,
        audioSampleFormat: 'PCM_F32LE', audioByteLength: bytes.length }, bytes.length);
      for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++) {
        const chunk = bytes.subarray(offset, offset + 65536);
        await appendCapture(999, id, index, btoa(Array.from(chunk, byte => String.fromCharCode(byte)).join('')));
      }
      await finishCapture(999, id); status.textContent = `Captured ${track.trackName}`;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (error) { status.textContent = String(error); }
  finally { active = false; post(); }
});
document.getElementById('reset')!.onclick = async () => {
  for (const track of tracks) await deleteTrack(`spotify-${track.trackId}`);
  status.textContent = 'Test captures cleared'; post();
};
document.getElementById('show')!.onclick = () => { frame.style.display = 'block'; post(); };
