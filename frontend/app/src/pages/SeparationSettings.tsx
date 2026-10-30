import { useEffect, useState } from 'react';
import { clearModelCache, getModelCacheStatus, loadModelBytes } from '../features/local/inference/model';

type Props = {
  enabled: boolean; backend: 'auto' | 'wasm'; busy: boolean; failed: boolean;
  configure: (enabled: boolean, retry?: boolean, backend?: 'auto' | 'wasm') => Promise<void>;
  onError: (message: string) => void;
};
export default function SeparationSettings({ enabled, backend, busy, failed, configure, onError }: Props) {
  const [cached, setCached] = useState<boolean | null>(null);
  const [modelAction, setModelAction] = useState(false), [download, setDownload] = useState(0);
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => { void getModelCacheStatus().then(value => { if (!disposed) setCached(value); }); };
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  const change = async (next: boolean, retry = false, device = backend) => {
    setChanging(true); onError('');
    try { await configure(next, retry, device); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setChanging(false); }
  };
  const model = async () => {
    if (modelAction || cached === null) return;
    setModelAction(true); setDownload(0); onError('');
    try { if (cached) await clearModelCache(); else await loadModelBytes(setDownload, { requireCache: true }); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setCached(await getModelCacheStatus()); setModelAction(false); }
  };
  return <section className="iframe-settings-source" aria-label="Separation">
    <header className="iframe-settings-source-header"><h2>Separation</h2></header>
    <p className="iframe-settings-help">Runs in the background. Pausing keeps your recordings.</p>
    <div className="iframe-setting-row">
      <span>Automatic separation</span>
      <button disabled={changing} onClick={() => void change(!enabled, !enabled)}>{enabled ? 'Pause separation' : 'Resume separation'}</button>
    </div>
    {failed && <button disabled={changing} onClick={() => void change(true, true)}>Retry separation</button>}
    <div className="iframe-setting-row">
      <label htmlFor="overlay-separation-device">Processing device</label>
      <select id="overlay-separation-device" value={backend} disabled={busy || changing} onChange={event => void change(enabled, false, event.target.value as 'auto' | 'wasm')}>
        <option value="auto">GPU preferred</option><option value="wasm">CPU compatibility</option>
      </select>
    </div>
    <div className="iframe-setting-row">
      <span>Model · 181 MB</span>
      <button disabled={busy || modelAction || cached === null} onClick={() => void model()}>{modelAction ? cached ? 'Removing…' : `Downloading ${Math.floor(download * 100)}%` : cached === null ? 'Checking…' : cached ? 'Remove downloaded model' : 'Download model'}</button>
    </div>
  </section>;
}
