export function md5Hex(bytes) { return new IncrementalMd5().update(bytes).hex(); }

export class IncrementalMd5 {
  constructor() {
    this.state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    this.tail = new Uint8Array(0); this.length = 0;
  }
  update(bytes) {
    this.length += bytes.length;
    if (this.tail.length) {
      const head = new Uint8Array(Math.min(64, this.tail.length + bytes.length));
      head.set(this.tail);
      const count = head.length - this.tail.length; head.set(bytes.subarray(0, count), this.tail.length);
      bytes = bytes.subarray(count);
      if (head.length < 64) { this.tail = head; return this; }
      md5Blocks(head, this.state);
    }
    const length = bytes.length - bytes.length % 64;
    if (length) md5Blocks(bytes.subarray(0, length), this.state);
    this.tail = bytes.slice(length); return this;
  }
  hex() {
    const padded = new Uint8Array(this.tail.length < 56 ? 64 : 128);
    padded.set(this.tail); padded[this.tail.length] = 0x80;
    const view = new DataView(padded.buffer), bits = this.length * 8;
    view.setUint32(padded.length - 8, bits >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(bits / 0x100000000), true);
    const state = [...this.state]; md5Blocks(padded, state);
    return state.map(wordToHexLe).join("");
  }
}

function md5Blocks(bytes, state) {
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const constants = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) {
    constants[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let [a0, b0, c0, d0] = state;

  const words = new Uint32Array(16);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const temp = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + constants[i] + words[g]) >>> 0, shifts[i])) >>> 0;
      a = temp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  state[0] = a0; state[1] = b0; state[2] = c0; state[3] = d0;
}

function rotateLeft(value, amount) {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function wordToHexLe(word) {
  let output = "";
  for (let i = 0; i < 4; i += 1) {
    output += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return output;
}
