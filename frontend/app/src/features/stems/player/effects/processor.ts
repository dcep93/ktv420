import { StereoEffects, type EffectControl } from './dsp';
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name:string,processor:typeof AudioWorkletProcessor):void;
class KtvEffects extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'effect',defaultValue:0,minValue:0,maxValue:18,automationRate:'k-rate'},
    {name:'amount',defaultValue:.5,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'bypass',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},
    {name:'bpm',defaultValue:120,minValue:40,maxValue:240,automationRate:'k-rate'},
    {name:'beats',defaultValue:.5,minValue:.25,maxValue:2,automationRate:'k-rate'},
    {name:'tempo',defaultValue:1,minValue:.5,maxValue:2,automationRate:'k-rate'},
    {name:'clockRate',defaultValue:0,minValue:0,maxValue:2,automationRate:'k-rate'},
    {name:'clockOffset',defaultValue:0,automationRate:'k-rate'},
  ];}
  private dsp=new StereoEffects(sampleRate);
  private alive=true;
  private control:EffectControl={effect:0,amount:.5,bypass:0,bpm:120,beats:.5,tempo:1};
  constructor(){super();this.port.onmessage=event=>{if(event.data==='dispose')this.alive=false;};}
  process(inputs:Float32Array[][],outputs:Float32Array[][],parameters:Record<string,Float32Array>){
    if(!this.alive)return false;
    const output=outputs[0],input=inputs[0];if(!output?.[0])return true;
    const c=this.control;c.effect=parameters.effect[0];c.amount=parameters.amount[0];c.bypass=parameters.bypass[0];c.bpm=parameters.bpm[0];c.beats=parameters.beats[0];c.tempo=parameters.tempo[0];
    const left=input?.[0],right=input?.[1]??left,rate=parameters.clockRate[0],offset=parameters.clockOffset[0];
    for(let i=0;i<output[0].length;i++){
      this.dsp.tick(left?.[i]??0,right?.[i]??0,c,(currentFrame+i)/sampleRate*rate+offset);
      output[0][i]=this.dsp.left;if(output[1])output[1][i]=this.dsp.right;
    }
    return true;
  }
}
registerProcessor('ktv420-effects',KtvEffects);
