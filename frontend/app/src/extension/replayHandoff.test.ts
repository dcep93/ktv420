import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {PerformanceRecording} from '../features/local/recording';
type Handler=(message:unknown,sender:chrome.runtime.MessageSender,respond:(data:unknown)=>void)=>boolean;
test('external handoff restricts origin/frame, validates files, persists before navigation, and isolates the destination tab',async t=>{
 let external:Handler, internal:Handler;const operations:string[]=[];let stored:Record<string,unknown>={};
 const id='1111111111111111111111';
 const recording:PerformanceRecording={version:2,name:'test',createdAt:'2026-10-14',spotifyPath:`playlist/${id}`,tracks:[{id,title:'Song',duration:12}],events:[
 {at:0,type:'track',trackId:id,position:0,snapshot:{visualizer:'time-ribbon',spotlight:null,stems:[{name:'vocals.mp3',input:false,volume:1,mute:false,deafen:false,effect:'wah',value:.5}]}},
 {at:1,type:'stop',trackId:id,position:1}]};
 const previous=Object.getOwnPropertyDescriptor(globalThis,'chrome');
 Object.defineProperty(globalThis,'chrome',{configurable:true,value:{action:{onClicked:{addListener(){}}},runtime:{id:'self',onMessage:{addListener(h:Handler){internal=h}},onMessageExternal:{addListener(h:Handler){external=h}}},
 storage:{local:{async set(value:Record<string,unknown>){operations.push('persist');stored=value},async get(){return stored}}},
 tabs:{async create(tab:{url:string}){operations.push(`create:${tab.url}`);return {id:44}},async update(tabId:number,tab:{url:string}){operations.push(`navigate:${tabId}:${tab.url}`)}}}});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'chrome',previous);else Reflect.deleteProperty(globalThis,'chrome');});
 await import('./background');
 const sender={url:'https://ktv420.web.app/replay',frameId:0};
 const request={type:'ktv420:open-replay',recording};
 for(const untrusted of [{...sender,url:'https://evil.example/replay'},{...sender,url:'https://ktv420.web.app/player/'},{...sender,frameId:2}]) {
  assert.equal(external!(request,untrusted,()=>assert.fail('untrusted caller answered')),false);
 }
 assert.equal(external!({type:'read-audio'},sender,()=>assert.fail()),false);
 const call=(handler:Handler,message:unknown,source:chrome.runtime.MessageSender)=>new Promise<{ok:boolean;result?:unknown;error?:string}>(resolve=>handler(message,source,data=>resolve(data as {ok:boolean;result?:unknown;error?:string})));
 assert.equal((await call(external!,{...request,recording:{version:1}},sender)).ok,false);assert.equal(operations.length,0);
 assert.equal((await call(external!,request,sender)).ok,true);
 assert.deepEqual(operations,['create:about:blank','persist',`navigate:44:https://open.spotify.com/playlist/${id}`]);
 const content={id:'self',url:`https://open.spotify.com/playlist/${id}`,tab:{id:44} as chrome.tabs.Tab};
 assert.deepEqual((await call(internal!,{type:'ktv420:pending-replay'},content)).result,recording);
 assert.equal((await call(internal!,{type:'ktv420:pending-replay'},{...content,tab:{id:45} as chrome.tabs.Tab})).result,null);
 assert.equal((await call(internal!,{type:'ktv420:pending-replay'},{...content,url:`https://open.spotify.com/album/${id}`})).result,null);
});
