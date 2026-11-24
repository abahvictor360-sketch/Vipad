import { useEffect, useState } from 'react';
import { Radio, Copy, Mic, MicOff, X, Check, Headphones, Wifi, Volume2, ExternalLink } from 'lucide-react';
import QRCode from 'qrcode';
import { Modal } from './Modal';
import { useEditor } from '../../store/editor';
import { useSettings } from '../../store/settings';
import { useLink, Guest } from '../../link/store';
import { useVban, linkBridge } from '../../link/vban';
import { formatCode, joinUrl, normalizeCode, Quality, QUALITY } from '../../link/protocol';
import { signalKind } from '../../link/signal';

type Tab = 'receive' | 'send' | 'vban';

const os = (): 'windows' | 'mac' | 'linux' | 'ios' | 'android' | 'other' => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'mac';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
};

function Level({ v, testId }: { v: number; testId?: string }) {
  const db = v > 1e-5 ? 20 * Math.log10(v) : -60;
  const pct = Math.max(0, Math.min(1, (db + 60) / 60)) * 100;
  return (
    <span className="link-meter" data-testid={testId} data-level={v.toFixed(4)} aria-label={`Level ${Math.round(db)} dB`}>
      <i style={{ width: `${pct}%`, background: db > -3 ? 'var(--danger, #ff5a5a)' : db > -12 ? '#ffd23d' : 'var(--lime)' }} />
    </span>
  );
}

function StatusDot({ s }: { s: string }) {
  const color = s === 'connected' ? 'var(--lime)' : s === 'lost' || s === 'error' ? '#ff5a5a' : '#ffd23d';
  return <span className="link-dot" style={{ background: color }} aria-hidden />;
}

// ---------------------------------------------------------------- Receive
function VirtualMicHelp() {
  const virtualOutput = useLink((s) => s.virtualOutput);
  const [mic, setMic] = useState<{ supported: boolean; active: boolean; error?: string } | null>(null);
  const bridge = linkBridge();
  const platform = os();
  useEffect(() => { if (bridge && platform === 'linux') void bridge.micStatus().then(setMic); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (virtualOutput) {
    return (
      <p className="link-ok" data-testid="link-virtual-ok">
        <Check size={15} /> Sending into <strong>{virtualOutput.product}</strong>. In Zoom, OBS, Discord or your DAW choose the microphone <strong>“{virtualOutput.micName}”</strong>.
      </p>
    );
  }
  return (
    <div className="link-help">
      <strong>Use it as a microphone in other apps</strong>
      {platform === 'linux' && bridge && (
        <>
          <p>Vipad can create a <em>Vipad Link Microphone</em> for every app on this computer.</p>
          {mic?.error ? <p className="muted">{mic.error}</p> : (
            <button className="btn btn-secondary btn-sm" disabled={mic?.active} data-testid="link-create-mic" onClick={async () => {
              try { await bridge.createMic(); setMic({ supported: true, active: true }); await useLink.getState().refreshOutputs(); } catch (e) { alert((e as Error).message); }
            }}>{mic?.active ? 'Microphone created' : 'Create Vipad Link microphone'}</button>
          )}
        </>
      )}
      {platform === 'linux' && !bridge && <p>Open this in the Vipad desktop app to create a virtual microphone automatically, or run <code>pactl load-module module-null-sink sink_name=vipad_link</code> and pick its monitor as the mic.</p>}
      {platform === 'windows' && <p>Install the free <a href="https://vb-audio.com/Cable/" target="_blank" rel="noreferrer">VB-CABLE <ExternalLink size={12} /></a> (or Voicemeeter). Vipad then sends into “CABLE Input” automatically — pick <strong>“CABLE Output”</strong> as the microphone in your other app.</p>}
      {platform === 'mac' && <p>Install the free <a href="https://existential.audio/blackhole/" target="_blank" rel="noreferrer">BlackHole 2ch <ExternalLink size={12} /></a>. Vipad then sends into it automatically — pick <strong>“BlackHole 2ch”</strong> as the microphone in your other app.</p>}
      {(platform === 'ios' || platform === 'android' || platform === 'other') && <p>Phones and tablets can’t provide a microphone to other apps. Receive on a computer to use the audio in other apps, or record it here in Vipad.</p>}
      <p className="muted">Without a virtual microphone you’ll hear guests on the selected output and can still record them in Vipad.</p>
    </div>
  );
}

function GuestRow({ g }: { g: Guest }) {
  const l = useLink.getState();
  if (g.status === 'pending') {
    return (
      <li className="link-guest pending" data-testid="link-guest">
        <StatusDot s="pending" />
        <span className="link-guest-name"><strong>{g.name}</strong><small>{g.device} · {QUALITY[g.quality].label} · wants to connect</small></span>
        <button className="btn btn-primary btn-sm" onClick={() => l.accept(g.id)} data-testid="link-accept">Accept</button>
        <button className="btn btn-ghost btn-sm" onClick={() => l.reject(g.id)} data-testid="link-decline">Decline</button>
      </li>
    );
  }
  return (
    <li className="link-guest" data-testid="link-guest" data-status={g.status}>
      <StatusDot s={g.status} />
      <span className="link-guest-name">
        <strong>{g.name}</strong>
        <small data-testid="link-guest-status">
          {g.status === 'connected' ? 'Connected' : g.status === 'reconnecting' ? 'Reconnecting…' : g.status === 'lost' ? 'Connection lost' : 'Connecting…'}
          {g.latencyMs !== null && <> · <span data-testid="link-latency">{g.latencyMs} ms</span></>}
          {g.kbps !== null && <> · {g.kbps} kbps</>}
        </small>
      </span>
      <Level v={g.muted ? 0 : g.level} testId="link-guest-level" />
      <input type="range" className="slider link-vol" min={0} max={2} step={0.01} value={g.volume} aria-label={`${g.name} volume`} style={{ ['--pct' as string]: `${(g.volume / 2) * 100}%` }} onChange={(e) => l.setGuest(g.id, { volume: Number(e.target.value) })} />
      <button className="icon-btn" aria-label={g.muted ? 'Unmute' : 'Mute'} title={g.muted ? 'Unmute' : 'Mute'} onClick={() => l.setGuest(g.id, { muted: !g.muted })}>{g.muted ? <MicOff size={16} /> : <Mic size={16} />}</button>
      <button className="icon-btn" aria-label="Disconnect guest" title="Disconnect" onClick={() => l.kick(g.id)} data-testid="link-kick"><X size={16} /></button>
    </li>
  );
}

function ReceiveTab() {
  const { role, code, guests, autoAccept, outputs, outputId, monitor, recordLink, error, startHosting, stopHosting, setAutoAccept, setOutput, setMonitor, setRecordLink } = useLink();
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const url = code ? joinUrl(code) + (signalKind() === 'local' ? '&signal=local' : '') : '';
  useEffect(() => {
    if (!url) return setQr('');
    void QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0b0d08', light: '#ffffff' } }).then(setQr);
  }, [url]);

  if (role === 'guest') return <p className="muted">This device is sending. Disconnect on the Send tab to receive instead.</p>;
  if (role !== 'host') {
    return (
      <div className="link-intro">
        <p>Turn this device into a <strong>receiver</strong>. Phones, tablets and other computers can then send their microphone here — on the same Wi-Fi or over the internet — and other apps can use it as an audio input.</p>
        <ul className="link-points">
          <li>Low latency Opus audio, encrypted end-to-end (WebRTC)</li>
          <li>Several senders at once, each with its own volume</li>
          <li>Nothing to install on the sending device — it just opens a link</li>
        </ul>
        {error && <p className="alert" role="alert">{error}</p>}
        <button className="btn btn-primary" onClick={() => void startHosting()} data-testid="link-start-receive"><Radio size={16} /> Start receiving</button>
      </div>
    );
  }
  return (
    <div className="link-host">
      <div className="link-code-card">
        {qr && <img src={qr} alt="QR code to join" width={150} height={150} className="link-qr" />}
        <div>
          <span className="muted">Connection code</span>
          <div className="link-code" data-testid="link-code" data-code={code}>{formatCode(code!)}</div>
          <p className="muted">Scan the QR code with a phone, or open Vipad → Vipad Link → Send on any device and type the code.</p>
          <button className="btn btn-secondary btn-sm" data-testid="link-copy" onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy invite link'}
          </button>
        </div>
      </div>

      <h3 className="link-h">Senders {guests.length > 0 && <span className="muted">({guests.length})</span>}</h3>
      {guests.length === 0 ? <p className="muted link-empty" data-testid="link-waiting">Waiting for someone to join…</p> : (
        <ul className="link-guests">{guests.map((g) => <GuestRow key={g.id} g={g} />)}</ul>
      )}

      <h3 className="link-h">Output</h3>
      <label className="field">
        <span className="field-label">Play guests into</span>
        <select value={outputId || 'default'} onChange={(e) => void setOutput(e.target.value)} data-testid="link-output">
          {!outputs.some((o) => o.deviceId === 'default') && <option value="default">System default</option>}
          {outputs.map((o) => <option key={o.deviceId} value={o.deviceId}>{o.label}</option>)}
        </select>
      </label>
      <VirtualMicHelp />
      <label className="set-toggle">
        <span><strong>Listen on this computer</strong><small>Hear the guests on your default speakers or headphones too.</small></span>
        <input type="checkbox" role="switch" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} />
      </label>
      <label className="set-toggle">
        <span><strong>Record guests in Vipad</strong><small>The Record button captures the guests instead of this computer’s microphone.</small></span>
        <input type="checkbox" role="switch" checked={recordLink} onChange={(e) => setRecordLink(e.target.checked)} data-testid="link-record-toggle" />
      </label>
      <label className="set-toggle">
        <span><strong>Accept everyone automatically</strong><small>Only for this session. Otherwise you approve each sender.</small></span>
        <input type="checkbox" role="switch" checked={autoAccept} onChange={(e) => setAutoAccept(e.target.checked)} data-testid="link-auto-accept" />
      </label>
      {error && <p className="alert" role="alert">{error}</p>}
      <button className="btn btn-ghost" onClick={stopHosting} data-testid="link-stop-receive">Stop receiving</button>
    </div>
  );
}

// ---------------------------------------------------------------- Send
function SendTab({ initialCode }: { initialCode?: string }) {
  const { role, sendStatus, sendLevel, sendLatencyMs, sendMuted, hostName, error, join, leave, toggleSendMute } = useLink();
  const s = useSettings();
  const [code, setCode] = useState(initialCode ? formatCode(initialCode) : '');
  const valid = normalizeCode(code);
  const platform = os();

  if (role === 'host') return <p className="muted">This device is receiving. Stop receiving to send instead.</p>;
  if (role === 'guest') {
    return (
      <div className="link-send-live" data-testid="link-sending" data-status={sendStatus}>
        <div className="link-send-head">
          <StatusDot s={sendStatus} />
          <strong data-testid="link-send-status">
            {sendStatus === 'waiting' ? 'Waiting for the receiver to accept…' : sendStatus === 'connecting' ? 'Connecting…' : sendStatus === 'connected' ? `Live — sending to ${hostName ?? 'receiver'}` : sendStatus === 'reconnecting' ? 'Reconnecting…' : 'Not connected'}
          </strong>
          {sendLatencyMs !== null && sendStatus === 'connected' && <span className="muted">≈ {sendLatencyMs} ms</span>}
        </div>
        <Level v={sendMuted ? 0 : sendLevel} testId="link-send-level" />
        <div className="link-send-actions">
          <button className={`btn ${sendMuted ? 'btn-primary' : 'btn-secondary'}`} onClick={toggleSendMute} data-testid="link-send-mute">{sendMuted ? <><MicOff size={16} /> Unmute</> : <><Mic size={16} /> Mute</>}</button>
          <button className="btn btn-ghost" onClick={leave} data-testid="link-disconnect">Disconnect</button>
        </div>
        {platform === 'ios' && <p className="muted">Keep this screen open — iPhone and iPad stop the microphone when the screen locks or you switch apps.</p>}
        {platform === 'android' && <p className="muted">Keep Vipad open while sending. Plug in headphones if the receiver is in the same room to avoid feedback.</p>}
      </div>
    );
  }
  return (
    <form className="link-send" onSubmit={(e) => { e.preventDefault(); if (valid) void join(valid, { name: s.linkName, quality: s.linkQuality, lowLatency: s.linkLowLatency, voice: s.linkVoice, deviceId: s.micDeviceId || undefined }); }}>
      <p>Use this device as a <strong>wireless microphone</strong> for another phone, tablet or computer running Vipad Link.</p>
      <label className="field">
        <span className="field-label">Connection code</span>
        <input className="text-input link-code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC-123" maxLength={8} autoCapitalize="characters" autoComplete="off" spellCheck={false} data-testid="link-join-code" />
      </label>
      <label className="field">
        <span className="field-label">Your name (shown to the receiver)</span>
        <input className="text-input" value={s.linkName} onChange={(e) => s.set({ linkName: e.target.value.slice(0, 40) })} placeholder={platform === 'ios' || platform === 'android' ? 'My phone' : 'My computer'} data-testid="link-name" />
      </label>
      <div className="field">
        <span className="field-label" id="lq-label">Quality</span>
        <div className="segmented" role="radiogroup" aria-labelledby="lq-label">
          {(Object.keys(QUALITY) as Quality[]).map((q) => (
            <button type="button" key={q} role="radio" aria-checked={s.linkQuality === q} className={s.linkQuality === q ? 'on' : ''} onClick={() => s.set({ linkQuality: q })}>{QUALITY[q].label}</button>
          ))}
        </div>
        <small className="field-hint">{QUALITY[s.linkQuality].desc}</small>
      </div>
      <label className="set-toggle">
        <span><strong>Lowest latency</strong><small>10 ms packets and a minimal buffer. Turn off on a poor connection for fewer dropouts.</small></span>
        <input type="checkbox" role="switch" checked={s.linkLowLatency} onChange={(e) => s.set({ linkLowLatency: e.target.checked })} />
      </label>
      <label className="set-toggle">
        <span><strong>Voice processing</strong><small>Echo cancellation, noise suppression and auto-gain. Best for calls; turn off for music.</small></span>
        <input type="checkbox" role="switch" checked={s.linkVoice} onChange={(e) => s.set({ linkVoice: e.target.checked })} />
      </label>
      <p className="muted">Microphone: {s.micLabel || 'System default'} (change it in Settings).</p>
      {error && <p className="alert" role="alert" data-testid="link-error">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={!valid} data-testid="link-join"><Wifi size={16} /> Connect and send</button>
    </form>
  );
}

// ---------------------------------------------------------------- VBAN
function VbanTab() {
  const v = useVban();
  const port = useSettings((s) => s.vbanPort);
  if (!linkBridge()) {
    return (
      <div className="link-help">
        <strong>VBAN (Voicemeeter) needs the Vipad desktop app</strong>
        <p>Browsers can’t send raw network audio. Install Vipad for Windows, macOS or Linux to exchange audio with Voicemeeter, VBAN Receptor and VBAN Talkie on your network.</p>
        <a className="btn btn-secondary btn-sm" href="./download.html">Get the desktop app</a>
      </div>
    );
  }
  return (
    <div className="link-vban">
      <p>Exchange audio with <strong>Voicemeeter</strong>, VBAN Receptor and VBAN Talkie over your local network (uncompressed PCM, UDP port {port}).</p>
      <h3 className="link-h">Send to VBAN</h3>
      <label className="field">
        <span className="field-label">Destination IP address</span>
        <input className="text-input" value={v.host} disabled={v.sending} onChange={(e) => v.setOpts({ host: e.target.value })} placeholder="192.168.1.20" data-testid="vban-host" />
      </label>
      <div className="link-row2">
        <label className="field">
          <span className="field-label">Stream name</span>
          <input className="text-input" value={v.streamName} disabled={v.sending} maxLength={16} onChange={(e) => v.setOpts({ streamName: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Source</span>
          <select value={v.sendSource} disabled={v.sending} onChange={(e) => v.setOpts({ sendSource: e.target.value as 'mic' | 'link' })}>
            <option value="mic">My microphone</option>
            <option value="link">Vipad Link guests</option>
          </select>
        </label>
      </div>
      {v.sending ? <button className="btn btn-ghost btn-sm" onClick={() => void v.stopSend()}>Stop sending</button> : <button className="btn btn-primary btn-sm" onClick={() => void v.startSend()} data-testid="vban-send"><Volume2 size={14} /> Start sending</button>}
      <h3 className="link-h">Receive from VBAN</h3>
      <label className="field">
        <span className="field-label">Only this stream name (optional)</span>
        <input className="text-input" value={v.rxStream} disabled={v.receiving} maxLength={16} onChange={(e) => v.setOpts({ rxStream: e.target.value })} placeholder="Any stream" />
      </label>
      {v.receiving && <p className="muted">{v.rxFrom ? <>Receiving <strong>{v.rxFrom}</strong> · {v.rxFormat}</> : `Listening on UDP port ${port}…`} — it plays into the Vipad Link output on the Receive tab.</p>}
      {v.receiving ? <button className="btn btn-ghost btn-sm" onClick={() => void v.stopReceive()}>Stop receiving</button> : <button className="btn btn-primary btn-sm" onClick={() => void v.startReceive()} data-testid="vban-receive"><Headphones size={14} /> Start receiving</button>}
      {v.error && <p className="alert" role="alert">{v.error}</p>}
    </div>
  );
}

export function LinkDialog({ tab: initialTab, code }: { tab?: 'receive' | 'send'; code?: string }) {
  const role = useLink((s) => s.role);
  const [tab, setTab] = useState<Tab>(initialTab ?? (role === 'guest' ? 'send' : 'receive'));
  const close = () => useEditor.getState().setDialog(null);
  return (
    <Modal title="Vipad Link" subtitle="Send audio between devices and use it as a microphone." onClose={close} wide icon={<Radio size={18} />} footer={<><span className="muted link-foot">Audio goes device-to-device, encrypted. It keeps running when you close this panel.</span><span className="spacer" /><button className="btn btn-primary" onClick={close}>Done</button></>}>
      <div className="segmented link-tabs" role="tablist">
        {([['receive', 'Receive'], ['send', 'Send'], ['vban', 'VBAN']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`link-tab-${id}`}>{label}</button>
        ))}
      </div>
      {tab === 'receive' && <ReceiveTab />}
      {tab === 'send' && <SendTab initialCode={code} />}
      {tab === 'vban' && <VbanTab />}
    </Modal>
  );
}

/** Top-bar indicator while Vipad Link is running. */
export function LinkBadge() {
  const { role, guests, sendStatus, sendLevel } = useLink();
  if (role === 'idle') return null;
  const live = role === 'host' ? guests.filter((g) => g.status === 'connected').length : sendStatus === 'connected' ? 1 : 0;
  const label = role === 'host' ? `${live} in` : sendStatus === 'connected' ? 'LIVE' : '…';
  return (
    <button className={`link-badge ${live ? 'live' : ''}`} onClick={() => useEditor.getState().setDialog({ type: 'link' })} title="Vipad Link" data-testid="link-badge">
      <Radio size={14} /> <span>{label}</span>
      {role === 'guest' && <Level v={sendLevel} />}
    </button>
  );
}
