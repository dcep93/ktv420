import { beginVisualizer } from './canvas';
import { createStemSceneState, seed, updateStemScene, type StemVoice } from './stemScene';

const states = new WeakMap<HTMLCanvasElement, { audio: ReturnType<typeof createStemSceneState>; travel: number; time: number }>();
const TAU = Math.PI * 2;
export function resetHighway(canvas: HTMLCanvasElement) { states.delete(canvas); }

/** Shared perspective keeps road paint, shoulders and scenery on the same ground. */
export function highwayPoint(depth: number, side: number, w: number, h: number, time: number) {
  const p = Math.max(0, Math.min(1, depth));
  const curve = Math.sin(time * .055 + (1 - p) * 1.8) * w * .13 * (1 - p) ** 2;
  const half = w * (.008 + .46 * p ** 1.35);
  return { x: w * .5 + curve + side * half, y: h * (.43 + .59 * p), half };
}

export function drawHighway(canvas: HTMLCanvasElement, voices: StemVoice[], time: number, playing: boolean) {
  const surface = beginVisualizer(canvas); if (!surface) return;
  const { context: c, width: w, height: h } = surface;
  let state = states.get(canvas);
  if (!state) { state = { audio:createStemSceneState(), travel:time * .19, time }; states.set(canvas,state); }
  const delta = time - state.time;
  if (delta < 0 || delta > .5) state.travel = time * .19;
  else if (playing) state.travel += delta * (.17 + state.audio.levels.bass * .08);
  state.time = time;
  const { levels, pulse, vocalWave } = updateStemScene(state.audio, voices, time, playing);
  const bass = Math.min(1, levels.bass + levels.original * .6);
  const drums = Math.min(1, levels.drums + levels.original * .35);
  const vocals = Math.min(1, levels.vocals + levels.original * .5);
  const other = Math.min(1, levels.other + levels.original * .6);
  const horizon = highwayPoint(0,0,w,h,time), hy = horizon.y;
  const sky = c.createLinearGradient(0,0,0,h);
  sky.addColorStop(0,'#100e20'); sky.addColorStop(.43,'#35202f');
  sky.addColorStop(.435,'#251c29'); sky.addColorStop(1,'#0d0b13');
  c.fillStyle=sky;c.fillRect(0,0,w,h);

  // Fixed stars keep the sky quiet while the road moves toward the listener.
  for(let i=0;i<56;i++) {
    c.fillStyle=`rgba(231,213,224,${.12+seed(i+50)*.32})`;
    const radius=.5+seed(i+80)*.7;
    c.fillRect(seed(i)*w,seed(i+130)*hy*.79,radius,radius);
  }
  if (vocals > .001) {
    const radius=Math.min(w*.14,h*.215), cy=hy-radius*.61;
    const glow=c.createRadialGradient(horizon.x,cy,0,horizon.x,cy,radius*2.3);
    glow.addColorStop(0,`rgba(255,125,173,${vocals*.24})`);glow.addColorStop(1,'rgba(255,125,173,0)');
    c.fillStyle=glow;c.fillRect(horizon.x-radius*2.3,cy-radius*2.3,radius*4.6,radius*4.6);
    c.save();c.beginPath();c.arc(horizon.x,cy,radius,0,TAU);c.clip();
    const sun=c.createLinearGradient(0,cy-radius,0,cy+radius);
    sun.addColorStop(0,`rgba(255,211,147,${Math.sqrt(vocals)*.95})`);
    sun.addColorStop(1,`rgba(255,98,166,${Math.sqrt(vocals)*.85})`);
    c.fillStyle=sun;
    // Broad upper disc, progressively sliced lower half.
    c.fillRect(horizon.x-radius,cy-radius,radius*2,radius*.95);
    for(let i=0;i<7;i++) c.fillRect(horizon.x-radius,cy+radius*(i*.145),radius*2,radius*(.095-i*.007));
    c.restore();
    if (vocalWave) {
      c.beginPath();
      for(let i=0;i<=100;i++){
        const p=i/100,x=horizon.x-radius*1.7+p*radius*3.4;
        const sample=vocalWave[Math.floor(p*(vocalWave.length-1))];
        const y=cy+sample*radius*.24*Math.sin(p*Math.PI);
        if(i)c.lineTo(x,y);else c.moveTo(x,y);
      }
      c.strokeStyle=`rgba(255,156,204,${vocals*.8})`;c.lineWidth=1.3;c.stroke();
    }
  }

  // Distant mountains: slow parallax, without jumping camera or hue changes.
  if(other>.001) for(let layer=0;layer<3;layer++){
    c.beginPath();c.moveTo(0,hy+h*.09);
    for(let i=0;i<=64;i++){
      const x=i/64*w, u=i/64*9+time*.007*(layer+1);
      const peak=Math.abs(Math.sin(u*1.1+layer)*Math.cos(u*2.3+layer*4));
      const y=hy+h*.045-layer*h*.008-peak*h*(.075+layer*.018);
      c.lineTo(x,y);
    }
    c.lineTo(w,hy+h*.09);c.closePath();
    c.fillStyle=[`rgba(123,70,105,${other*.4})`,`rgba(81,55,86,${other*.65})`,`rgba(40,34,53,${other*.9})`][layer];c.fill();
  }

  const path = (side: number, from=0, to=1) => {
    c.beginPath();
    for(let i=0;i<=48;i++){
      const p=from+(to-from)*i/48, point=highwayPoint(p,side,w,h,time);
      if(i)c.lineTo(point.x,point.y);else c.moveTo(point.x,point.y);
    }
  };
  // Asphalt is continuous; everything moving uses the same projected depth.
  c.beginPath();
  for(let side=-1;side<=1;side+=2)for(let i=0;i<=48;i++){
    const p=side===-1?i/48:1-i/48, point=highwayPoint(p,side,w,h,time);
    if(side===-1&&i===0)c.moveTo(point.x,point.y);else c.lineTo(point.x,point.y);
  }
  c.closePath();c.fillStyle='#0b0b15';c.fill();
  for(const side of [-1,1]){
    path(side);
    if(bass>.001){c.strokeStyle=`rgba(244,113,188,${bass*.08})`;c.lineWidth=12+bass*9;c.stroke();}
    c.strokeStyle=`rgba(233,139,193,${.18+bass*.55})`;c.lineWidth=1.3+bass;c.stroke();
    path(side*1.055);c.strokeStyle=`rgba(174,135,102,${.12+bass*.22})`;c.lineWidth=1;c.stroke();
  }

  // Lane dashes accelerate naturally as they approach, rather than sliding flat.
  for(let lane=-1;lane<=1;lane+=2)for(let i=0;i<15;i++){
    const q=(i/15+state.travel%1)%1;
    const a=highwayPoint(q*q,lane*.32,w,h,time), b=highwayPoint(Math.min(1,(q+.023)**2),lane*.32,w,h,time);
    c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);
    c.strokeStyle=`rgba(226,185,144,${.1+q*.4+bass*.2})`;c.lineWidth=.5+q*q*3;c.stroke();
  }
  if(drums>.001) for(let i=0;i<20;i++)for(const side of [-1,1]){
    const q=(i/20+state.travel%1)%1,p=q*q, point=highwayPoint(p,side*1.12,w,h,time);
    const height=(1+p*21)*Math.min(1.3,w/800), intensity=drums*(.4+q*.5)+pulse*.45;
    c.strokeStyle=`rgba(255,192,119,${Math.min(.95,intensity)})`;c.lineWidth=1+p*2;
    c.beginPath();c.moveTo(point.x,point.y);c.lineTo(point.x,point.y-height);c.stroke();
    c.fillStyle=`rgba(255,211,157,${Math.min(.8,intensity)*p})`;
    c.fillRect(point.x-2-p*3,point.y-height-1-p*2,4+p*6,2+p*4);
  }
  // Bounded, deterministic roadside objects; no ever-growing spawn queue.
  if(other>.001) for(let i=0;i<22;i++){
    const q=(seed(i+400)+state.travel)%1,p=q*q;
    const side=i%2?-1:1,point=highwayPoint(p,side*(1.45+seed(i+330)*2.2),w,h,time);
    const height=h*(.012+p*.25)*( .55+seed(i+220)*.6), arm=height*.29;
    c.strokeStyle=`rgba(119,188,180,${other*(.25+p*.9)})`;c.lineWidth=Math.max(.8,height*.065);c.lineCap='round';
    c.beginPath();c.moveTo(point.x,point.y);c.lineTo(point.x,point.y-height);
    c.moveTo(point.x,point.y-height*.45);c.lineTo(point.x-arm,point.y-height*.45);c.lineTo(point.x-arm,point.y-height*.76);
    c.moveTo(point.x,point.y-height*.64);c.lineTo(point.x+arm*.8,point.y-height*.64);c.lineTo(point.x+arm*.8,point.y-height*.9);c.stroke();
  }
  // A soft vignette anchors the edges without obscuring the road.
  const vignette=c.createLinearGradient(0,0,w,0);
  vignette.addColorStop(0,'rgba(5,4,10,.55)');vignette.addColorStop(.23,'rgba(5,4,10,0)');
  vignette.addColorStop(.77,'rgba(5,4,10,0)');vignette.addColorStop(1,'rgba(5,4,10,.55)');
  c.fillStyle=vignette;c.fillRect(0,0,w,h);c.restore();
}
