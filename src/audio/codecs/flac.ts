/**
 * Lossless FLAC encoder (pure TypeScript).
 * Fixed linear predictors (orders 0–4), CONSTANT subframes for silence, stereo decorrelation
 * (independent / left-side / side-right / mid-side chosen per block) and partitioned Rice coding.
 */
import { AudioData, length } from '../buffer';
import { BitWriter, crc8, crc16, quantize, utf8 } from './bits';
import { Tags, vorbisComment } from './tags';

const BLOCK = 4096;

function residualOf(x: Int32Array, order: number, n: number): Int32Array {
  const r = new Int32Array(n - order);
  for (let i = order; i < n; i++) {
    let p = 0;
    switch (order) {
      case 1: p = x[i - 1]; break;
      case 2: p = 2 * x[i - 1] - x[i - 2]; break;
      case 3: p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3]; break;
      case 4: p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4]; break;
    }
    r[i - order] = x[i] - p;
  }
  return r;
}

/** Best Rice parameter for a run of residuals and its exact bit cost. */
function riceCost(r: Int32Array, s: number, e: number, maxK: number): { k: number; bits: number } {
  let sum = 0;
  for (let i = s; i < e; i++) sum += r[i] >= 0 ? r[i] * 2 : -r[i] * 2 - 1;
  const cnt = e - s;
  if (!cnt) return { k: 0, bits: 0 };
  const mean = sum / cnt;
  let k0 = mean > 1 ? Math.floor(Math.log2(mean)) : 0;
  let best = { k: 0, bits: Infinity };
  for (let k = Math.max(0, k0 - 1); k <= Math.min(maxK, k0 + 1); k++) {
    let bits = cnt * (k + 1);
    const div = 2 ** k;
    for (let i = s; i < e; i++) bits += Math.floor((r[i] >= 0 ? r[i] * 2 : -r[i] * 2 - 1) / div);
    if (bits < best.bits) best = { k, bits };
  }
  return best;
}

interface SubPlan { kind: 'constant' | 'verbatim' | 'fixed'; bits: number; order: number; res?: Int32Array; porder: number; params: number[] }

function planSubframe(x: Int32Array, n: number, bps: number): SubPlan {
  let constant = true;
  for (let i = 1; i < n; i++) if (x[i] !== x[0]) { constant = false; break; }
  if (constant) return { kind: 'constant', bits: 8 + bps, order: 0, porder: 0, params: [] };
  const paramBits = bps > 16 ? 5 : 4;
  const maxK = paramBits === 5 ? 30 : 14;
  let best: SubPlan = { kind: 'verbatim', bits: 8 + n * bps, order: 0, porder: 0, params: [] };
  for (let order = 0; order <= 4 && order < n; order++) {
    const res = residualOf(x, order, n);
    for (let p = 0; p <= 8; p++) {
      const parts = 1 << p;
      if (n % parts || (n >> p) <= order) break;
      const psize = n >> p;
      let bits = 8 + order * bps + 2 + 4;
      const params: number[] = [];
      for (let j = 0; j < parts; j++) {
        const s = j === 0 ? 0 : j * psize - order;
        const e = (j + 1) * psize - order;
        const c = riceCost(res, s, e, maxK);
        params.push(c.k);
        bits += paramBits + c.bits;
      }
      if (bits < best.bits) best = { kind: 'fixed', bits, order, res, porder: p, params };
    }
  }
  return best;
}

function writeSubframe(w: BitWriter, x: Int32Array, n: number, bps: number, plan: SubPlan) {
  if (plan.kind === 'constant') {
    w.bits(0, 1); w.bits(0, 6); w.bits(0, 1);
    w.signed(x[0], bps);
    return;
  }
  if (plan.kind === 'verbatim') {
    w.bits(0, 1); w.bits(1, 6); w.bits(0, 1);
    for (let i = 0; i < n; i++) w.signed(x[i], bps);
    return;
  }
  const paramBits = bps > 16 ? 5 : 4;
  w.bits(0, 1); w.bits(8 | plan.order, 6); w.bits(0, 1);
  for (let i = 0; i < plan.order; i++) w.signed(x[i], bps);
  w.bits(paramBits === 5 ? 1 : 0, 2);
  w.bits(plan.porder, 4);
  const res = plan.res!;
  const psize = n >> plan.porder;
  for (let j = 0; j < plan.params.length; j++) {
    const k = plan.params[j];
    w.bits(k, paramBits);
    const s = j === 0 ? 0 : j * psize - plan.order;
    const e = (j + 1) * psize - plan.order;
    for (let i = s; i < e; i++) w.rice(res[i], k);
  }
}

const RATE_CODES: Record<number, number> = { 88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 };
const SIZE_CODES: Record<number, number> = { 8: 1, 12: 2, 16: 4, 20: 5, 24: 6, 32: 7 };

function writeUtf8Num(w: BitWriter, v: number) {
  if (v < 0x80) { w.bits(v, 8); return; }
  const bytes: number[] = [];
  let n = v;
  let lim = 0x3f;
  let lead = 0x80;
  while (n > lim) {
    bytes.unshift(0x80 | (n & 0x3f));
    n = Math.floor(n / 64);
    lim >>= 1;
    lead = (lead >> 1) | 0x80;
  }
  w.bits(lead | n, 8);
  for (const b of bytes) w.bits(b, 8);
}

export function encodeFlac(a: AudioData, bitDepth: 16 | 24 = 16, tags: Tags = {}): Uint8Array {
  if (a.sampleRate < 1 || a.sampleRate > 655350) throw new Error('FLAC supports sample rates up to 655,350 Hz');
  const n = length(a);
  const chs = Math.min(8, a.channels.length);
  const ints = a.channels.slice(0, chs).map((c) => quantize(c, bitDepth, bitDepth === 16));
  const w = new BitWriter();
  w.bytes(utf8('fLaC'));
  // STREAMINFO
  const vc = vorbisComment(tags);
  w.bits(0, 1); w.bits(0, 7); w.bits(34, 24);
  const bs = n >= BLOCK ? BLOCK : Math.max(16, n);
  w.bits(bs, 16); w.bits(bs, 16);
  w.bits(0, 24); w.bits(0, 24);
  w.bits(a.sampleRate, 20); w.bits(chs - 1, 3); w.bits(bitDepth - 1, 5);
  w.bits(Math.floor(n / 2 ** 32), 4); w.bits(n >>> 0, 32);
  for (let i = 0; i < 16; i++) w.bits(0, 8);
  // VORBIS_COMMENT (last metadata block)
  w.bits(1, 1); w.bits(4, 7); w.bits(vc.length, 24);
  w.bytes(vc);

  const rateCode = RATE_CODES[a.sampleRate] ?? 0;
  let frame = 0;
  for (let off = 0; off < n || (n === 0 && frame === 0); off += BLOCK, frame++) {
    const len = Math.min(BLOCK, n - off);
    if (len <= 0) break;
    const blk = ints.map((c) => c.subarray(off, off + len));
    // choose channel decorrelation for stereo
    let assign = chs - 1;
    let subs: { x: Int32Array; bps: number; plan: SubPlan }[];
    if (chs === 2) {
      const [L, R] = blk;
      const S = new Int32Array(len), M = new Int32Array(len);
      for (let i = 0; i < len; i++) { S[i] = L[i] - R[i]; M[i] = (L[i] + R[i]) >> 1; }
      const pL = planSubframe(L, len, bitDepth), pR = planSubframe(R, len, bitDepth);
      const pS = planSubframe(S, len, bitDepth + 1), pM = planSubframe(M, len, bitDepth);
      const opts = [
        { a: 1, bits: pL.bits + pR.bits, subs: [{ x: L, bps: bitDepth, plan: pL }, { x: R, bps: bitDepth, plan: pR }] },
        { a: 8, bits: pL.bits + pS.bits, subs: [{ x: L, bps: bitDepth, plan: pL }, { x: S, bps: bitDepth + 1, plan: pS }] },
        { a: 9, bits: pS.bits + pR.bits, subs: [{ x: S, bps: bitDepth + 1, plan: pS }, { x: R, bps: bitDepth, plan: pR }] },
        { a: 10, bits: pM.bits + pS.bits, subs: [{ x: M, bps: bitDepth, plan: pM }, { x: S, bps: bitDepth + 1, plan: pS }] },
      ];
      const best = opts.reduce((x, y) => (y.bits < x.bits ? y : x));
      assign = best.a;
      subs = best.subs;
    } else {
      subs = blk.map((x) => ({ x, bps: bitDepth, plan: planSubframe(x, len, bitDepth) }));
    }
    const start = w.pos;
    w.bits(0x3ffe, 14); w.bits(0, 1); w.bits(0, 1);
    w.bits(7, 4); // block size: 16-bit (len-1) at end of header
    w.bits(rateCode, 4);
    w.bits(assign, 4);
    w.bits(SIZE_CODES[bitDepth], 3); w.bits(0, 1);
    writeUtf8Num(w, frame);
    w.bits(len - 1, 16);
    w.bits(crc8(w.buf, start, w.pos), 8);
    for (const s of subs) writeSubframe(w, s.x, len, s.bps, s.plan);
    w.alignZero();
    w.bits(crc16(w.buf, start, w.pos), 16);
  }
  return w.result();
}
