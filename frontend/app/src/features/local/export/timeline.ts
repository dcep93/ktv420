import { parseRecording, type PerformanceEvent, type PerformanceRecording } from '../recording';
import { audioEffectOptions } from '../../stems/player/audioEffects';
export const EXPORT_RATE = 44100;
export type ExportSection = { trackId: string; start: number; frames: number; events: PerformanceEvent[] };
export function compileExport(recording: PerformanceRecording): { sections: ExportSection[]; frames: number } {
  const value = parseRecording(recording);
  const frames = Math.round(value.events.at(-1)!.at * EXPORT_RATE);
  if (!frames) throw new Error('This recording has no audio timeline to export.');
  const sections: ExportSection[] = [];
  for (const event of value.events) {
    if (event.snapshot?.stems.some(stem => !audioEffectOptions.some(effect => effect.value === stem.effect))) throw new Error('This recording uses an unsupported audio effect.');
    if (event.type === 'track') sections.push({ trackId:event.trackId, start:event.at, frames:0, events:[] });
    sections.at(-1)!.events.push(event);
  }
  sections.forEach((section,i) => {
    const end = sections[i+1]?.start ?? value.events.at(-1)!.at;
    section.frames = Math.round(end*EXPORT_RATE)-Math.round(section.start*EXPORT_RATE);
  });
  return { sections:sections.filter(section=>section.frames>0), frames };
}
/** Offline suspension is quantized to render quanta. Coalesce collisions, retaining event order. */
export function eventQuanta(section: ExportSection) {
  const groups = new Map<number, PerformanceEvent[]>();
  for (const event of section.events) {
    if(event.type==='stop') continue; // The exact context length supplies Stop, without quantum rounding.
    const frame = Math.floor(Math.max(0,event.at-section.start)*EXPORT_RATE/128)*128;
    if (frame >= section.frames) continue;
    const group = groups.get(frame) ?? []; group.push(event); groups.set(frame,group);
  }
  // Also yield each second for progress/cancel, including long unchanging passages.
  for(let frame=EXPORT_RATE;frame<section.frames;frame+=EXPORT_RATE) {
    const quantum=Math.floor(frame/128)*128;
    if (!groups.has(quantum)) groups.set(quantum,[]);
  }
  return [...groups].sort(([a],[b])=>a-b);
}
export function exportGain(peak: number) {
  if (!Number.isFinite(peak) || peak<0) throw new Error('Export contains invalid audio.');
  return peak>1 ? .95/peak : 1;
}
export function checkExportMemory(inputSeconds: number, stems: number, outputFrames: number) {
  const bytes=inputSeconds*EXPORT_RATE*stems*2*4*2 + outputFrames*2*4;
  if (!Number.isFinite(bytes) || bytes>1536*1024**2) throw new Error('This song section is too large to export safely. Export a shorter recording.');
}
