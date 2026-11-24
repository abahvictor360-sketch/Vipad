/**
 * Signalling transports. Only connection set-up (SDP / ICE) travels here; audio goes peer-to-peer.
 * - supabase: Realtime broadcast channel (works across networks and from the https web app)
 * - local: BroadcastChannel between windows of the same browser (tests and same-device use)
 */
import type { SignalMsg } from './protocol';

export interface Signal {
  send(msg: SignalMsg): void;
  onMessage(cb: (msg: SignalMsg) => void): void;
  close(): void;
}

const SUPABASE_URL = 'https://geievghydjqlszwcmhdy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LIdtJQeWwQjHEz5s_mZvMA__jUmgZKd'; // publishable key: safe to ship

export type SignalKind = 'supabase' | 'local';

export function signalKind(): SignalKind {
  const q = new URLSearchParams(location.search).get('signal');
  return q === 'local' ? 'local' : 'supabase';
}

export async function openSignal(room: string, kind: SignalKind = signalKind()): Promise<Signal> {
  if (kind === 'local') {
    const bc = new BroadcastChannel(`vipad-link-${room}`);
    let cb: (m: SignalMsg) => void = () => undefined;
    bc.onmessage = (e) => cb(e.data as SignalMsg);
    return { send: (m) => bc.postMessage(m), onMessage: (f) => (cb = f), close: () => bc.close() };
  }
  const { RealtimeClient } = await import('@supabase/realtime-js');
  const client = new RealtimeClient(`${SUPABASE_URL.replace('https', 'wss')}/realtime/v1`, { params: { apikey: SUPABASE_KEY } });
  const channel = client.channel(`vipad-link:${room}`, { config: { broadcast: { self: false, ack: false } } });
  let cb: (m: SignalMsg) => void = () => undefined;
  const queue: SignalMsg[] = [];
  let ready = false;
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => cb(payload as SignalMsg));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Could not reach the Vipad Link service. Check your internet connection.')), 12000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(t);
        ready = true;
        for (const m of queue.splice(0)) void channel.send({ type: 'broadcast', event: 'signal', payload: m });
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(t);
        reject(new Error('The Vipad Link service refused the connection.'));
      }
    });
  });
  return {
    send: (m) => (ready ? void channel.send({ type: 'broadcast', event: 'signal', payload: m }) : queue.push(m)),
    onMessage: (f) => (cb = f),
    close: () => { void channel.unsubscribe(); client.disconnect(); },
  };
}

/** Public STUN servers for NAT traversal; an optional TURN relay can be added in Settings. */
export function iceServers(turn?: { url: string; username: string; credential: string } | null): RTCIceServer[] {
  const s: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  if (turn?.url) s.push({ urls: turn.url, username: turn.username, credential: turn.credential });
  return s;
}
