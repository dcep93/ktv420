import type { ExportProgress } from '../features/local/export/exportReplay';
export default function ReplayExportButton({progress,disabled,onExport,onCancel}:{progress:ExportProgress|null;disabled:boolean;onExport:()=>void;onCancel:()=>void}) {
  if(!progress) return <button disabled={disabled} onClick={onExport}>Export MP3</button>;
  const seconds=progress.secondsRemaining;
  const eta=seconds===undefined ? '' : seconds<60 ? ` · About ${Math.max(5,Math.ceil(seconds/5)*5)}s left` : ` · About ${Math.ceil(seconds/60)} min left`;
  return <div className="replay-export" role="status">
    <span>{progress.phase==='encoding' ? 'Saving MP3' : 'Exporting'} {Math.min(99,Math.floor(progress.fraction*100))}%{eta}</span>
    <progress aria-label="MP3 export progress" max={1} value={progress.fraction}/>
    <button onClick={onCancel}>Cancel</button>
  </div>;
}
