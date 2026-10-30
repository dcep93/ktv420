// Development-only preview. All data and deletion actions below are synthetic.
import { createRoot } from 'react-dom/client';
import './src/styles/theme.css';
import './src/index.css';
import ExtensionAudioSettings from './src/pages/ExtensionAudioSettings';
let rows = [
  { id: crypto.randomUUID(), title: 'Original recording', bytes: 95.3 * 1024 ** 2, ready: false, busy: false },
  { id: crypto.randomUUID(), title: 'Prepared recording', bytes: 43.4 * 1024 ** 2, ready: true, busy: false },
];
Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
  sendMessage(_id: string, request: { operation: string; ids?: string[] }, respond: (response: unknown) => void) {
    if (request.operation === 'hello') respond({ ok: true, result: { stagedAudioControls: true } });
    else if (request.operation === 'staging-list') respond({ ok: true, result: rows });
    else if (request.operation === 'staging-delete') { rows = rows.filter(r => !request.ids?.includes(r.id)); respond({ ok: true }); }
  },
} } });
createRoot(document.getElementById('root')!).render(<main className="iframe-page iframe-page--overlay"><div className="iframe-content"><section className="iframe-settings-view"><ExtensionAudioSettings capturing={false}/></section></div></main>);
