// Linux: create a "Vipad Link" speaker whose output appears to every app as a "Vipad Link Microphone".
// Works with PulseAudio and PipeWire (pipewire-pulse), using pactl. Removed again when Vipad quits.
const { execFile } = require('node:child_process');

const SINK = 'vipad_link';
const SOURCE = 'vipad_mic';
const loaded = [];

function pactl(args) {
  return new Promise((resolve, reject) => {
    execFile('pactl', args, { timeout: 5000 }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim())));
  });
}

async function status() {
  if (process.platform !== 'linux') return { supported: false, active: false };
  try {
    const sinks = await pactl(['list', 'short', 'sinks']);
    const sources = await pactl(['list', 'short', 'sources']);
    return { supported: true, active: sinks.includes(SINK) && sources.includes(SOURCE) };
  } catch (e) {
    return { supported: false, active: false, error: `pactl is not available (${e.message}). Install pulseaudio-utils.` };
  }
}

async function create() {
  const s = await status();
  if (!s.supported) throw new Error(s.error || 'Virtual microphones can be created automatically on Linux only.');
  if (s.active) return { active: true };
  loaded.push(await pactl(['load-module', 'module-null-sink', `sink_name=${SINK}`, 'sink_properties=device.description="Vipad\\ Link"']));
  loaded.push(await pactl(['load-module', 'module-remap-source', `master=${SINK}.monitor`, `source_name=${SOURCE}`, 'source_properties=device.description="Vipad\\ Link\\ Microphone"']));
  return { active: true };
}

async function remove() {
  while (loaded.length) {
    const id = loaded.pop();
    await pactl(['unload-module', id]).catch(() => undefined);
  }
  return { active: false };
}

module.exports = { status, create, remove, SINK, SOURCE };
