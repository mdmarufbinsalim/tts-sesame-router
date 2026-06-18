// The generation pipeline: text -> espeak instruction -> inject into virtual mic
// -> record Sesame's reply from the capture sink until the user presses Stop.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureDevices, routeBrowserOutput, captureInputArgs, inject } from './audio/index.js';

const execFileP = promisify(execFile);

// Recording stops only on manual Stop. The silence threshold below is used
// ONLY to light up the "speaking" indicator — it never stops the recording.
const SILENCE_NOISE = '-40dB';
const MAX_RECORD_MS = 600_000; // 10-min runaway safety cap only

const VERBATIM =
  'Read ONLY the following text. Do not add, omit, or continue beyond the final period.';

// Build the spoken instruction file with espeak-ng. Mirrors the prompt format
// that works best with Sesame:
//
//   Read ONLY the following text. Do not add, omit, or continue beyond the final period.
//
//   Voice: <delivery description>.
//
//   "<the text>"
//
//  - raw: play the user's words verbatim into the mic, no wrapper at all.
//  - systemPrompt: the delivery/voice description (becomes the "Voice:" line).
async function makeInstruction(text, raw, systemPrompt, file) {
  let phrase;
  if (raw) {
    phrase = text;
  } else {
    const delivery = (systemPrompt || '').trim().replace(/[.\s]*$/, '');
    const lines = [VERBATIM];
    if (delivery) lines.push(`Voice: ${delivery}.`);
    lines.push(`"${text.trim()}"`);
    phrase = lines.join('\n\n');
  }
  await execFileP('espeak-ng', ['-v', 'en-us', '-s', '150', '-w', file, phrase]);
  const st = await fs.stat(file);
  if (st.size < 1024) throw new Error('instruction audio failed to generate');
  return phrase;
}

// ffprobe a wav's duration in seconds.
async function probeDuration(file) {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

// Estimate a karaoke schedule: distribute the audio duration across words,
// weighted by word length (longer words take longer to say).
function buildSchedule(phrase, durationSec) {
  const words = phrase.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => Math.max(2, w.replace(/[^\w]/g, '').length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const ms = durationSec * 1000;
  let acc = 0;
  return words.map((w, i) => {
    const t0 = (acc / total) * ms;
    acc += weights[i];
    const t1 = (acc / total) * ms;
    return { w, t0: Math.round(t0), t1: Math.round(t1) };
  });
}

// Map ebur128 momentary loudness (LUFS) to a 0..1 level for the visualizer.
function lufsToLevel(lufs) {
  const lo = -50, hi = -14;
  return Math.max(0, Math.min(1, (lufs - lo) / (hi - lo)));
}

/**
 * Run one generation job.
 * @param {object} opts
 * @param {string} opts.text
 * @param {boolean} opts.raw
 * @param {string} [opts.systemPrompt]  delivery/emotion directive
 * @param {string} opts.clipPath  destination wav
 * @param {string} opts.tmpDir
 * @param {(stage:string, extra?:object)=>void} opts.emit  progress callback
 * @param {(level:number)=>void} opts.onLevel  live loudness 0..1
 * @param {(stop:()=>void)=>void} opts.registerStopper  hand back a manual-stop fn
 * @returns {Promise<{durationSec:number}>}
 */
export async function runJob({ text, raw, systemPrompt, clipPath, tmpDir, emit, onLevel, registerStopper }) {
  emit('ensuring-devices');
  await ensureDevices();

  emit('routing');
  const moved = await routeBrowserOutput();
  if (moved === 0) {
    throw new Error('No browser audio stream found. Open the Sesame call tab and start a conversation.');
  }

  emit('generating-instruction');
  const instr = path.join(tmpDir, 'instruction.wav');
  const phrase = await makeInstruction(text, raw, systemPrompt, instr);
  const instrDur = await probeDuration(instr);
  const schedule = buildSchedule(phrase, instrDur);

  await recordUntilStop({ clipPath, instr, schedule, totalMs: instrDur * 1000, emit, onLevel, registerStopper });

  emit('finalizing');
  const trimmed = await trimLeadingSilence(clipPath, tmpDir);
  return { durationSec: trimmed };
}

// Two phases:
//   1) TRANSMIT — play the whole instruction into the virtual mic. Nothing is
//      recorded yet, so anything Maya/Mike says during this window is ignored.
//   2) RECORD   — only after the instruction finishes, start ffmpeg and capture
//      the reply until the user presses Stop. ffmpeg also streams live loudness
//      (ebur128) for the visualizer and silence for the "speaking" cue.
function recordUntilStop({ clipPath, instr, schedule, totalMs, emit, onLevel, registerStopper }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let aborted = false;
    let ff = null;
    let capTimer = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(capTimer);
      if (err) reject(err); else resolve({});
    };

    // --- Phase 1: transmit the instruction (no recording yet) ---
    emit('transmitting', { schedule, totalMs });
    // While transmitting, Stop aborts playback before any recording starts.
    const ac = new AbortController();
    registerStopper(() => { aborted = true; ac.abort(); });

    inject(instr, { signal: ac.signal })
      .then(() => {
        if (aborted) return finish(new Error('Cancelled before recording started.'));
        startRecording();
      })
      .catch((e) => finish(aborted ? new Error('Cancelled before recording started.') : e));

    // --- Phase 2: record the reply ---
    function startRecording() {
      emit('listening', { note: 'recording reply — press Stop when finished' });

      // verbose loglevel is required for ebur128 per-frame "M:" loudness lines.
      ff = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'verbose',
        ...captureInputArgs(),
        '-af', `silencedetect=noise=${SILENCE_NOISE}:d=0.6,ebur128=metadata=1:framelog=verbose`,
        '-y', clipPath,
      ]);

      // Manual stop: send 'q' so ffmpeg finalizes the wav header cleanly.
      const stop = () => {
        try { ff.stdin.write('q'); } catch {}
        setTimeout(() => { try { ff.kill('SIGINT'); } catch {} }, 500);
      };
      registerStopper(stop); // replaces the transmit-phase aborter

      // Runaway safety only — not the normal way to stop.
      capTimer = setTimeout(() => { emit('listening', { note: 'max length reached' }); stop(); }, MAX_RECORD_MS);

      let speechStarted = false;
      let lastLevel = 0;
      let buffered = '';
      ff.stderr.on('data', (buf) => {
        buffered += buf.toString();
        const lines = buffered.split('\n');
        buffered = lines.pop(); // keep partial line
        for (const line of lines) {
          if (line.includes('silence_end') && !speechStarted) {
            speechStarted = true;
            emit('speaking');
          }
          const m = line.match(/M:\s*(-?\d+(?:\.\d+)?)/);
          if (m) {
            const level = lufsToLevel(parseFloat(m[1]));
            if (Math.abs(level - lastLevel) > 0.02 || level === 0) {
              lastLevel = level;
              onLevel(level);
            }
          }
        }
      });

      ff.on('error', (e) => finish(e));
      ff.on('close', () => { onLevel(0); finish(); });
    }
  });
}

// Trim leading silence so the clip starts at Maya's first word; return duration.
async function trimLeadingSilence(clipPath, tmpDir) {
  const tmp = path.join(tmpDir, 'trimmed.wav');
  try {
    await execFileP('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', clipPath,
      '-af', 'silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB',
      tmp,
    ]);
    await fs.rename(tmp, clipPath);
  } catch {
    // non-fatal: keep the untrimmed clip
  }
  // probe duration
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', clipPath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}
