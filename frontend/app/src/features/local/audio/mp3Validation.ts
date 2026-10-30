const CRC_TABLE = Uint16Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  return crc;
});
function checksum(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 255];
  return crc;
}
/** Small structural MP3 validator; never imports the hosted encoder/WASM runtime. */
export async function validateMp3(blob: unknown, sampleRate: number, frames: number): Promise<void> {
  const maximum = (Math.ceil((frames + 576) / 1152) + 2) * (Math.floor(144000 * 320 / sampleRate) + 1);
  if (!(blob instanceof Blob) || blob.size < 417 || blob.size > maximum) throw new Error('Invalid or oversized MP3 Blob.');
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  let offset = 0, count = 0, firstSize = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) throw new Error('Truncated MP3 frame.');
    const a = bytes[offset], b = bytes[offset + 1], c = bytes[offset + 2], d = bytes[offset + 3];
    const rate = [44100, 48000, 32000][(c >> 2) & 3];
    if (a !== 255 || b !== 251 || c >> 4 !== 14 || rate !== sampleRate || d >> 6 === 3 || (d & 3) === 2) {
      throw new Error('MP3 must be MPEG-1 Layer III stereo, 320 kbps CBR at the expected rate.');
    }
    const size = Math.floor(144000 * 320 / rate) + ((c >> 1) & 1);
    if (offset + size > bytes.length) throw new Error('Truncated MP3 frame data.');
    if (count === 0) firstSize = size;
    count++; offset += size;
  }
  const info = 36, lame = info + 120;
  const tag = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (firstSize < lame + 36 || tag(info, 4) !== 'Info' || view.getUint32(info + 4) !== 15 || tag(lame, 9) !== 'LAME3.100' || bytes[lame + 9] !== 1) throw new Error('MP3 requires a finalized CBR Info/LAME header.');
  const delay = (bytes[lame + 21] << 4) | (bytes[lame + 22] >> 4);
  const padding = ((bytes[lame + 22] & 15) << 8) | bytes[lame + 23];
  if (view.getUint32(info + 8) !== count - 1 || view.getUint32(info + 12) !== bytes.length || view.getUint32(lame + 28) !== bytes.length ||
    delay !== 576 || padding < 576 || padding > 1727 || (count - 1) * 1152 - delay - padding !== frames) {
    throw new Error('MP3 gapless frame count, byte count or duration does not match the original audio.');
  }
  if (checksum(bytes, 0, lame + 34) !== view.getUint16(lame + 34)) throw new Error('MP3 LAME header checksum is invalid.');
  if (checksum(bytes, firstSize, bytes.length) !== view.getUint16(lame + 32)) throw new Error('MP3 audio checksum is invalid.');
}
