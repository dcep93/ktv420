import { fft, getHannWindow } from '../../../local/inference/fft';
import { AMPLITUDE_WINDOW_SECONDS } from '../types';
import { PitchEstimator, pitchWindowSize } from './pitchAnalysis';
import { spectralHue } from './timeRibbon';

export const PITCH_STEP = AMPLITUDE_WINDOW_SECONDS;
export const PITCH_CHUNK_SECONDS = 10;
// Three neighboring samples for uncertainty repair, one for median smoothing,
// plus half the longest analysis window (including low sample rates).
export const PITCH_MARGIN_SECONDS = .4;
export type PitchSamples = { pitches: Float32Array; levels: Float32Array; hues: Float32Array };
export type PitchTimeline = PitchSamples & { revision: number; ready: Uint8Array; failed: boolean };
export type PitchChunkInput = { channels: Float32Array[]; sampleRate: number; startFrame: number; first: number; count: number };

/** Approximate register for noise/chords when no fundamental is clear. */
export function pitchCenter(spectrum: Float32Array, sampleRate: number): number | null {
  let weight=0,total=0;
  const resolution=sampleRate/(spectrum.length*2);
  for(let bin=Math.max(1,Math.ceil(55/resolution));bin<spectrum.length;bin++) {
    const frequency=bin*resolution;if(frequency>3520)break;
    const db=spectrum[bin];if(!Number.isFinite(db)||db< -90)continue;
    const power=10**(db/10);weight+=power;total+=Math.log2(frequency)*power;
  }
  return weight>1e-9?2**(total/weight):null;
}

/** Centered source windows: no causal smoothing or live analyser delay. */
export function analyzePitchChunk({channels,sampleRate,startFrame,first,count}:PitchChunkInput):PitchSamples {
  const windowSize=pitchWindowSize(sampleRate),window=new Float32Array(windowSize);
  const fftSize=2048,frame=new Float32Array(fftSize),real=new Float32Array(fftSize),imag=new Float32Array(fftSize);
  const spectrum=new Float32Array(fftSize/2),colors=new Uint8Array(fftSize/2),hann=getHannWindow(fftSize);
  const padding=4,size=count+padding*2;
  const estimator=new PitchEstimator(),rawPitch=new Float32Array(size).fill(NaN),fundamentals=new Float32Array(size).fill(NaN);
  const rawLevel=new Float32Array(size),rawHue=new Float32Array(size);
  const halfLevel=Math.round(sampleRate*.01);
  for(let k=0;k<size;k++) {
    const index=first+k-padding,center=Math.round(index*PITCH_STEP*sampleRate)-startFrame;
    let selected=channels[0],level=0;
    // Do not cancel a wide/anti-phase stereo signal by averaging its channels.
    for(const channel of channels) {
      let energy=0;
      for(let j=center-halfLevel;j<center+halfLevel;j++)energy+=(channel[j]??0)**2;
      const rms=Math.sqrt(energy/(halfLevel*2));
      if(rms>level){level=rms;selected=channel;}
    }
    rawLevel[k]=level;
    if(index<0||level<=.0015)continue;
    for(let j=0;j<windowSize;j++)window[j]=selected[center+j-windowSize/2]??0;
    for(let j=0;j<fftSize;j++)frame[j]=(selected[center+j-fftSize/2]??0)*hann[j];
    fft(real,imag,frame,fftSize);
    for(let j=0;j<spectrum.length;j++) {
      const power=(real[j]**2+imag[j]**2)/(fftSize*fftSize);
      const db=10*Math.log10(Math.max(1e-20,power));spectrum[j]=db;
      colors[j]=Math.round(Math.max(0,Math.min(255,(db+100)/70*255)));
    }
    const fundamental=estimator.estimate(window,sampleRate);
    if(fundamental!==null)fundamentals[k]=Math.log2(fundamental);
    const hz=fundamental??pitchCenter(spectrum,sampleRate);
    if(hz!==null)rawPitch[k]=Math.log2(hz);
    rawHue[k]=spectralHue(colors,sampleRate)??325;
  }
  // At attacks/releases a long pitch window contains silence. Use nearby tonal
  // evidence instead of briefly turning that uncertainty into a high noise pitch.
  // This is symmetric and never changes the short, centered silence gate.
  for(let k=0;k<size;k++) {
    if(rawLevel[k]<=.0015||Number.isFinite(fundamentals[k]))continue;
    for(let distance=1;distance<=3;distance++) {
      const before=fundamentals[k-distance],after=fundamentals[k+distance];
      if(Number.isFinite(before)||Number.isFinite(after)) {
        rawPitch[k]=Number.isFinite(after)?after:before;break;
      }
    }
  }
  const pitches=new Float32Array(count),levels=rawLevel.slice(padding,count+padding),hues=new Float32Array(count);
  for(let k=0;k<count;k++) {
    const center=k+padding,a=rawPitch[center-1],b=rawPitch[center],c=rawPitch[center+1];
    // A symmetric median removes isolated octave spikes without delaying a leap.
    pitches[k]=Number.isFinite(a)&&Number.isFinite(b)&&Number.isFinite(c)
      ? a+b+c-Math.min(a,b,c)-Math.max(a,b,c):b;
    hues[k]=rawLevel[center-1]>.0015&&rawLevel[center+1]>.0015
      ? (rawHue[center-1]+2*rawHue[center]+rawHue[center+1])/4:rawHue[center];
  }
  return {pitches,levels,hues};
}
