import { createLibraryClient } from '../libraryClient';
import { extensionId } from '../extensionConnection';
export function connectTransfer() {
  const origin = import.meta.env.DEV ? location.origin : `chrome-extension://${extensionId()}`;
  const frame = document.createElement('iframe'); frame.hidden=true; frame.title='ktv420 file transfer';
  frame.src = import.meta.env.DEV ? '/broker.html?transfer=1' : `${origin}/build/index.html?transfer=1`;
  let ready = false;
  const client = createLibraryClient({
    send: message => frame.contentWindow?.postMessage(message,origin),
    subscribe: receive => {
      const listener = (event: MessageEvent) => { if (event.source===frame.contentWindow && event.origin===origin) receive(event.data); };
      window.addEventListener('message',listener); return ()=>window.removeEventListener('message',listener);
    },
  }, 180000);
  let stopReady = () => {};
  const connected = new Promise<void>((resolve,reject)=>{
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('Update ktv420 to extension 6.7.0 or newer, then reload this page.')); },15000);
    const hello = setInterval(()=>frame.contentWindow?.postMessage({source:'ktv420-transfer',type:'hello'},origin),1000);
    const cleanup = () => { clearTimeout(timer); clearInterval(hello); window.removeEventListener('message',listen); };
    const listen = (event: MessageEvent) => {
      if (event.source!==frame.contentWindow || event.origin!==origin || event.data?.source!=='ktv420-transfer' || event.data.type!=='ready' || event.data.version!==1) return;
      ready=true; cleanup(); resolve();
    };
    stopReady = () => { cleanup(); if (!ready) reject(new Error('Transfer connection closed.')); };
    window.addEventListener('message',listen);
  });
  document.body.append(frame);
  return {connected,request:client.request,dispose(){stopReady();client.dispose();frame.remove();}};
}
