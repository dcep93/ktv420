export const effectIds = ['wah','bass-boost','bright','warm','telephone','lofi','submerge','delay-pedal','chorus','reverb','envelope-filter','flange','phaser','tilt-eq','band-emphasis','saturation','formant-filter','dj-filter','tone'] as const;
export type AudioEffectType = typeof effectIds[number];
export type EffectSettings = { bypass: boolean; bpm: number; beats: number };
export const defaultEffectSettings: EffectSettings = {bypass:false,bpm:120,beats:.5};
export const beatOptions = [.25,.5,1,2] as const;
export const isAudioEffect = (value: string): value is AudioEffectType => (effectIds as readonly string[]).includes(value);
export function validEffectSettings(value: unknown): value is EffectSettings {
  if (!value || typeof value!=='object') return false;
  const v=value as EffectSettings;
  return typeof v.bypass==='boolean' && Number.isFinite(v.bpm) && v.bpm>=40 && v.bpm<=240 && (beatOptions as readonly number[]).includes(v.beats);
}
export type AudioEffectOption = { value: AudioEffectType; label: string; description: string };
export const audioEffectOptions: AudioEffectOption[] = [
  {value:'wah',label:'Wah',description:'A vocal pedal sweep: low at the left, bright at the right.'},
  {value:'dj-filter',label:'DJ Filter',description:'Left removes highs; right removes lows.'},
  {value:'envelope-filter',label:'Envelope Filter',description:'A resonant filter that opens with the stem’s loudness.'},
  {value:'formant-filter',label:'Vowels',description:'Move through A, E, I, O and U using three vocal resonances.'},
  {value:'tone',label:'Tone',description:'Balance warmth and brightness.'},
  {value:'telephone',label:'Telephone',description:'Blend in a narrow telephone sound.'},
  {value:'saturation',label:'Saturation',description:'Soft harmonic drive with level compensation.'},
  {value:'chorus',label:'Chorus',description:'Stereo doubles from a gentle shimmer to a deep chorus. Amount controls depth and blend.'},
  {value:'flange',label:'Flanger',description:'A slow comb-filter sweep with controlled feedback.'},
  {value:'phaser',label:'Phaser',description:'Six moving phase stages for a liquid sweep.'},
  {value:'delay-pedal',label:'Echo',description:'Darkening repeats. Set the song BPM and beat interval separately from amount.'},
  {value:'reverb',label:'Reverb',description:'A diffused stereo room, growing into a longer wash. Adjustments preserve the tail.'},
];
const legacyLabels: Partial<Record<AudioEffectType,string>> = {'bass-boost':'Bass','bright':'Treble','warm':'Warm','lofi':'Lo-Fi','submerge':'Submerge','tilt-eq':'Tilt EQ','band-emphasis':'Band Emphasis'};
export function getEffectOption(value: AudioEffectType): AudioEffectOption {
  return audioEffectOptions.find(option=>option.value===value) ?? {value,label:legacyLabels[value] ?? value,description:'Saved effect from an earlier recording, using the improved processor.'};
}
const bipolar = new Set<AudioEffectType>(['wah','bass-boost','bright','lofi','tilt-eq','band-emphasis','dj-filter','tone']);
export const getDefaultEffectValue = (effect: AudioEffectType) => bipolar.has(effect) ? .5 : 0;
export function effectAmountLabel(effect: AudioEffectType,value:number) {
  if (Math.abs(value-getDefaultEffectValue(effect))<.001) return 'Clean';
  if (effect==='formant-filter') return ['A','E','I','O','U'][Math.min(4,Math.max(0,Math.round((value-.2)*5)))];
  if(effect==='dj-filter') return value<.5?'Low-pass':'High-pass';
  if(effect==='tone' || effect==='tilt-eq') return value<.5?'Warmer':'Brighter';
  return `${Math.round((bipolar.has(effect)?Math.abs(value-.5)*2:value)*100)}%`;
}
