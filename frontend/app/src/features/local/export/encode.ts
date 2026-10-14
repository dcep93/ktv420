import mp3 from '@audio/encode-mp3';
import { EXPORT_RATE } from './timeline';
/** One encoder across every song preserves gapless timing at section boundaries. */
export async function encodePerformance(file: Blob, frames: number, gain: number, progress: (fraction:number)=>void) {
  if(file.size!==frames*8 || frames<1 || !Number.isSafeInteger(frames) || !Number.isFinite(gain) || gain<=0 || gain>1) throw new Error('Incomplete rendered audio.');
  const encoder=await mp3({sampleRate:EXPORT_RATE,channels:2,bitrate:320,frames});
  try {
    const parts: Uint8Array<ArrayBuffer>[]=[];
    for(let start=0;start<frames;start+=65536) {
      const end=Math.min(frames,start+65536);
      const interleaved=new Float32Array(await file.slice(start*8,end*8).arrayBuffer());
      const left=new Float32Array(end-start),right=new Float32Array(end-start);
      for(let i=0;i<left.length;i++) {
        left[i]=interleaved[i*2]*gain;right[i]=interleaved[i*2+1]*gain;
        if(!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new Error('Export contains invalid audio.');
      }
      parts.push(new Uint8Array(encoder.encode([left,right])));progress(end/frames);
    }
    parts.push(new Uint8Array(encoder.flush()));
    const blob=new Blob(parts,{type:'audio/mpeg'}),head=encoder.head?.();
    if(!head || head.length>blob.size) throw new Error('Could not finalize the MP3 file.');
    return new Blob([new Uint8Array(head),blob.slice(head.length)],{type:'audio/mpeg'});
  } finally {encoder.free();}
}
