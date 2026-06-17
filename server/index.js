import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runJob } from './pipeline.js';
import { getStatus, resetDevices, teardownDevices, ensureDevices } from './audio/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CLIPS_DIR = path.join(ROOT, 'clips');
const INDEX_FILE = path.join(CLIPS_DIR, 'index.json');
const PORT = process.env.PORT || 3001;

await fs.mkdir(CLIPS_DIR, { recursive: true });

// ---- clip index (persisted to clips/index.json) ----
async function loadIndex() {
  try { return JSON.parse(await fs.readFile(INDEX_FILE, 'utf8')); }
  catch { return []; }
}
async function saveIndex(list) {
  await fs.writeFile(INDEX_FILE, JSON.stringify(list, null, 2));
}
let clips = await loadIndex();

// ---- websocket broadcast ----
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(data);
  }
}

app.use(express.json());

// in-memory job registry: id -> { stopper }
const jobs = new Map();

// ---- API ----
app.get('/api/status', async (_req, res) => {
  try { res.json(await getStatus()); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/devices/:action', async (req, res) => {
  try {
    const { action } = req.params;
    if (action === 'setup') await ensureDevices();
    else if (action === 'reset') await resetDevices();
    else if (action === 'teardown') await teardownDevices();
    else return res.status(400).json({ error: 'unknown action' });
    res.json(await getStatus());
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/clips', (_req, res) => res.json(clips));

app.get('/api/clips/:id/audio', async (req, res) => {
  const clip = clips.find((c) => c.id === req.params.id);
  if (!clip) return res.status(404).end();
  res.sendFile(path.join(CLIPS_DIR, `${clip.id}.wav`));
});

app.delete('/api/clips/:id', async (req, res) => {
  const idx = clips.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).end();
  const [clip] = clips.splice(idx, 1);
  await saveIndex(clips);
  await fs.unlink(path.join(CLIPS_DIR, `${clip.id}.wav`)).catch(() => {});
  res.json({ ok: true });
});

// Manual stop override.
app.post('/api/jobs/:id/stop', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'no such active job' });
  job.stopper?.();
  res.json({ ok: true });
});

// Kick off a generation.
app.post('/api/say', async (req, res) => {
  const text = (req.body?.text || '').trim();
  const raw = !!req.body?.raw;
  const systemPrompt = (req.body?.systemPrompt || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  const id = randomUUID();
  const clipPath = path.join(CLIPS_DIR, `${id}.wav`);
  const createdAt = new Date().toISOString();
  const clip = { id, text, raw, systemPrompt, createdAt, status: 'running', durationSec: 0 };
  clips.unshift(clip);
  await saveIndex(clips);

  // respond immediately; progress flows over WS
  res.json({ id });
  broadcast({ type: 'job', id, stage: 'queued', clip });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tts-'));
  jobs.set(id, { stopper: null });

  const emit = (stage, extra = {}) => broadcast({ type: 'job', id, stage, ...extra });
  const onLevel = (level) => broadcast({ type: 'level', id, level });
  const registerStopper = (fn) => { const j = jobs.get(id); if (j) j.stopper = fn; };

  try {
    const { durationSec } = await runJob({ text, raw, systemPrompt, clipPath, tmpDir, emit, onLevel, registerStopper });
    clip.status = 'done';
    clip.durationSec = durationSec;
    await saveIndex(clips);
    broadcast({ type: 'job', id, stage: 'done', clip });
  } catch (e) {
    clip.status = 'error';
    clip.error = String(e.message || e);
    await saveIndex(clips);
    broadcast({ type: 'job', id, stage: 'error', message: clip.error, clip });
  } finally {
    jobs.delete(id);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// Serve the built frontend in production (web/dist) if present.
const DIST = path.join(ROOT, 'web', 'dist');
app.use(express.static(DIST));
app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => { if (err) res.status(404).end(); });
});

server.listen(PORT, () => {
  console.log(`TTS server on http://localhost:${PORT}`);
});
