import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles/theme.css';
import './src/index.css';
import { VisualizerPicker } from './src/features/stems/player/VisualizerPicker';
import type { VisualizerType } from './src/features/stems/player/types';

export function Preview() {
  const [value, setValue] = useState<VisualizerType>('beach');
  const [compact, setCompact] = useState(false);
  return <main style={{ maxWidth: compact ? 620 : 1100, padding: 24, margin: '24px auto' }}>
    <h1 style={{ color: 'var(--ww-title-pink)', margin: 0 }}>Visualizers</h1>
    <button onClick={() => setCompact(!compact)}>{compact ? 'Wide preview' : 'Compact preview'}</button>
    <VisualizerPicker value={value} onChange={setValue} />
    <p role="status">Selected: {value}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
