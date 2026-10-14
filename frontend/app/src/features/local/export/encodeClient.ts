export function encodeInWorker(file: File, frames: number, gain: number, signal: AbortSignal, progress: (fraction:number)=>void): Promise<Blob> {
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./encodeWorker.ts',import.meta.url),{type:'module'});
    const abort=()=>finish(signal.reason);
    const finish=(error?:unknown,blob?:Blob)=>{signal.removeEventListener('abort',abort);worker.terminate();if(error) reject(error);else resolve(blob!);};
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{
      if(data.type==='progress') progress(data.fraction);
      else if(data.type==='result') finish(undefined,data.blob);
      else finish(new Error(data.message || 'MP3 export failed.'));
    };
    worker.onerror=event=>finish(new Error(event.message || 'MP3 encoder stopped.'));
    try {worker.postMessage({file,frames,gain});}catch(reason){finish(reason);}
  });
}
