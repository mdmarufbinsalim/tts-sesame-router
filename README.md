<div align="center">

# 🎙️ Sesame Voice Studio

**Turn the hosted [Sesame](https://app.sesame.com) voice into an offline-style TTS engine — on Linux, no GPU.**

Type a paragraph → a tiny local voice whispers it as an instruction into a **virtual microphone** → the Sesame call repeats it in its natural voice → the app records the reply as a downloadable clip.

![platform](https://img.shields.io/badge/platform-Linux-1e1f22?logo=linux&logoColor=white)
![stack](https://img.shields.io/badge/stack-React%20%2B%20Express-5865f2)
![audio](https://img.shields.io/badge/audio-PipeWire%20%2F%20PulseAudio-23a55a)
![gpu](https://img.shields.io/badge/GPU-not%20required-555)

</div>

---

## Why this exists

`app.sesame.com` is a *voice conversation* demo, not a TTS box — there's no "read this text" field, only a microphone. Sesame Voice Studio bridges that gap: it speaks your text **to** Sesame through a virtual mic and captures what comes **back**, giving you scripted, repeatable voiceover from a model that has no public TTS API.

```
 React UI ──HTTP/WS──▶ Node / Express ──▶ espeak-ng ─▶ 🎤 virtual mic ─▶ Sesame call
 (your text,             (job engine)                                        │ speaks
  clip library)                                                              ▼
        ▲                                                          🔊 browser audio
        └──────────── clip ◀── trim ◀── ffmpeg records ◀── capture sink ◀────┘
```

## Features

- 🗨️ **Discord-style two-pane UI** — the embedded Sesame call on the left (collapsible to a rail; the call survives collapse), a channel-style chat on the right.
- 🌙 **Embedded Sesame** with a dark-mode filter on by default.
- 🔤 **Live word karaoke** — watch each word highlight as it's transmitted to Sesame (timed from the instruction audio).
- 📊 **Audio-reactive visualizer** — real loudness streamed from the recording (`ebur128`) drives a Discord-green equalizer while Sesame speaks.
- 🎭 **Delivery presets** — a persistent "system prompt" (excited, calm, whisper, sad…) spoken before your text to shape tone.
- ⏹️ **Manual-stop recording** — you decide when the clip ends; a 10-minute cap guards runaways.
- 📚 **Clip library** — every take is saved, playable inline, downloadable, and deletable.
- 📱 **Responsive** down to mobile, with reduced-motion support.
- 🧩 **Self-contained audio driver** — pure-JS `pactl` control, no shell scripts, behind a platform seam ready for a future Windows port.

## Requirements

- Linux with a running sound server: **PipeWire** (pipewire-pulse) or **PulseAudio**
- `espeak-ng`, `pulseaudio-utils` (`pactl` / `paplay`), `ffmpeg` (+ `ffprobe`)
- **Node 18+**
- A browser tab on https://app.sesame.com (Chrome / Chromium / Brave / Edge / Vivaldi / Opera / Firefox)

> [!NOTE]
> It won't run where there's no audio server (bare-ALSA or headless installs with no PipeWire/PulseAudio daemon) — the whole pipeline routes through `pactl`.

Check your machine in one command:

```bash
npm run doctor
```

<details>
<summary>Install dependencies by distro</summary>

```bash
# Debian / Ubuntu
sudo apt install espeak-ng ffmpeg pulseaudio-utils nodejs npm
# Fedora
sudo dnf install espeak-ng ffmpeg pulseaudio-utils nodejs
# Arch
sudo pacman -S espeak-ng ffmpeg libpulse nodejs npm
```
</details>

## Quick start

```bash
npm run doctor        # verify the environment
npm run install:all   # install server + web dependencies
npm run dev           # API on :3001, UI on :5173
```

Open **http://localhost:5173**.

For a single-process build:

```bash
npm run build         # bundle the UI into web/dist
npm start             # Express serves UI + API on :3001
```

## Using it

1. In the **Sesame panel** (left), start a call with Maya or Miles.
2. Set the call's **microphone to `VirtualMicrophone`** (the app makes it the system default, so it's usually pre-selected).
3. Click **Enable mic routing** — the status dots turn green when devices are up, the virtual mic is active, and the browser's audio is being captured.
4. Type a paragraph in the composer, optionally pick a **🎭 delivery** tone, and hit **Speak**.
5. Watch the karaoke as it transmits, then the visualizer as Sesame replies. Press **Stop** when it finishes — the clip lands in the chat, ready to play or download.

> **Raw mode** plays your words verbatim into the mic (no "read this aloud" wrapper) — handy for short, exact phrases.

## Architecture

| Path | Role |
|---|---|
| `web/` | Vite + React UI — chat, karaoke, visualizer, delivery panel, embedded Sesame |
| `server/index.js` | Express API + WebSocket progress + clip library |
| `server/pipeline.js` | text → espeak instruction → inject → record (with live loudness) → trim |
| `server/audio/linux.js` | Linux driver: virtual mic + capture sink + routing via `pactl` |
| `server/audio/windows.js` | documented stub — the seam for a future Windows (VB-CABLE) port |
| `server/audio/index.js` | picks the driver for the host OS |
| `scripts/doctor.sh` | `npm run doctor` environment preflight |

The layers above the audio driver never touch OS-specific code — porting to another platform means writing one `server/audio/<platform>.js`.

## Tuning

- **Recording length** — stops only on **Stop**; the runaway cap is `MAX_RECORD_MS` in `server/pipeline.js`.
- **Speaking detection / loudness** — `SILENCE_NOISE` in `server/pipeline.js` controls the visualizer's "speaking" threshold.
- **Default mic** — the app makes the virtual mic the default input while running and restores your real mic on teardown (**Reset devices**, or the `teardown` endpoint).

## Disclaimer

For personal use. This automates audio you play in your own browser; bulk-producing published content from a hosted demo may run against its terms — use responsibly.
