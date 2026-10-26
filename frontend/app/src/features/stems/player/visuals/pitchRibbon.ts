import type { VisualizerInputs } from '../visualizers';
import { PAST_WINDOW_SECONDS } from '../types';
import { beginVisualizer } from './canvas';
import { PITCH_STEP } from './pitchTimeline';
import type { PitchTimeline } from './pitchTimeline';
import { ribbonRange, ribbonX, RIBBON_WINDOW } from './ribbonTimeline';
export { pitchCenter } from './pitchTimeline';
export type PitchRange = { low: number; high: number };
const ranges=new WeakMap<PitchTimeline,{revision:number;anchors:Map<number,PitchRange>}>();

export function pitchHeight(hz:number,range:PitchRange={low:Math.log2(55),high:Math.log2(3520)}) {
  return Math.max(0,Math.min(1,(Math.log2(hz)-range.low)/(range.high-range.low)));
}
export function pitchOpacity(rms:number) {
  if(!Number.isFinite(rms)||rms<=.0015)return 0;
  const gate=Math.min(1,(rms-.0015)/.0045);
  return .8*gate*gate*(3-2*gate)+.2*Math.max(0,Math.min(1,Math.log2(rms/.006)/5));
}

/** Source-anchored ranges interpolate slowly and identically after every seek. */
export function pitchRange(timeline:PitchTimeline,time:number):PitchRange {
  let cached=ranges.get(timeline);
  if(!cached||cached.revision!==timeline.revision){cached={revision:timeline.revision,anchors:new Map()};ranges.set(timeline,cached);}
  const anchor=(second:number)=>{
    const saved=cached.anchors.get(second);if(saved)return saved;
    const points:number[]=[];
    const first=Math.max(0,Math.floor((second-5)/PITCH_STEP));
    const last=Math.min(timeline.pitches.length-1,Math.ceil((second+15)/PITCH_STEP));
    for(let i=first;i<=last;i++)if(timeline.ready[i]&&timeline.levels[i]>=.004&&Number.isFinite(timeline.pitches[i]))points.push(timeline.pitches[i]);
    points.sort((a,b)=>a-b);
    let result={low:Math.log2(110),high:Math.log2(440)};
    if(points.length) {
      const low=points[Math.floor((points.length-1)*.05)],high=points[Math.ceil((points.length-1)*.95)];
      const span=Math.max(2,high-low+.7),center=(low+high)/2;
      result={low:center-span/2,high:center+span/2};
    }
    cached.anchors.set(second,result);return result;
  };
  const start=Math.floor(time/5)*5,a=anchor(start),b=anchor(start+5),t=(time-start)/5,blend=t*t*(3-2*t);
  return {low:a.low+(b.low-a.low)*blend,high:a.high+(b.high-a.high)*blend};
}

export function drawPitchRibbon({canvas,currentTime,pitchTimeline:timeline,pitchSemitones=0}:VisualizerInputs) {
  const view=beginVisualizer(canvas);if(!view)return;
  const {context:c,width:w,height:h,background,text,font}=view;
  try {
    c.fillStyle=background;c.fillRect(0,0,w,h);
    const margin=Math.min(16,h/8),plotHeight=h-margin*2,shift=pitchSemitones/12;
    const sourceRange=timeline?pitchRange(timeline,currentTime):{low:Math.log2(110),high:Math.log2(440)};
    // Keep the source reference while allowing the transposed contour to fit.
    const range={low:sourceRange.low+Math.min(0,shift),high:sourceRange.high+Math.max(0,shift)};
    const y=(pitch:number)=>margin+(range.high-pitch)/(range.high-range.low)*plotHeight;
    c.lineWidth=1;c.strokeStyle='rgba(255,255,255,.045)';c.beginPath();
    for(let octave=Math.ceil(range.low);octave<range.high;octave++){c.moveTo(0,y(octave));c.lineTo(w,y(octave));}
    c.stroke();
    const visible=ribbonRange(currentTime);
    const first=Math.max(0,visible.first),last=Math.min((timeline?.pitches.length??0)-1,visible.last);
    let available=false;
    if(timeline&&last>=first) {
      const gradient=c.createLinearGradient(0,0,w,0);
      for(let i=first;i<=last;i++) {
        const opacity=timeline.ready[i]&&Number.isFinite(timeline.pitches[i])?pitchOpacity(timeline.levels[i]):0;
        gradient.addColorStop(Math.max(0,Math.min(1,ribbonX(i,currentTime,w)/w)),`hsla(${timeline.hues[i]},75%,65%,${opacity})`);
        available ||= !!timeline.ready[i];
      }
      c.beginPath();c.rect(0,0,w,h);c.clip();
      c.strokeStyle=gradient;c.lineWidth=2;c.lineCap='round';c.lineJoin='round';c.beginPath();
      let connected=false;
      for(let i=first;i<=last;i++) {
        if(!timeline.ready[i]||!Number.isFinite(timeline.pitches[i])||!pitchOpacity(timeline.levels[i])){connected=false;continue;}
        const x=ribbonX(i,currentTime,w),height=y(timeline.pitches[i]+shift);
        if(connected)c.lineTo(x,height);else c.moveTo(x,height);
        connected=true;
      }
      c.stroke();
    }
    if(!available) {
      c.fillStyle=text;c.font=font;c.fillText(timeline?.failed?'Pitch preview unavailable':'Preparing pitch preview…',10,h-16);
    }
    const now=PAST_WINDOW_SECONDS/RIBBON_WINDOW*w;
    c.strokeStyle='rgba(255,255,255,.65)';c.lineWidth=1.5;c.beginPath();c.moveTo(now,0);c.lineTo(now,h);c.stroke();
  } finally {c.restore();}
}
