import { sceneColors, stemRoles } from './stemScene';

export const platePalette = stemRoles.slice(0, 4).map(role => sceneColors[role].split(',').map(Number));
const linear = (channel: number) => {
  const value = channel / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
};
function oklab(red: number, green: number, blue: number) {
  const r = linear(red), g = linear(green), b = linear(blue);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}
const perceptualPalette = platePalette.map(([r, g, b]) => oklab(r, g, b));

/** Fixed, balanced matching of RGB triplets. Strong color preferences get first
 * choice; source order breaks ties. No random assignment or per-frame matching. */
export function balancedPlatePalette(rgb: readonly number[]): Uint8Array {
  const count = Math.floor(rgb.length / 3), assignments = new Uint8Array(count);
  const costs = new Float64Array(count * 4), confidence = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const lab = oklab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    let best = Infinity, next = Infinity;
    for (let role = 0; role < 4; role++) {
      const color = perceptualPalette[role];
      const cost = (lab[0] - color[0]) ** 2 + (lab[1] - color[1]) ** 2 + (lab[2] - color[2]) ** 2;
      costs[i * 4 + role] = cost;
      if (cost < best) { next = best; best = cost; }
      else if (cost < next) next = cost;
    }
    confidence[i] = next - best;
  }
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => confidence[b] - confidence[a] || a - b);
  const shares = [0, 0, 0, 0], quota = Math.floor(count / 4);
  let remainder = count % 4;
  for (const i of order) {
    let chosen = -1, best = Infinity;
    for (let role = 0; role < 4; role++) {
      if (shares[role] >= quota && !(remainder && shares[role] === quota)) continue;
      const cost = costs[i * 4 + role];
      if (cost < best) { chosen = role; best = cost; }
    }
    if (shares[chosen] === quota) remainder--;
    shares[chosen]++; assignments[i] = chosen;
  }
  return assignments;
}
