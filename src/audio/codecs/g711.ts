/** G.711 µ-law / A-law (8-bit telephony companding). */
export function linearToUlaw(x: number): number {
  const BIAS = 0x84, CLIP = 32635;
  let s = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}
export function ulawToLinear(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80, exp = (u >> 4) & 7, mant = u & 0x0f;
  let s = ((mant << 3) + 0x84) << exp;
  s -= 0x84;
  return (sign ? -s : s) / 32768;
}
export function linearToAlaw(x: number): number {
  let s = Math.round(Math.max(-1, Math.min(1, x)) * 32767) >> 3; // 13-bit
  let sign = 0x80;
  if (s < 0) { sign = 0; s = -s - 1; }
  let out: number;
  if (s < 32) out = s >> 1;
  else {
    let exp = 1;
    while (s >= 64 && exp < 7) { s >>= 1; exp++; }
    out = (exp << 4) | ((s >> 1) & 0x0f);
  }
  return (out | sign) ^ 0x55;
}
export function alawToLinear(a: number): number {
  a ^= 0x55;
  const sign = a & 0x80, exp = (a >> 4) & 7, mant = a & 0x0f;
  let s = exp === 0 ? (mant << 4) + 8 : ((mant << 4) + 0x108) << (exp - 1);
  return (sign ? s : -s) / 32768;
}
