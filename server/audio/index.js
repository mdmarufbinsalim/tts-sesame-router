// Audio driver selector. Picks the implementation for the host platform so the
// rest of the app (jobs, WS, UI) never touches OS-specific audio code.
import * as linux from './linux.js';
import * as windows from './windows.js';

const DRIVERS = { linux, win32: windows };

const driver = DRIVERS[process.platform];
if (!driver) {
  throw new Error(
    `No audio driver for platform "${process.platform}". Supported: linux. ` +
    `(macOS/Windows would need their own server/audio/<platform>.js.)`
  );
}

export const ensureDevices = (...a) => driver.ensureDevices(...a);
export const resetDevices = (...a) => driver.resetDevices(...a);
export const teardownDevices = (...a) => driver.teardownDevices(...a);
export const routeBrowserOutput = (...a) => driver.routeBrowserOutput(...a);
export const getStatus = (...a) => driver.getStatus(...a);
export const captureInputArgs = (...a) => driver.captureInputArgs(...a);
export const inject = (...a) => driver.inject(...a);
