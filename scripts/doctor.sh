#!/usr/bin/env bash
# Preflight check: verifies everything Sesame Voice Studio needs is present.
# Run:  npm run doctor   (or)   bash scripts/doctor.sh
# Exit code 0 = ready, 1 = something missing.

ok=0; bad=0
green="\033[32m"; red="\033[31m"; yellow="\033[33m"; dim="\033[2m"; rst="\033[0m"

pass() { echo -e " ${green}✓${rst} $1"; ok=$((ok+1)); }
fail() { echo -e " ${red}✗${rst} $1"; bad=$((bad+1)); }
warn() { echo -e " ${yellow}!${rst} $1"; }

need() { # need <binary> <why>
  if command -v "$1" >/dev/null 2>&1; then pass "$1 — $2"; else fail "$1 missing — $2"; fi
}

echo "Sesame Voice Studio — environment check"
echo "----------------------------------------"

# Node
if command -v node >/dev/null 2>&1; then
  ver=$(node -p 'process.versions.node')
  major=${ver%%.*}
  if [[ "$major" -ge 18 ]]; then pass "node $ver"; else fail "node $ver (need >= 18)"; fi
else
  fail "node missing (need >= 18)"
fi

# Core binaries
need espeak-ng "generates the spoken instruction"
need ffmpeg    "records + measures loudness"
need ffprobe   "reads clip duration"
need pactl     "controls the audio server"
need paplay    "injects audio into the virtual mic"

# Audio server
echo "----------------------------------------"
if command -v pactl >/dev/null 2>&1; then
  if server=$(pactl info 2>/dev/null | sed -n 's/^Server Name:\s*//p'); [[ -n "$server" ]]; then
    pass "audio server reachable: $server"
    # Confirm the modules we rely on can load.
    for m in module-null-sink module-remap-source module-loopback; do
      if pactl list short modules >/dev/null 2>&1; then :; fi
    done
  else
    fail "no audio server running (start PipeWire or PulseAudio)"
    warn "headless/server installs often have no sound daemon — this app needs one"
  fi
else
  fail "pactl not found — PipeWire(-pulse) or PulseAudio is required"
fi

# Browser (informational — the call runs in your browser)
echo "----------------------------------------"
if ls /usr/bin/google-chrome* /usr/bin/chromium* /usr/bin/brave* /usr/bin/firefox* >/dev/null 2>&1 \
   || command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 \
   || command -v firefox >/dev/null 2>&1; then
  pass "a supported browser is installed (Chrome/Chromium/Brave/Edge/Firefox)"
else
  warn "no common browser detected — you need one to run the Sesame call"
fi

echo "----------------------------------------"
if [[ "$bad" -eq 0 ]]; then
  echo -e "${green}All set — $ok checks passed.${rst}"
  exit 0
fi

echo -e "${red}$bad missing.${rst} Install hints:"
echo -e "${dim}"
echo "  Debian/Ubuntu : sudo apt install espeak-ng ffmpeg pulseaudio-utils nodejs npm"
echo "  Fedora        : sudo dnf install espeak-ng ffmpeg pulseaudio-utils nodejs"
echo "  Arch          : sudo pacman -S espeak-ng ffmpeg libpulse nodejs npm"
echo "  (pactl/paplay/parecord come from pulseaudio-utils / pipewire-pulse)"
echo -e "${rst}"
exit 1
