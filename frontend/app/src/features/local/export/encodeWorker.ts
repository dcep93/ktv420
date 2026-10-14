import { encodePerformance } from './encode';
self.onmessage=async ({data}:MessageEvent<{file:File;frames:number;gain:number}>)=>{
  try {
    const blob=await encodePerformance(data.file,data.frames,data.gain,fraction=>self.postMessage({type:'progress',fraction}));
    self.postMessage({type:'result',blob});
  } catch(reason) {self.postMessage({type:'error',message:reason instanceof Error ? reason.message : String(reason)});}
};
