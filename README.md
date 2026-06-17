# Sesame Voice Studio

A ChatGPT-style web app that drives the hosted Sesame voice (app.sesame.com) as a
TTS engine on Linux — no GPU required. You type a paragraph; a small local voice
(espeak-ng) speaks an instruction into a **virtual microphone** that the Sesame
call hears; the app records Sesame's spoken reply from a **capture sink** and
saves it as a downloadable clip.

```
React UI ──HTTP/WS──▶ Node/Express ──▶ espeak-ng / paplay / parecord / ffmpeg / pactl
(type text,            (job engine)       (PipeWire virtual-mic pipeline)
 clip library)
```

## Requirements

- Linux with a running sound server: **PipeWire** (pipewire-pulse) or **PulseAudio**
- `espeak-ng`, `pulseaudio-utils` (`pactl`/`paplay`), `ffmpeg` (+ `ffprobe`)
- Node 18+
- A browser tab on https://app.sesame.com (Chrome/Chromium/Brave/Edge/Vivaldi/Opera/Firefox)

### Will it run on my Linux box?

Run the preflight — it checks every dependency and prints install hints:

```bash
npm run doctor
```

It runs on most desktop distros. It will **not** work where there's no audio
server (bare-ALSA or headless installs with no PipeWire/PulseAudio daemon), since
the whole pipeline routes through `pactl`. Install hints by distro:

```
Debian/Ubuntu : sudo apt install espeak-ng ffmpeg pulseaudio-utils nodejs npm
Fedora        : sudo dnf install espeak-ng ffmpeg pulseaudio-utils nodejs
Arch          : sudo pacman -S espeak-ng ffmpeg libpulse nodejs npm
```

The code avoids machine-specific assumptions: device IDs are resolved at runtime,
`pactl get-default-*` falls back to parsing `pactl info` on older PulseAudio, and
browser-audio matching covers all common Chromium forks + Firefox.

## Install

```bash
npm run doctor        # verify dependencies first
npm run install:all   # installs server + web deps
```

## Run (dev)

```bash
npm run dev           # server on :3001, Vite UI on :5173
```

Open http://localhost:5173.

## Run (production-ish)

```bash
npm run build         # builds web/dist
npm start             # server serves the UI + API on :3001
```

## One-time browser setup per Sesame call

1. Open https://app.sesame.com and start a call.
2. Set the page's **microphone** to **VirtualMicrophone**
   (the app sets it as the system default source, so usually it's automatic).
3. Leave the tab playing — the app routes its audio into the capture sink itself.

## How it works

- `server/audio/` — the audio driver, selected by platform:
  - `linux.js` — creates the virtual mic + capture sink directly with `pactl`
    (idempotent), routes browser audio, injects, reports status. **No shell scripts.**
  - `windows.js` — stub documenting the seam for a future Windows port (VB-CABLE).
  - `index.js` — picks the driver for the host OS.
- `server/pipeline.js` — generate instruction → inject → record until you press
  **Stop** (manual only; a 10-min hard cap guards runaways) → trim leading silence.
- `server/index.js` — Express API + WebSocket progress + clip library.
- `web/` — Vite + React UI.

## Notes / tuning

- Recording stops only when you press **Stop**. The `MAX_RECORD_MS` cap in
  `server/pipeline.js` is just a runaway safety (default 10 min).
- The app makes the virtual mic the default input while running and restores your
  real mic on teardown (the **Reset devices** button, or the `teardown` endpoint).
