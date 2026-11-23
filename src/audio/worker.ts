/// <reference lib="webworker" />
import { EFFECTS_BY_ID, Params } from './effects';

export interface EffectJob { id: number; effectId: string; params: Params; sampleRate: number; channels: Float32Array[]; profile?: { sampleRate: number; channels: Float32Array[] } }

self.onmessage = (e: MessageEvent<EffectJob>) => {
  const { id, effectId, params, sampleRate, channels, profile } = e.data;
  try {
    const out = EFFECTS_BY_ID[effectId].apply({ sampleRate, channels }, params, { profile });
    (self as unknown as Worker).postMessage({ id, ok: true, sampleRate: out.sampleRate, channels: out.channels }, out.channels.map((c) => c.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
