import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useHostedCapture} from './src/features/local/useHostedCapture';
import type {useSpotifyOverlay} from './src/features/local/useSpotifyOverlay';
if(!import.meta.env.DEV)throw Error('Development check only');
const a='1111111111111111111111',b='2222222222222222222222',c='3333333333333333333333';
const sleep=()=>new Promise(r=>setTimeout(r,30));
export function Check(){
  const [result,setResult]=useState('Ready');
  const [auto,setAuto]=useState(false),[libraryReady,setLibraryReady]=useState(false);
  const pending=useRef<{resolve:()=>void;reject:(e:Error)=>void}|null>(null),calls=useRef<string[]>([]),cancelled=useRef(0);
  const spotify={spotifyPath:`playlist/${a}`,navigation:{open:true,revision:1,trackIndex:null},tracks:auto?[{trackId:c}]:[{trackId:a},{trackId:b}],active:false,listening:{relayVersion:1,playing:auto,trackId:c,local:true,output:'muted',captureAllowed:true},
    captureOne:async(id:string)=>{calls.current.push(id);await new Promise<void>((resolve,reject)=>pending.current={resolve,reject});},
    cancelCapture:()=>{cancelled.current++;pending.current?.reject(Error('Capture stopped'));pending.current=null;},reportCaptureFraction:()=>{},transport:()=>{},
  } as unknown as ReturnType<typeof useSpotifyOverlay>;
  const capture=useHostedCapture({spotify,tracks:[],libraryReady,required:[],replaying:false,onError:()=>{}});
  const control=useRef(capture);control.current=capture;
  async function run(){
    try{
      control.current.toggle();await sleep();
      control.current.cancel();await sleep();
      if(control.current.active||calls.current.join()!==a)throw Error('cancel advanced or stayed active');
      calls.current=[];
      control.current.toggle();await sleep();
      if(calls.current.join()!==a||!control.current.active)throw Error('first capture did not start');
      pending.current!.resolve();await sleep();
      if(calls.current.join()!==[a,b].join())throw Error('second capture did not follow first commit');
      pending.current!.resolve();await sleep();
      if(control.current.active)throw Error('completed queue remained active');
      // Ending a completed queue stays idempotent.
      calls.current=[];
      control.current.cancel();await sleep();
      if(control.current.active)throw Error('cancel did not stop');
      calls.current=[];setAuto(true);await sleep();
      if(calls.current.length)throw Error('automatic capture started before library loaded');
      setLibraryReady(true);await sleep();
      if(calls.current.join()!==c)throw Error('hosted automatic capture did not request current song');
      control.current.cancel();await sleep();
      setResult('PASS: real React hook captures sequentially, finishes, and cancels without render loops.');
    }catch(e){setResult(`FAIL: ${e}`);}
  }
  return <><button onClick={()=>void run()}>Run checks</button><pre id="result">{result}</pre></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Check/></React.StrictMode>);
