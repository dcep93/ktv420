import { beginImport, exportCollection, exportTrack, importTrack } from './transferStorage';
import type { BrokerLocks } from './libraryBroker';

type Peer = Pick<Window,'postMessage'>;
export function createTransferBridge(parent: Peer, origin: string, locks: BrokerLocks, estimate: () => Promise<StorageEstimate>) {
  let closed = false, busy = false;
  return {
    async receive(event: Pick<MessageEvent,'source'|'origin'|'data'>) {
      if (closed || event.source !== parent || event.origin !== origin) return;
      const data = event.data;
      if (data?.source==='ktv420-transfer' && data.type==='hello') { parent.postMessage({source:'ktv420-transfer',type:'ready',version:1},origin); return; }
      if (data?.source !== 'ktv420-library' || data.version !== 2 || typeof data.id !== 'string' || data.id.length>128) return;
      const response = {source:'ktv420-library',version:2,id:data.id};
      if (busy) { parent.postMessage({...response,ok:false,error:'Another transfer operation is still running.'},origin); return; }
      busy = true;
      try {
        const args = data.args;
        if (!Array.isArray(args)) throw new Error('Invalid transfer arguments.');
        let result: unknown;
        if (data.method==='exportCollection' && args.length===1) result=await exportCollection(args[0]);
        else if (data.method==='exportTrack' && args.length===1) result=await exportTrack(args[0]);
        else if (data.method==='beginImport' && args.length===1) result=await beginImport(args[0]);
        else if (data.method==='importTrack' && args.length===3) result=await importTrack(args[0],args[1],args[2],locks,estimate);
        else throw new Error('Unsupported transfer operation.');
        if (!closed) parent.postMessage({...response,ok:true,result},origin);
      } catch (error) { if (!closed) parent.postMessage({...response,ok:false,error:error instanceof Error ? error.message : 'Transfer failed.'},origin); }
      finally { busy=false; }
    },
    dispose() { closed=true; },
  };
}
export function mountTransferBridge() {
  const origin = import.meta.env.DEV ? location.origin : 'https://ktv420.web.app';
  const bridge = createTransferBridge(window.parent,origin,navigator.locks,()=>navigator.storage.estimate());
  window.addEventListener('message',event=>{void bridge.receive(event);});
  window.addEventListener('pagehide',()=>bridge.dispose(),{once:true});
  window.parent.postMessage({source:'ktv420-transfer',type:'ready',version:1},origin);
}
