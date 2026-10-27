import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackEnd } from '../stems/player/playbackEnd';
import { SongClock } from '../stems/player/tempo';

function fixture() {
  const sources: {onended:(()=>void)|null; stopAt:number; disconnected:boolean; buffer:unknown; loop:boolean; connect:()=>void; start:()=>void; stop:(when?:number)=>void; disconnect:()=>void}[] = [];
  const context = {currentTime:0,sampleRate:48000,destination:{},createBuffer:()=>({silent:true}),createBufferSource(){
    const source = {onended:null as (()=>void)|null,stopAt:Infinity,disconnected:false,buffer:null as unknown,loop:false,
      connect(){},start(){},stop(when=context.currentTime){this.stopAt=when;},disconnect(){this.disconnected=true;}};
    sources.push(source);return source;
  }};
  let completed=0;
  const completion = new PlaybackEnd(context as unknown as BaseAudioContext,()=>completed++);
  const clock = new SongClock(()=>context.currentTime);
  const advance = (time:number) => {context.currentTime=time;for(const source of sources)if(source.stopAt<=time)source.onended?.();};
  return {context,sources,completion,clock,advance,count:()=>completed};
}

test('audio deadline completes exactly once without animation frames, including a suspended audio clock',()=>{
  const f=fixture();f.clock.start(0,1,.02);f.completion.schedule(f.clock.endTime(4));
  f.advance(4);assert.equal(f.count(),0);
  // Wall time / page visibility cannot move this deadline; only the audio clock does.
  f.advance(4);assert.equal(f.count(),0);
  f.advance(4.02);assert.equal(f.count(),1);f.advance(9);assert.equal(f.count(),1);
  assert.ok(f.sources[0].disconnected);
});
test('tempo changes replace deadlines and ignore already queued old completions',()=>{
  const f=fixture();f.clock.start(0,1);f.completion.schedule(f.clock.endTime(10));
  const stale=f.sources[0].onended!;
  f.advance(2);f.clock.changeRate(.5);f.completion.schedule(f.clock.endTime(10));
  assert.equal(f.sources[1].stopAt,18);stale();assert.equal(f.count(),0);
  f.advance(10);assert.equal(f.count(),0);
  f.clock.changeRate(1.5);f.completion.schedule(f.clock.endTime(10));
  assert.equal(f.sources[2].stopAt,10+4/1.5);
  f.advance(10+4/1.5);assert.equal(f.count(),1);
});
test('pause, seek and disposal cancel old completion; scheduled starts retain their lead-in',()=>{
  const f=fixture();f.clock.start(0,1,.02);f.clock.changeRate(.5);
  f.completion.schedule(f.clock.endTime(4));assert.equal(f.sources[0].stopAt,8.02);
  const stale=f.sources[0].onended!;f.clock.pause();f.completion.cancel();
  f.advance(20);stale();assert.equal(f.count(),0);
  f.clock.start(3,1,20.02);f.completion.schedule(f.clock.endTime(4));
  assert.equal(f.sources[1].stopAt,21.02);
  const beforeSeek=f.sources[1].onended!;
  f.clock.start(1,1,20.02);f.completion.schedule(f.clock.endTime(4));
  beforeSeek();f.advance(21.02);assert.equal(f.count(),0);
  const beforeDispose=f.sources[2].onended!;f.completion.cancel();beforeDispose();
  f.advance(30);assert.equal(f.count(),0);assert.ok(f.sources.every(s=>s.disconnected));
});
