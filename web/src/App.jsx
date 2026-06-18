import React, { useEffect, useRef, useState, useCallback } from 'react';
import Karaoke from './Karaoke.jsx';
import Visualizer from './Visualizer.jsx';

// Friendly labels for each backend stage.
const STAGE_LABELS = {
  queued: 'Queued',
  'ensuring-devices': 'Preparing audio devices',
  routing: 'Routing browser audio',
  'generating-instruction': 'Generating instruction',
  transmitting: 'Transmitting to Sesame',
  listening: 'Listening for reply',
  speaking: 'Sesame is speaking',
  finalizing: 'Finalizing clip',
  done: 'Done',
  error: 'Error',
};
const SPINNER_STAGES = new Set([
  'queued', 'ensuring-devices', 'routing', 'generating-instruction', 'finalizing',
]);
const REPLY_STAGES = new Set(['listening', 'speaking']);

// Quick delivery presets — fill the "Voice:" description. Detailed descriptions
// (persona + tone + pace + emphasis) work best with Sesame.
const PRESETS = [
  ['📺 News anchor', 'Professional TV news anchor. Calm, clear, natural pace, with brief pauses at punctuation'],
  ['🔥 YouTuber', 'Energetic YouTuber. Excited, expressive, and engaging. Fast but clear pace, with emphasis on exciting words and dramatic pauses for suspense'],
  ['📖 Narrator', 'Warm audiobook narrator. Gentle, unhurried, and soothing, with soft emphasis and natural pauses'],
  ['🤫 Whisper', 'Soft whisper. Intimate and breathy, very quiet, slow and gentle'],
  ['🎬 Trailer', 'Dramatic movie-trailer voice. Deep, intense, and suspenseful, with big dramatic pauses'],
  ['😢 Somber', 'Sad and somber. Slow, low, and melancholic, with heavy pauses'],
  ['😏 Deadpan', 'Dry and sarcastic. Flat, deadpan delivery with subtle smirking emphasis'],
  ['🧘 Calm', 'Calm and reassuring. Slow, soft, and steady, like a meditation guide'],
];
const SYS_KEY = 'sesame.systemPrompt';

function useWebSocket(onMessage) {
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onmessage = (e) => onMessage(JSON.parse(e.data));
      ws.onclose = () => { if (!closed) setTimeout(connect, 1000); };
    };
    connect();
    return () => { closed = true; ws && ws.close(); };
  }, [onMessage]);
}

// Left panel: the embedded Sesame call + audio-routing controls. The iframe is
// ALWAYS mounted (even when collapsed) so the live call is never dropped.
function Sesame({ status, minimized, onToggle, onReset, resetting, dark, onToggleDark }) {
  const rows = [
    { label: 'Devices ready', good: status?.devicesUp },
    { label: 'Virtual mic active', good: status?.micIsVirtual },
    {
      label: status?.browserRouted ? 'Audio captured' : 'Audio not routed',
      good: status?.browserRouted,
      warn: status?.browserPresent && !status?.browserRouted,
    },
  ];
  const allGood = status?.devicesUp && status?.micIsVirtual;
  return (
    <aside className={`sesame ${minimized ? 'mini' : ''}`}>
      <button className="sb-toggle" onClick={onToggle} title={minimized ? 'Expand Sesame' : 'Collapse Sesame'}>
        {minimized ? '›' : '‹'}
      </button>
      {minimized && <div className="sb-rail"><span className={`rail-dot ${allGood ? 'good' : 'warn'}`} />SESAME</div>}

      <div className="sb-inner">
        <div className="sb-head">
          <span className="sb-logo">◆</span>
          <span className="sb-title">Sesame</span>
          <button
            className={`sb-dark ${dark ? 'on' : ''}`}
            onClick={onToggleDark}
            title={dark ? 'Dark filter on (color-inverted)' : 'Force dark (color-invert filter)'}
          >{dark ? '🌙' : '☀'}</button>
          <a className="sb-pop" href="https://app.sesame.com" target="_blank" rel="noreferrer" title="Open in new tab">↗</a>
        </div>

        <div className="routing">
          <div className="routing-rows">
            {rows.map((r) => (
              <div key={r.label} className="routing-row">
                <span className={`rdot ${r.good ? 'good' : r.warn ? 'warn' : 'off'}`} />
                {r.label}
              </div>
            ))}
          </div>
          <button className="route-btn" onClick={onReset} disabled={resetting}>
            {resetting ? 'Routing…' : 'Enable mic routing'}
          </button>
          <p className="routing-hint">Set the call’s microphone to <b>VirtualMicrophone</b>.</p>
        </div>

        <div className={`sb-frame ${dark ? 'dark' : ''}`}>
          <iframe
            title="Sesame"
            src="https://app.sesame.com"
            style={{ colorScheme: 'dark' }}
            allow="microphone; autoplay; camera; clipboard-read; clipboard-write"
          />
        </div>
      </div>
    </aside>
  );
}

function Turn({ turn }) {
  const stageLabel = STAGE_LABELS[turn.stage] || turn.stage;
  const isSpinner = SPINNER_STAGES.has(turn.stage);
  const isReply = REPLY_STAGES.has(turn.stage);
  return (
    <div className="turn">
      <div className="msg">
        <div className="avatar you">You</div>
        <div className="msg-body">
          <div className="msg-name">You <span className="msg-meta">prompt</span></div>
          <div className="msg-text">{turn.text}</div>
          {turn.systemPrompt ? <div className="delivery-badge">🎭 Voice: {turn.systemPrompt}</div> : null}
        </div>
      </div>

      <div className="msg">
        <div className="avatar sesame">◆</div>
        <div className="msg-body">
          <div className="msg-name">Sesame <span className="msg-meta">voice</span></div>

          {isSpinner && (
            <div className="stage">
              <span className="spinner" />
              <span>{stageLabel}{turn.note ? ` — ${turn.note}` : ''}</span>
            </div>
          )}

          {turn.stage === 'transmitting' && turn.schedule && (
            <div className="reply">
              <Karaoke schedule={turn.schedule} />
              <button className="stopbtn" onClick={turn.onStop}>Stop</button>
            </div>
          )}

          {isReply && (
            <div className="reply">
              <div className="reply-head">
                <span className={`pulse ${turn.stage === 'speaking' ? 'on' : ''}`} />
                <span className="reply-label">{turn.stage === 'speaking' ? 'Speaking' : 'Listening for reply'}</span>
                <button className="stopbtn" onClick={turn.onStop}>Stop</button>
              </div>
              <Visualizer level={turn.level || 0} />
            </div>
          )}

          {turn.stage === 'error' && (
            <div className="error-box">
              <div className="stage err">⚠ {turn.message || 'Something went wrong'}</div>
              <div className="clip-actions">
                <button className="link danger" onClick={turn.onDelete}>Delete</button>
              </div>
            </div>
          )}

          {turn.stage === 'done' && (
            <div className="clip">
              <audio controls src={`/api/clips/${turn.id}/audio`} />
              <div className="clip-actions">
                {turn.durationSec ? <span className="dur">{turn.durationSec.toFixed(1)}s</span> : null}
                <a href={`/api/clips/${turn.id}/audio`} download={`sesame-${turn.id}.wav`}>Download</a>
                <button className="link danger" onClick={turn.onDelete}>Delete</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [raw, setRaw] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem(SYS_KEY) || '');
  const [showSys, setShowSys] = useState(false);
  const [minimized, setMinimized] = useState(() => localStorage.getItem('sesame.mini') === '1');
  const [darkEmbed, setDarkEmbed] = useState(() => localStorage.getItem('sesame.dark') !== '0');
  const scrollRef = useRef(null);
  const composerRef = useRef(null);

  // Auto-grow the composer with its content (ChatGPT-style), capped by CSS max-height.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => { localStorage.setItem('sesame.mini', minimized ? '1' : '0'); }, [minimized]);
  useEffect(() => { localStorage.setItem('sesame.dark', darkEmbed ? '1' : '0'); }, [darkEmbed]);
  useEffect(() => { localStorage.setItem(SYS_KEY, systemPrompt); }, [systemPrompt]);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await (await fetch('/api/status')).json()); } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const clips = await (await fetch('/api/clips')).json();
        setTurns(clips.slice().reverse().map((c) => ({
          id: c.id, text: c.text, durationSec: c.durationSec,
          systemPrompt: c.systemPrompt,
          stage: c.status === 'running' ? 'error' : c.status,
          message: c.error,
        })));
      } catch {}
    })();
    refreshStatus();
    const t = setInterval(refreshStatus, 4000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  const onMessage = useCallback((msg) => {
    if (msg.type === 'level') {
      setTurns((prev) => {
        const i = prev.findIndex((t) => t.id === msg.id);
        if (i === -1) return prev;
        const next = prev.slice();
        next[i] = { ...next[i], level: msg.level };
        return next;
      });
      return;
    }
    if (msg.type !== 'job') return;
    setTurns((prev) => {
      const i = prev.findIndex((t) => t.id === msg.id);
      const patch = {
        id: msg.id,
        text: msg.clip?.text ?? prev[i]?.text ?? '',
        systemPrompt: msg.clip?.systemPrompt ?? prev[i]?.systemPrompt,
        stage: msg.stage,
        note: msg.note,
        message: msg.message,
        schedule: msg.schedule ?? prev[i]?.schedule,
        durationSec: msg.clip?.durationSec ?? prev[i]?.durationSec ?? 0,
      };
      if (i === -1) return [...prev, patch];
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
    if (msg.stage === 'done' || msg.stage === 'error') { setBusy(false); refreshStatus(); }
  }, [refreshStatus]);
  useWebSocket(onMessage);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText('');
    try {
      await fetch('/api/say', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, raw, systemPrompt: raw ? '' : systemPrompt.trim() }),
      });
    } catch { setBusy(false); }
  };

  const stopJob = (id) => fetch(`/api/jobs/${id}/stop`, { method: 'POST' });
  const deleteClip = async (id) => {
    await fetch(`/api/clips/${id}`, { method: 'DELETE' });
    setTurns((prev) => prev.filter((t) => t.id !== id));
  };
  const resetDevices = async () => {
    setResetting(true);
    try { await fetch('/api/devices/reset', { method: 'POST' }); } finally { setResetting(false); refreshStatus(); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const enrichedTurns = turns.map((t) => ({
    ...t, onStop: () => stopJob(t.id), onDelete: () => deleteClip(t.id),
  }));
  const sysActive = systemPrompt.trim() && !raw;

  return (
    <div className="app">
      <Sesame
        status={status}
        minimized={minimized}
        onToggle={() => setMinimized((m) => !m)}
        onReset={resetDevices}
        resetting={resetting}
        dark={darkEmbed}
        onToggleDark={() => setDarkEmbed((d) => !d)}
      />

      <section className="main">
        <header className="channel">
          <span className="hash">#</span>
          <span className="ch-name">voiceover-studio</span>
          <span className="ch-divider" />
          <span className="ch-topic">Type a paragraph — Sesame speaks it back</span>
        </header>

        <div className="messages" ref={scrollRef}>
          {enrichedTurns.length === 0 && (
            <div className="empty">
              <div className="empty-mark">◆</div>
              <h2>Welcome to #voiceover-studio</h2>
              <p>Start a call in the Sesame panel, set its mic to <b>VirtualMicrophone</b>,
                 hit <b>Enable mic routing</b>, then send your first line below.</p>
            </div>
          )}
          {enrichedTurns.map((t) => <Turn key={t.id} turn={t} />)}
        </div>

        <div className="composer-wrap">
          {showSys && (
            <div className="sys-panel">
              <div className="presets">
                {PRESETS.map(([label, value]) => (
                  <button key={label} className="chip" onClick={() => setSystemPrompt(value)}>{label}</button>
                ))}
                {systemPrompt && <button className="chip clear" onClick={() => setSystemPrompt('')}>✕ Clear</button>}
              </div>
              <textarea
                className="sys-text"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Voice: describe the persona, tone, pace & emphasis — e.g. Energetic YouTuber. Excited and expressive, fast but clear, with dramatic pauses."
                rows={2}
              />
              {raw && <div className="sys-hint">Delivery is ignored in Raw mode.</div>}
            </div>
          )}

          <div className="composer">
            <button
              className={`compose-btn ${sysActive ? 'active' : ''}`}
              onClick={() => setShowSys((s) => !s)}
              title="Delivery & emotion"
            >🎭</button>
            <textarea
              ref={composerRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message Sesame…  (Enter to send · Shift+Enter for newline)"
              rows={1}
            />
            <button className="send" disabled={busy || !text.trim()} onClick={submit}>
              {busy ? '…' : 'Speak'}
            </button>
          </div>

          <div className="composer-foot">
            <label className="raw-toggle">
              <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
              Raw mode — play my words verbatim, no “repeat after me” wrapper
            </label>
            {sysActive && <span className="foot-sys">🎭 Delivery on</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
