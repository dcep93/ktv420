import { getVisualizerButtonStyle } from './playerStyles';
import type { VisualizerType } from './types';
import { visualizerGroups } from './visualizerOptions';

export function VisualizerPicker({ value, onChange, hidden = false }: {
  value: VisualizerType; onChange: (value: VisualizerType) => void; hidden?: boolean;
}) {
  return <section className="player-visualizer-picker" aria-label="Visualizer" hidden={hidden}>
    {visualizerGroups.map(group => <div className="player-visualizer-group" role="group" aria-label={group.label} key={group.label}>
      <h3>{group.label}</h3>
      <div className="player-visualizer-grid">
        {group.options.map(option => <button key={option.value} type="button"
          onClick={() => onChange(option.value)} style={getVisualizerButtonStyle(value === option.value)}
          aria-pressed={value === option.value} aria-label={`${option.label} ${option.hint}`} title={option.hint}>
          {option.label}
        </button>)}
      </div>
    </div>)}
  </section>;
}
