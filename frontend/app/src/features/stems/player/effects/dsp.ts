import { OctaveLayer } from './octave';
import { SampleDelay as Delay, ReverseGrains } from './timeEffects';
import { effectIds, type AudioEffectType } from './catalog';
const TAU=Math.PI*2;
const vowelBands=[[800,1150,2900],[400,1700,2600],[300,2200,3000],[500,800,2800],[350,650,2700]];
const vowelQ=[5,7,9],phaseRatios=[.35,.65,1,1.7,2.8,4.5],roomLeft=[1,1,-1,-1,1,-1,1,-1],roomRight=[1,-1,1,-1,-1,1,1,-1];
const bipolarEffects=new Set<AudioEffectType>(['wah','dj-filter','tone','tilt-eq','bass-boost','bright','band-emphasis','lofi','octave']);
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
// Smooth unit ceiling for active processed peaks; exact dry/bypass never pass through it.
const ceiling=(x:number,dry:number)=>{
  const a=Math.abs(x),knee=Math.max(.85,Math.min(1,Math.abs(dry))),room=1-knee;
  if(a<=knee)return x;
  return Math.sign(x)*(room<1e-9?1:knee+room*Math.tanh((a-knee)/room));
};
const flush=(x:number)=>Math.abs(x)<1e-20?0:x;

/** Transposed direct-form II, with coefficients updated at control rate. */
class Filter {
  b0=1;b1=0;b2=0;a1=0;a2=0;z1=0;z2=0;
  set(type:'lowpass'|'highpass'|'bandpass'|'lowshelf'|'highshelf',frequency:number,q:number,rate:number,gain=0){
    const w=TAU*clamp(frequency,10,rate*.45)/rate,c=Math.cos(w),s=Math.sin(w),alpha=s/(2*q);
    let a0=1+alpha,a1=-2*c,a2=1-alpha,b0=1,b1=0,b2=0;
    if(type==='lowpass'){b0=(1-c)/2;b1=1-c;b2=b0;}
    else if(type==='highpass'){b0=(1+c)/2;b1=-1-c;b2=b0;}
    else if(type==='bandpass'){b0=alpha;b1=0;b2=-alpha;}
    else {
      const a=10**(gain/40),b=2*Math.sqrt(a)*s/Math.SQRT2;
      if(type==='lowshelf'){
        b0=a*((a+1)-(a-1)*c+b);b1=2*a*((a-1)-(a+1)*c);b2=a*((a+1)-(a-1)*c-b);
        a0=(a+1)+(a-1)*c+b;a1=-2*((a-1)+(a+1)*c);a2=(a+1)+(a-1)*c-b;
      }else{
        b0=a*((a+1)+(a-1)*c+b);b1=-2*a*((a-1)+(a+1)*c);b2=a*((a+1)+(a-1)*c-b);
        a0=(a+1)-(a-1)*c+b;a1=2*((a-1)-(a+1)*c);a2=(a+1)-(a-1)*c-b;
      }
    }
    this.b0=b0/a0;this.b1=b1/a0;this.b2=b2/a0;this.a1=a1/a0;this.a2=a2/a0;
  }
  tick(x:number){const y=this.b0*x+this.z1;this.z1=flush(this.b1*x-this.a1*y+this.z2);this.z2=flush(this.b2*x-this.a2*y);return y;}
  setWah(position:number,rate:number){
    // Single DC zero + resonant pole pair, as in the documented Faust/Smith
    // CryBaby model. GCB95-range sweep; this is not a transistor circuit clone.
    const w=TAU*400*5**position/rate,q=8*.25**position;
    const radius=1-w/(2*q),c=Math.cos(w),s=Math.sin(w);
    this.a1=-2*radius*c;this.a2=radius*radius;
    // Normalize at the pole angle to keep guitar-pedal voltage gain from
    // overwhelming already-mastered stems. The shared ceiling handles peaks.
    const real=1+this.a1*c+this.a2*Math.cos(2*w);
    const imaginary=-this.a1*s-this.a2*Math.sin(2*w);
    const gain=3*Math.hypot(real,imaginary)/Math.hypot(1-c,s);
    this.b0=gain;this.b1=-gain;this.b2=0;
  }
  reset(){this.z1=this.z2=0;}
}
class Diffuser {
  line:Delay;
  constructor(length:number){this.line=new Delay(length+2);}
  tick(x:number){const delayed=this.line.read(this.line.data.length-2),y=delayed-.65*x;this.line.write(x+.65*y);return y;}
  reset(){this.line.reset();}
}

export type EffectControl = { effect:number; amount:number; bypass:number; bpm:number; beats:number; tempo:number };
/** Bounded, allocation-free sample loop shared by the worklet and signal tests. */
export class StereoEffects {
  readonly rate:number;
  private filters=Array.from({length:6},()=>new Filter());
  private delay:Delay[];
  private room:Delay[];
  private octaveUp:OctaveLayer;
  private octaveDown:OctaveLayer;
  private reverse=new ReverseGrains();
  private octaveDirection=1;
  private diffusion:Diffuser[];
  private damp=new Float64Array(8);
  private feedback=new Float64Array(8);
  private roomValues=new Float64Array(8);
  private phaseState=new Float64Array(12);
  private phaseA=new Float64Array(6);
  private repeatLow=new Float64Array(2);
  private previousInput=new Float64Array(2);
  private saturator=Array.from({length:2},()=>new Filter());
  private envelope=0;
  private effect:AudioEffectType='wah';
  private requested:AudioEffectType='wah';
  private initialized=false;
  private amount=.5;
  private gate=1;
  private bypass=0;
  private n=0;
  private coefficientAmount=NaN;
  private echoDelay=0;
  private echoFrom=0;
  private echoTarget=0;
  private echoFade=1;
  private smoothing:number;
  private attack:number;
  private release:number;
  private repeatCoefficient:number;
  private roomCoefficient:number;
  left=0;right=0;
  constructor(rate:number){
    this.octaveUp=new OctaveLayer(rate,1);this.octaveDown=new OctaveLayer(rate,-1);
    this.rate=rate;this.smoothing=1-Math.exp(-1/(.015*rate));this.attack=1-Math.exp(-1/(.008*rate));this.release=1-Math.exp(-1/(.12*rate));
    this.repeatCoefficient=1-Math.exp(-TAU*3200/rate);this.roomCoefficient=1-Math.exp(-TAU*5500/rate);
    this.delay=[new Delay(Math.ceil(rate*12.1)),new Delay(Math.ceil(rate*12.1))];
    this.room=[.0297,.0371,.0411,.0437,.0479,.0533,.0593,.0617].map(seconds=>new Delay(Math.round(seconds*rate)+2));
    this.diffusion=[.0047,.0017,.0053,.0023].map(seconds=>new Diffuser(Math.round(seconds*rate)));
    this.saturator.forEach(filter=>filter.set('lowpass',Math.min(16000,rate*.4),.707,rate*4));
  }
  private reset(){
    this.filters.forEach(f=>f.reset());this.delay.forEach(d=>d.reset());this.room.forEach(d=>d.reset());this.diffusion.forEach(d=>d.reset());
    this.damp.fill(0);this.phaseState.fill(0);this.repeatLow.fill(0);this.previousInput.fill(0);this.saturator.forEach(f=>f.reset());this.envelope=0;this.coefficientAmount=NaN;
    this.echoTarget=this.echoDelay=this.echoFrom=0;this.echoFade=1;
    this.octaveUp.reset();this.octaveDown.reset();this.reverse.reset();
  }
  private configure(v:number,time:number){
    const kind=this.effect,amount=Math.abs(v-.5)*2;
    if(Math.abs(v-this.coefficientAmount)<.0001 && kind!=='envelope-filter' && kind!=='phaser' && kind!=='underwater')return;
    this.coefficientAmount=v;
    for(let c=0;c<2;c++){
      const f=this.filters[c*3],g=this.filters[c*3+1];
      switch(kind){
        case 'wah':f.setWah(v,this.rate);break;
        case 'band-emphasis':f.set('bandpass',220*(3400/220)**v,2+amount*3,this.rate);break;
        case 'envelope-filter':f.set('bandpass',250+4300*Math.sqrt(clamp(this.envelope*3,0,1))*v,1.4+v*2.6,this.rate);break;
        case 'underwater':{
          const cutoff=16000*(450/16000)**v*2**(.13*v*Math.sin(TAU*.19*time));
          f.set('lowpass',cutoff,.707+.45*v,this.rate);
          g.set('lowpass',cutoff*1.5,.707,this.rate);break;
        }
        case 'telephone':f.set('highpass',350,.707,this.rate);g.set('lowpass',3000,.707,this.rate);break;
        case 'dj-filter':f.set(v<.5?'lowpass':'highpass',v<.5?20000*(120/20000)**amount:25*(6000/25)**amount,.707,this.rate);break;
        case 'warm':case 'lofi':case 'submerge':f.set('lowpass',18000*(180/18000)**(kind==='lofi'?amount:v),.707,this.rate);break;
        case 'tone':case 'tilt-eq':f.set('lowshelf',350,.707,this.rate,-(v*2-1)*6);g.set('highshelf',2200,.707,this.rate,(v*2-1)*6);break;
        case 'bass-boost':f.set('lowshelf',180,.707,this.rate,(v*2-1)*9);break;
        case 'bright':f.set('highshelf',3500,.707,this.rate,(v*2-1)*9);break;
        case 'formant-filter':{
          const p=clamp((v-.2)*5,0,4),a=Math.floor(p),b=Math.min(4,a+1),t=p-a;
          for(let band=0;band<3;band++)this.filters[c*3+band].set('bandpass',vowelBands[a][band]*(1-t)+vowelBands[b][band]*t,vowelQ[band],this.rate);
          break;
        }
      }
    }
    if(kind==='phaser'){
      const frequency=450*2**(Math.sin(TAU*.16*time)*(1+v));
      for(let i=0;i<phaseRatios.length;i++){const k=Math.tan(Math.PI*Math.min(this.rate*.4,frequency*phaseRatios[i])/this.rate);this.phaseA[i]=(k-1)/(k+1);}
    }
    if(kind==='reverb'||kind==='shimmer-reverb')for(let i=0;i<8;i++)this.feedback[i]=10**(-3*(this.room[i].data.length-2)/this.rate/(kind==='shimmer-reverb'?1.8+v*5:.8+v*3.2));
  }
  tick(l:number,r:number,control:EffectControl,time:number){
    l=Number.isFinite(l)?l:0;r=Number.isFinite(r)?r:0;
    this.requested=effectIds[Math.round(control.effect)]??'wah';
    const target=clamp(Number.isFinite(control.amount)?control.amount:.5,0,1);
    if(!this.initialized){this.initialized=true;this.effect=this.requested;this.amount=target;this.bypass=control.bypass?1:0;}
    // Fade through the dry signal before replacing any delay/filter state.
    if(this.requested!==this.effect){this.gate=Math.max(0,this.gate-1/(this.rate*.02));if(this.gate===0){this.reset();this.effect=this.requested;this.amount=target;}}
    else this.gate=Math.min(1,this.gate+1/(this.rate*.02));
    this.amount+=(target-this.amount)*this.smoothing;
    this.bypass+=((control.bypass?1:0)-this.bypass)*this.smoothing;
    const level=Math.max(Math.abs(l),Math.abs(r));this.envelope+=(level-this.envelope)*(level>this.envelope?this.attack:this.release);
    if((this.n++&(this.effect==='underwater'?3:15))===0 || !Number.isFinite(this.coefficientAmount))this.configure(this.amount,time);
    const v=this.amount,kind=this.effect,bipolar=bipolarEffects.has(kind);
    const strength=bipolar?Math.abs(v-.5)*2:v;
    let outL=l,outR=r;
    if(kind==='octave'){
      const direction=v<.5?-1:1,layer=direction<0?this.octaveDown:this.octaveUp;
      if(direction!==this.octaveDirection){layer.reset();this.octaveDirection=direction;}
      layer.tick(l,r);
      const wet=strength*.85, dry=1-wet;
      outL=l*dry+layer.left*wet;outR=r*dry+layer.right*wet;
    }else if(kind==='reverse-echo'){
      const span=clamp(60/clamp(control.bpm,40,240)*control.beats/clamp(control.tempo,.5,2),.02,6)*this.rate;
      this.reverse.tick(this.delay,span);
      const feedback=.15+.3*v;
      this.repeatLow[0]+=this.repeatCoefficient*(this.reverse.left-this.repeatLow[0]);
      this.repeatLow[1]+=this.repeatCoefficient*(this.reverse.right-this.repeatLow[1]);
      this.delay[0].write(l+this.repeatLow[0]*feedback);this.delay[1].write(r+this.repeatLow[1]*feedback);
      outL=l*(1-.15*v)+this.reverse.left*.9*v;outR=r*(1-.15*v)+this.reverse.right*.9*v;
    }else if(kind==='reverb'||kind==='shimmer-reverb'){
      const dl=this.diffusion[1].tick(this.diffusion[0].tick(l)),dr=this.diffusion[3].tick(this.diffusion[2].tick(r));
      let sum=0,left=0,right=0;
      for(let i=0;i<8;i++){const d=this.room[i];const value=d.read(d.data.length-2);this.damp[i]+=this.roomCoefficient*(value-this.damp[i]);this.roomValues[i]=this.damp[i];sum+=this.damp[i];}
      for(let i=0;i<8;i++){this.room[i].write((i%2?dr:dl)*.3+(this.roomValues[i]-sum*.25)*this.feedback[i]);left+=this.roomValues[i]*roomLeft[i];right+=this.roomValues[i]*roomRight[i];}
      if(kind==='shimmer-reverb'){
        // Pitch the diffuse tail, preserving the immediate source. Feed-forward
        // shimmer keeps octave energy out of the room’s feedback stability loop.
        this.octaveUp.tick(left*.22,right*.22);
        outL=l*(1-.2*v)+(left*.22*.25+this.octaveUp.left*1.2)*v;
        outR=r*(1-.2*v)+(right*.22*.25+this.octaveUp.right*1.2)*v;
      }else{outL=l*(1-.25*v)+left*.22*v;outR=r*(1-.25*v)+right*.22*v;}
    }else for(let c=0;c<2;c++){
      const x=c?r:l,f=this.filters[c*3],g=this.filters[c*3+1];let y=x;
      switch(kind){
        case 'wah':{
          // A pedal filters the whole signal. Only blend dry near our deliberate
          // clean-center detent; smoothstep avoids an abrupt engagement edge.
          const blend=Math.min(1,strength/.12),engage=blend*blend*(3-2*blend);
          y=x*(1-engage)+f.tick(x)*engage;break;
        }
        case 'band-emphasis':y=x*(1-.85*strength)+f.tick(x)*.85*strength;break;
        case 'underwater':{
          const filtered=g.tick(f.tick(x)),line=this.delay[c];
          // Shared phase preserves mono placement. Feed-forward motion adds no
          // feedback tail; playback time makes replay/export deterministic.
          const lag=(.012+.0035*v*Math.sin(TAU*.29*time))*this.rate;
          const delayed=line.read(lag);line.write(filtered);
          // Fully wet avoids comb cancellation of bass against its delayed copy.
          const wet=delayed;
          const fade=Math.min(1,v/.15),engage=fade*fade*(3-2*fade);
          y=x*(1-engage)+wet*engage;break;
        }
        case 'telephone':y=x*(1-v)+g.tick(f.tick(x))*v;break;
        case 'dj-filter':case 'warm':case 'lofi':case 'submerge':y=x*(1-Math.min(1,strength*8))+f.tick(x)*Math.min(1,strength*8);break;
        case 'tone':case 'tilt-eq':y=g.tick(f.tick(x))*10**(-strength*2/20);break;
        case 'bass-boost':case 'bright':y=f.tick(x)*10**(-Math.max(0,v*2-1)*3/20);break;
        case 'envelope-filter':{const engage=Math.sqrt(v);y=x*(1-engage*.55)+f.tick(x)*engage*2.1;break;}
        case 'formant-filter':{const wet=f.tick(x)*.85+g.tick(x)*.55+this.filters[c*3+2].tick(x)*.35,mix=Math.min(1,v/.15);y=x*(1-.85*mix)+wet*mix*3;break;}
        case 'delay-pedal':{
          const targetDelay=clamp(60/clamp(control.bpm,40,240)*control.beats/clamp(control.tempo,.5,2),.02,6)*this.rate;
          if(c===0 && Math.abs(targetDelay-this.echoTarget)>.01){this.echoFrom=this.echoDelay || targetDelay;this.echoTarget=targetDelay;this.echoFade=0;}
          const d=this.delay[c],wet=d.read(this.echoFrom)*(1-this.echoFade)+d.read(this.echoTarget)*this.echoFade;
          const feedback=.15+.45*v;
          this.repeatLow[c]+=this.repeatCoefficient*(wet-this.repeatLow[c]);d.write(x+this.repeatLow[c]*feedback);
          // Keep the source present; feedback controls decay, not first-repeat loudness.
          y=x*(1-.2*v)+wet*.75*v;
          if(c===1){this.echoFade=Math.min(1,this.echoFade+1/(this.rate*.04));this.echoDelay=this.echoFrom*(1-this.echoFade)+this.echoTarget*this.echoFade;}
          break;
        }
        case 'chorus':case 'flange':{
          const chorus=kind==='chorus',depth=chorus?(.0005+v*.0055):(.0002+v*.005);
          const delay=(chorus?.019:.0055)+Math.sin(TAU*(chorus?.32:.12)*time+(chorus?c*Math.PI/2:0))*depth;
          const wet=this.delay[c].read(delay*this.rate);this.delay[c].write(x+wet*(chorus?.08:.55*v));
          const mix=.5*Math.sqrt(v);y=x*(1-mix)+wet*mix;break;
        }
        case 'phaser':{
          let wet=x+this.repeatLow[c]*.4*v;
          for(let i=0;i<phaseRatios.length;i++){const index=c*phaseRatios.length+i,a=this.phaseA[i],next=a*wet+this.phaseState[index];this.phaseState[index]=flush(wet-a*next);wet=next;}
          this.repeatLow[c]=wet;const mix=.5*Math.sqrt(v);y=x*(1-mix)+wet*mix;break;
        }
        case 'saturation':{
          const drive=1+v*7,normal=Math.tanh(drive*.25)/.25;
          // Four substeps with a reconstruction filter reduce waveshaping aliases.
          let wet=0;
          for(let step=1;step<=4;step++)wet=this.saturator[c].tick(Math.tanh((this.previousInput[c]+(x-this.previousInput[c])*step/4)*drive)/normal);
          this.previousInput[c]=x;y=x*(1-v)+wet*v;break;
        }
      }
      if(c===0)outL=y;else outR=y;
    }
    const mix=this.gate*(1-this.bypass);
    // At neutral use the exact dry samples (filters still keep their state warm).
    if(strength<1e-7 || mix<1e-7){this.left=l;this.right=r;return;}
    this.left=l+(ceiling(outL,l)-l)*mix;this.right=r+(ceiling(outR,r)-r)*mix;
    if(!Number.isFinite(this.left)||!Number.isFinite(this.right)){this.reset();this.left=l;this.right=r;}
  }
}
