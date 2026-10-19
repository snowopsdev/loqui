// Main → renderer requests belong to one webContents and document. A reply
// must match both sender and token; disposal, reload and timeout resolve fallback.
let tokens = 0;

function requestFromRenderer({
  ipcMain,
  webContents,
  channel,
  replyChannel,
  payload = {},
  timeoutMs,
  fallback = null,
}) {
  if (!webContents || webContents.isDestroyed()) return Promise.resolve(fallback);
  const token = ++tokens;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(replyChannel, listener);
      webContents.removeListener("destroyed", disposed);
      webContents.removeListener("render-process-gone", disposed);
      webContents.removeListener("did-start-navigation", navigation);
      clearTimeout(timer);
      resolve(value);
    };
    const listener = (event, replyToken, value) => {
      if (event.sender !== webContents || replyToken !== token) return;
      finish(value);
    };
    const disposed = () => finish(fallback);
    const navigation = (event, _url, isInPlace, isMainFrame) => {
      // Electron supports both positional and details-object navigation events.
      const mainFrame = event?.isMainFrame ?? isMainFrame;
      const sameDocument = event?.isSameDocument ?? isInPlace;
      if (mainFrame && !sameDocument) finish(fallback);
    };
    const timer = setTimeout(disposed, timeoutMs);
    ipcMain.on(replyChannel, listener);
    webContents.on("destroyed", disposed);
    webContents.on("render-process-gone", disposed);
    webContents.on("did-start-navigation", navigation);
    try {
      webContents.send(channel, { ...payload, token });
    } catch {
      finish(fallback);
    }
  });
}

const UNDO_BRIDGE_TIMEOUT_MS = 2000;
const UNDO_BRIDGE_BUDGET_MS = 1500;

module.exports = { requestFromRenderer, UNDO_BRIDGE_TIMEOUT_MS, UNDO_BRIDGE_BUDGET_MS };
