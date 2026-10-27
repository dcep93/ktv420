import assert from 'node:assert/strict';
import test from 'node:test';
import { balancedPlatePalette, platePalette } from '../stems/player/visuals/platePalette';

test('balanced artwork that already uses the palette keeps every original color', () => {
  const roles = [3, 1, 0, 2, 2, 0, 3, 1];
  const colors = roles.flatMap(role => platePalette[role]);
  assert.deepEqual([...balancedPlatePalette(colors)], roles);
});

test('every color gets an equal share even for monochrome and heavily biased artwork', () => {
  for (const size of [0, 1, 3, 4, 17, 16384]) {
    const colors = Array.from({ length: size }, (_, i) => i % 9 ? platePalette[2] : platePalette[3]).flat();
    const roles = balancedPlatePalette(colors), counts = [0,0,0,0];
    roles.forEach(role => counts[role]++);
    assert.equal(roles.length, size);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    assert.deepEqual(balancedPlatePalette(colors), roles, 'assignment is deterministic');
  }
});

test('source colors choose assignments and a remainder goes to the nearest available color', () => {
  assert.deepEqual([...balancedPlatePalette(platePalette[3])], [3]);
  const source = platePalette.flat();
  const reversed = [...platePalette].reverse().flat();
  assert.deepEqual([...balancedPlatePalette(source)], [0,1,2,3]);
  assert.deepEqual([...balancedPlatePalette(reversed)], [3,2,1,0]);
});
