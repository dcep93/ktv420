import { fft, ifft, getHannWindow } from '../../../local/inference/fft';
const TAU = Math.PI * 2;
const wrap = (phase:number) => phase - TAU * Math.round(phase / TAU);

/** Fixed-ratio phase-vocoder layer. All buffers/twiddles are prepared off the sample loop. */
class OctaveChannel {
  private size:number;
  private hop:number;
  private mask:number;
  private window:Float32Array;
  private input:Float32Array;
  private output:Float32Array;
  private frame:Float32Array;
  private real:Float32Array;
  private imag:Float32Array;
  private restored:Float32Array;
  private restoredImag:Float32Array;
  private previous:Float64Array;
  private phases:Float64Array;
  private magnitudes:Float64Array;
  private frequencies:Float64Array;
  private initialPhase:Float64Array;
  private largest:Float64Array;
  private active:Uint8Array;
  private position=0;
  private countdown:number;
  private ratio:number;
  constructor(rate:number,ratio:number) {
    this.ratio=ratio;
    this.size=2**Math.ceil(Math.log2(rate*.04));this.hop=this.size/4;this.mask=this.size-1;this.countdown=this.hop;
    this.window=getHannWindow(this.size);
    this.input=new Float32Array(this.size);this.output=new Float32Array(this.size);this.frame=new Float32Array(this.size);
    this.real=new Float32Array(this.size);this.imag=new Float32Array(this.size);this.restored=new Float32Array(this.size);this.restoredImag=new Float32Array(this.size);
    const bins=this.size/2+1;
    this.previous=new Float64Array(bins);this.phases=new Float64Array(bins);this.magnitudes=new Float64Array(bins);this.frequencies=new Float64Array(bins);
    this.initialPhase=new Float64Array(bins);this.largest=new Float64Array(bins);this.active=new Uint8Array(bins);
    fft(this.real,this.imag,this.frame,this.size);ifft(this.restored,this.restoredImag,this.real,this.imag,this.size);
  }
  tick(x:number) {
    const y=this.output[this.position];this.output[this.position]=0;this.input[this.position]=x;
    this.position=(this.position+1)&this.mask;
    if(--this.countdown===0){this.process();this.countdown=this.hop;}
    return y;
  }
  private process() {
    const n=this.size,half=n/2;
    for(let i=0;i<n;i++)this.frame[i]=this.input[(this.position+i)&this.mask]*this.window[i];
    fft(this.real,this.imag,this.frame,n);
    this.magnitudes.fill(0);this.frequencies.fill(0);this.largest.fill(0);
    for(let k=0;k<=half;k++) {
      const magnitude=Math.hypot(this.real[k],this.imag[k]),phase=Math.atan2(this.imag[k],this.real[k]);
      const expected=TAU*k*this.hop/n;
      const omega=TAU*k/n+wrap(phase-this.previous[k]-expected)/this.hop;
      this.previous[k]=phase;
      const target=Math.round(k*this.ratio);
      if(target>half || omega*this.ratio>=Math.PI || omega<0)continue;
      this.magnitudes[target]+=magnitude;
      this.frequencies[target]+=magnitude*omega*this.ratio;
      if(magnitude>this.largest[target]){this.largest[target]=magnitude;this.initialPhase[target]=phase;}
    }
    this.real.fill(0);this.imag.fill(0);
    for(let k=0;k<=half;k++) {
      const magnitude=this.magnitudes[k];
      if(magnitude<1e-10){this.active[k]=0;continue;}
      this.phases[k]=this.active[k]?wrap(this.phases[k]+this.hop*this.frequencies[k]/magnitude):this.initialPhase[k];
      this.active[k]=1;
      const real=magnitude*Math.cos(this.phases[k]),imag=magnitude*Math.sin(this.phases[k]);
      this.real[k]=real;this.imag[k]=k===0||k===half?0:imag;
      if(k>0&&k<half){this.real[n-k]=real;this.imag[n-k]=-imag;}
    }
    ifft(this.restored,this.restoredImag,this.real,this.imag,n);
    // Hann/Hann overlap at N/4 sums to 1.5. The dry source is never delayed.
    for(let i=0;i<n;i++)this.output[(this.position+i)&this.mask]+=this.restored[i]*this.window[i]*(2/3);
  }
  reset() {
    this.input.fill(0);this.output.fill(0);this.previous.fill(0);this.phases.fill(0);this.active.fill(0);
    this.position=0;this.countdown=this.hop;
  }
}
export class OctaveLayer {
  private channels:OctaveChannel[];
  left=0;right=0;
  constructor(rate:number,direction:1|-1) { this.channels=[new OctaveChannel(rate,direction===1?2:.5),new OctaveChannel(rate,direction===1?2:.5)]; }
  tick(left:number,right:number){this.left=this.channels[0].tick(left);this.right=this.channels[1].tick(right);}
  reset(){this.channels.forEach(channel=>channel.reset());this.left=this.right=0;}
}
