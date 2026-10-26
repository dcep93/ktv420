import { color, seed, stemRoles, type ArtFrame } from './artSceneState';
import { sceneEnergy, sceneLevel } from './sceneMotion';

export function spherePoint(latitude: number, longitude: number) {
  const ring = Math.cos(latitude);
  return { x: ring * Math.sin(longitude), y: Math.sin(latitude), z: ring * Math.cos(longitude) };
}
export function mirrorLight(x: number, y: number, z: number) {
  return .09 + .91 * Math.max(0, x * -.46 + y * -.55 + z * .7);
}
export function drawDiscoBall({ c, w, h, state }: ArtFrame) {
  const energy = sceneEnergy(state); if (energy < .001) return;
  const t = state.time, radius = Math.min(w * .28, h * .35), cx = w * .5, cy = h * .43;
  const halo = c.createRadialGradient(cx, cy, radius * .3, cx, cy, radius * 1.8);
  halo.addColorStop(0, 'rgba(113,83,128,.2)'); halo.addColorStop(1, 'rgba(113,83,128,0)');
  c.fillStyle = halo; c.fillRect(cx - radius * 1.8, cy - radius * 1.8, radius * 3.6, radius * 3.6);
  // A floor plane and off-center soft shadow give the ball weight and height.
  const floor = c.createLinearGradient(0, h * .7, 0, h);
  floor.addColorStop(0, '#100d17'); floor.addColorStop(1, '#26202e');
  c.fillStyle = floor; c.fillRect(0, h * .78, w, h * .22);
  c.save(); c.translate(cx + radius * .2, h * .87); c.scale(1, .2);
  const shadow = c.createRadialGradient(0, 0, radius * .1, 0, 0, radius * 1.1);
  shadow.addColorStop(0, 'rgba(0,0,0,.8)'); shadow.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = shadow; c.fillRect(-radius * 1.1, -radius * 1.1, radius * 2.2, radius * 2.2); c.restore();
  c.strokeStyle = '#665869'; c.lineWidth = 1; c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, cy - radius); c.stroke();
  c.fillStyle = '#0a0910'; c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.fill();
  // A hanging mirror ball turns leisurely: one revolution per four song minutes.
  const rotation = t * Math.PI * 2 / 240, rows = 18, cols = 36;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const lat = -Math.PI / 2 + (row + .5) / rows * Math.PI;
    const lon = col / cols * Math.PI * 2 + rotation;
    const center = spherePoint(lat, lon); if (center.z <= .015) continue;
    const role = stemRoles[Math.floor(seed(row * cols + col + 73) * 4)], level = sceneLevel(state, role);
    if (level < .001) continue;
    const light = mirrorLight(center.x, center.y, center.z);
    c.beginPath();
    for (let corner = 0; corner < 4; corner++) {
      const latitude = lat + (corner < 2 ? -.46 : .46) * Math.PI / rows;
      const longitude = lon + (corner === 0 || corner === 3 ? -.46 : .46) * Math.PI * 2 / cols;
      const point = spherePoint(latitude, longitude);
      const x = cx + point.x * radius, y = cy + point.y * radius;
      if (!corner) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath(); c.fillStyle = color(role, (.22 + .78 * Math.sqrt(level)) * light * (.68 + seed(row * cols + col) * .3)); c.fill();
    // Tight specular lobe moves across individual facets as the sphere turns.
    const highlight = Math.max(0, center.x * -.24 + center.y * -.35 + center.z * .905);
    const glint = Math.pow(highlight, 32) * (.3 + level * .7);
    if (glint > .03) { c.fillStyle = `rgba(255,242,220,${Math.min(.85, glint)})`; c.fill(); }
  }
  // Broad shade is independent of the random tile colors: a sphere, never a disc.
  const shade = c.createRadialGradient(cx - radius * .4, cy - radius * .45, radius * .1, cx - radius * .2, cy - radius * .25, radius * 1.3);
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(.5, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.75)');
  c.fillStyle = shade; c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.fill();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 64; i++) {
    const role = stemRoles[i % 4], level = sceneLevel(state, role); if (level < .001) continue;
    const a = seed(i + 771) * Math.PI * 2 + rotation * .75;
    const x = cx + Math.sin(a) * w * (.2 + seed(i + 13) * .35), y = h * (.13 + seed(i + 45) * .84);
    if (Math.hypot(x - cx, y - cy) < radius * 1.1) continue;
    const shimmer = .3 + .7 * (.5 + .5 * Math.sin(t * .7 + i * 2.8));
    c.fillStyle = color(role, Math.sqrt(level) * shimmer * .55); c.beginPath();
    c.ellipse(x, y, 1 + seed(i) * 3, y > h * .78 ? 1 : 1 + seed(i) * 3, -.3, 0, Math.PI * 2); c.fill();
  }
}
