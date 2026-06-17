// Windows audio driver — NOT IMPLEMENTED.
//
// This file documents the seam for a future Windows port. To implement it,
// export the same surface as linux.js, backed by Windows tooling:
//
//   ensureDevices()      Require a virtual cable (e.g. VB-Audio VB-CABLE) to be
//                        installed; verify "CABLE Input"/"CABLE Output" exist.
//   teardownDevices()    Restore the previous default mic.
//   resetDevices()       teardown + ensure.
//   routeBrowserOutput() Point the browser's audio at "CABLE Input" — e.g. via
//                        NirSoft svcl.exe (/SetAppDefault ... chrome.exe).
//   getStatus()          Report device + routing state.
//   captureInputArgs()   ['-f','dshow','-i','audio=CABLE Output (VB-Audio Virtual Cable)']
//   inject(file)         Play the wav to "CABLE Input" (needs a device-targeting
//                        player; ffmpeg can't select an output device on Windows).
//
// Until then, every call throws with guidance.
const NOT_IMPL =
  'Windows is not supported yet. Run on Linux (PipeWire/PulseAudio), or implement ' +
  'server/audio/windows.js using VB-CABLE + ffmpeg dshow. See the file header.';

function unsupported() { throw new Error(NOT_IMPL); }

export const ensureDevices = unsupported;
export const teardownDevices = unsupported;
export const resetDevices = unsupported;
export const routeBrowserOutput = unsupported;
export const getStatus = unsupported;
export const captureInputArgs = unsupported;
export const inject = unsupported;
