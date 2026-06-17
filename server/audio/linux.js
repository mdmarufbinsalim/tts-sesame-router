// Linux audio driver (PipeWire / PulseAudio via pactl).
// Self-contained: creates the virtual mic + capture sink directly with pactl —
// no external shell script required.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

// Persisted across restarts so we can restore the user's real mic on teardown.
const REAL_SRC_FILE = path.join(os.tmpdir(), '.virtmic_real_source');

// Browsers whose playback we capture (Chrome, Chromium, Brave, Edge, Vivaldi,
// Opera, Firefox, and most Chromium forks). Matched case-insensitively.
const BROWSER_RE = /application\.name = ".*(chrome|chromium|firefox|brave|edge|vivaldi|opera).*"/i;

async function pactl(args) {
  const { stdout } = await execFileP('pactl', args);
  return stdout;
}

async function hasSink(name) {
  return (await pactl(['list', 'short', 'sinks'])).split('\n').some((l) => l.split('\t')[1] === name);
}
async function hasSource(name) {
  return (await pactl(['list', 'short', 'sources'])).split('\n').some((l) => l.split('\t')[1] === name);
}

// `get-default-*` only exists on newer PulseAudio/PipeWire; fall back to `info`.
async function defaultSink() {
  try { return (await pactl(['get-default-sink'])).trim(); }
  catch { return ((await pactl(['info']).catch(() => '')).match(/Default Sink:\s*(.+)/)?.[1] || '').trim(); }
}
async function defaultSource() {
  try { return (await pactl(['get-default-source'])).trim(); }
  catch { return ((await pactl(['info']).catch(() => '')).match(/Default Source:\s*(.+)/)?.[1] || '').trim(); }
}

// Bring up the virtual devices. Idempotent — only creates what's missing.
export async function ensureDevices() {
  // Remember the real default mic once, before we hijack it.
  try { await fs.access(REAL_SRC_FILE); }
  catch {
    const real = await defaultSource().catch(() => '');
    if (real) await fs.writeFile(REAL_SRC_FILE, real).catch(() => {});
  }

  // 1. Virtual speaker that goes nowhere — we play the instruction INTO it.
  if (!(await hasSink('virtmic'))) {
    await pactl(['load-module', 'module-null-sink',
      'sink_name=virtmic', 'sink_properties=device.description=VirtualMic']);
  }
  // 2. Expose its monitor as a real microphone the browser can select.
  if (!(await hasSource('virtmic_src'))) {
    await pactl(['load-module', 'module-remap-source',
      'master=virtmic.monitor', 'source_name=virtmic_src',
      'source_properties=device.description=VirtualMicrophone']);
  }
  // 3. A dedicated sink to capture the browser's OUTPUT cleanly.
  if (!(await hasSink('capture'))) {
    await pactl(['load-module', 'module-null-sink',
      'sink_name=capture', 'sink_properties=device.description=CaptureSink']);
  }
  // 4. Loop capture -> real speakers so you still HEAR the reply. Add once.
  const modules = await pactl(['list', 'short', 'modules']);
  if (!modules.includes('source=capture.monitor')) {
    const sink = await defaultSink();
    await pactl(['load-module', 'module-loopback',
      'source=capture.monitor', `sink=${sink}`, 'latency_msec=50']);
  }
  // 5. Make the virtual mic the default so the browser captures from it.
  await pactl(['set-default-source', 'virtmic_src']);
}

// Unload our modules and restore the real mic.
export async function teardownDevices() {
  const lines = (await pactl(['list', 'short', 'modules'])).split('\n');
  for (const line of lines) {
    if (/virtmic|VirtualMic|capture|CaptureSink/.test(line)) {
      const id = line.split('\t')[0];
      if (id) await pactl(['unload-module', id]).catch(() => {});
    }
  }
  // Restore the saved real default source.
  try {
    const real = (await fs.readFile(REAL_SRC_FILE, 'utf8')).trim();
    if (real) await pactl(['set-default-source', real]).catch(() => {});
    await fs.unlink(REAL_SRC_FILE).catch(() => {});
  } catch {}
}

export async function resetDevices() {
  await teardownDevices().catch(() => {});
  await ensureDevices();
}

// Move every browser playback stream into the `capture` sink. Returns count moved.
export async function routeBrowserOutput() {
  const stdout = await pactl(['list', 'sink-inputs']);
  const ids = [];
  let id = null;
  for (const line of stdout.split('\n')) {
    const m = line.match(/Sink Input #(\d+)/);
    if (m) id = m[1];
    if (BROWSER_RE.test(line) && id) ids.push(id);
  }
  let moved = 0;
  for (const sinkInput of ids) {
    try { await pactl(['move-sink-input', sinkInput, 'capture']); moved++; } catch {}
  }
  return moved;
}

// Snapshot of routing state for the UI status bar.
export async function getStatus() {
  const [sinks, sources, defSrc, sinkInputs] = await Promise.all([
    pactl(['list', 'short', 'sinks']),
    pactl(['list', 'short', 'sources']),
    defaultSource(),
    pactl(['list', 'sink-inputs']),
  ]);

  const captureSinkId = (sinks.split('\n').find((l) => l.split('\t')[1] === 'capture') || '').split('\t')[0];
  let browserPresent = false, browserRouted = false, curSink = null;
  for (const line of sinkInputs.split('\n')) {
    const sm = line.match(/Sink: (\d+)/);
    if (sm) curSink = sm[1];
    if (BROWSER_RE.test(line)) {
      browserPresent = true;
      if (curSink === captureSinkId) browserRouted = true;
    }
  }

  return {
    devicesUp: /\bvirtmic\b/.test(sinks) && /\bcapture\b/.test(sinks) && /\bvirtmic_src\b/.test(sources),
    micIsVirtual: defSrc === 'virtmic_src',
    defaultSource: defSrc,
    browserPresent,
    browserRouted,
  };
}

// ffmpeg input arguments to read the captured browser audio.
export function captureInputArgs() {
  return ['-f', 'pulse', '-i', 'capture.monitor'];
}

// Inject a wav into the virtual mic; resolves when playback finishes.
export function inject(file) {
  return new Promise((resolve, reject) => {
    const pp = spawn('paplay', ['-d', 'virtmic', file]);
    pp.on('close', () => resolve());
    pp.on('error', reject);
  });
}
