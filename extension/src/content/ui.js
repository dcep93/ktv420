import { isSupportedRoute } from './dom.js';
import { sendLocalMessage } from './storage.js';

export function mountButton({ isRunActive, onToggleRun, loadSpotifyTracks }) {
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'ktv420 capture');
  Object.assign(panel.style, { position: 'fixed', bottom: '100px', right: '20px', zIndex: '99999',
    background: '#211b1a', color: '#fff2ec', border: '1px solid #f991b3', borderRadius: '14px', padding: '14px',
    fontFamily: 'system-ui', maxWidth: '300px', boxShadow: '0 6px 24px #0008' });
  const title = document.createElement('strong'); title.textContent = 'ktv420 · local audio';
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.style.fontSize = '12px';
  status.textContent = 'Capture this playlist or album in real time. Audio stays on this computer.';
  const capture = document.createElement('button'); const library = document.createElement('button');
  for (const button of [capture, library]) Object.assign(button.style, { background: '#f991b3', color: '#211b1a',
    border: 'none', borderRadius: '6px', padding: '8px 12px', marginRight: '6px', cursor: 'pointer', fontWeight: '600' });
  library.textContent = 'Open library';
  library.onclick = () => { sendLocalMessage({ type: 'ktv420:open' }).catch(showError); };
  function showError(error) { status.textContent = error?.message || String(error); }
  function refresh() { capture.textContent = isRunActive() ? 'Stop capture' : 'Capture tracks'; panel.hidden = !isSupportedRoute() && !isRunActive(); }
  capture.onclick = async () => {
    capture.disabled = true;
    try {
      const tracks = isRunActive() ? [] : await loadSpotifyTracks();
      status.textContent = isRunActive() ? 'Stopping…' : 'Capturing locally. Keep Spotify open; do not seek or change tracks.';
      capture.disabled = false;
      await onToggleRun({ trackSnapshot: tracks });
    } catch (error) { showError(error); }
    finally { capture.disabled = false; refresh(); }
  };
  panel.append(title, status, capture, library);
  const mount = () => { if (document.body) document.body.append(panel); else requestAnimationFrame(mount); };
  mount(); refresh();
  const timer = setInterval(refresh, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  return { refresh,
    async notifyTrackCaptured(_id, metadata) { status.textContent = `Saved ${metadata?.trackName || 'track'} locally. Open the library to separate it.`; },
    async notifyCaptureComplete(trackIds) { status.textContent = `${trackIds?.length || 0} tracks captured. Open the library to separate and listen.`; refresh(); },
  };
}
