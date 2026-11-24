/** Big-endian bit writer + CRCs used by the FLAC and Ogg writers. */
export class BitWriter {
  buf = new Uint8Array(1 << 16);
  pos = 0; // bytes written
  private acc = 0; // pending bits (MSB first)
  private nacc = 0;

  private ensure(extra: number) {
    if (this.pos + extra < this.buf.length) return;
    let n = this.buf.length * 2;
    while (n < this.pos + extra + 1) n *= 2;
    const b = new Uint8Array(n);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
  }

  /** Write the low `n` bits of `value` (n ≤ 32, value treated as unsigned). */
  bits(value: number, n: number) {
    if (n === 0) return;
    if (n > 24) {
      this.bits(Math.floor(value / 0x1000000) & ((1 << (n - 24)) - 1), n - 24);
      this.bits(value & 0xffffff, 24);
      return;
    }
    this.ensure(8);
    this.acc = (this.acc * (1 << n)) + (value & ((1 << n) - 1));
    this.nacc += n;
    while (this.nacc >= 8) {
      this.nacc -= 8;
      this.buf[this.pos++] = Math.floor(this.acc / (1 << this.nacc)) & 0xff;
      this.acc &= (1 << this.nacc) - 1;
    }
  }

  /** Signed integer in `n` bits two's complement. */
  signed(value: number, n: number) {
    this.bits(value < 0 ? value + 2 ** n : value, n);
  }

  /** `q` zero bits followed by a one. */
  unary(q: number) {
    while (q >= 24) { this.bits(0, 24); q -= 24; }
    this.bits(1, q + 1);
  }

  rice(v: number, k: number) {
    const u = v >= 0 ? v * 2 : -v * 2 - 1;
    const q = Math.floor(u / 2 ** k);
    this.unary(q);
    if (k) this.bits(u - q * 2 ** k, k);
  }

  alignZero() {
    if (this.nacc) this.bits(0, 8 - this.nacc);
  }

  bytes(b: Uint8Array) {
    this.alignZero();
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  get bitPos() {
    return this.pos * 8 + this.nacc;
  }

  result(): Uint8Array {
    this.alignZero();
    return this.buf.slice(0, this.pos);
  }
}

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
const CRC32_OGG = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c8 = i;
  for (let k = 0; k < 8; k++) c8 = c8 & 0x80 ? ((c8 << 1) ^ 0x07) & 0xff : (c8 << 1) & 0xff;
  CRC8[i] = c8;
  let c16 = i << 8;
  for (let k = 0; k < 8; k++) c16 = c16 & 0x8000 ? ((c16 << 1) ^ 0x8005) & 0xffff : (c16 << 1) & 0xffff;
  CRC16[i] = c16;
  let c32 = i << 24;
  for (let k = 0; k < 8; k++) c32 = c32 & 0x80000000 ? ((c32 << 1) ^ 0x04c11db7) >>> 0 : (c32 << 1) >>> 0;
  CRC32_OGG[i] = c32;
}

export function crc8(b: Uint8Array, start = 0, end = b.length) {
  let c = 0;
  for (let i = start; i < end; i++) c = CRC8[c ^ b[i]];
  return c;
}
export function crc16(b: Uint8Array, start = 0, end = b.length) {
  let c = 0;
  for (let i = start; i < end; i++) c = ((c << 8) ^ CRC16[((c >> 8) ^ b[i]) & 0xff]) & 0xffff;
  return c;
}
export function crc32ogg(b: Uint8Array) {
  let c = 0;
  for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC32_OGG[((c >>> 24) ^ b[i]) & 0xff]) >>> 0;
  return c;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

/** Float [-1,1] → signed integer of `bits` with TPDF dither (bits < 32). */
export function quantize(c: Float32Array, bits: number, dither = true): Int32Array {
  // Standard convention (same as every decoder): scale by 2^(bits-1), clamp the top code.
  const scale = 2 ** (bits - 1);
  const max = scale - 1;
  const d = dither ? 1 / scale : 0;
  const out = new Int32Array(c.length);
  for (let i = 0; i < c.length; i++) {
    const s = c[i] + (d ? (Math.random() - Math.random()) * d : 0);
    const q = Math.round(s * scale);
    out[i] = q > max ? max : q < -scale ? -scale : q;
  }
  return out;
}
