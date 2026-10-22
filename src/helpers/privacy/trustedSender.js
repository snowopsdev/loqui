const { pathToFileURL } = require("node:url");

// Match a known window's exact main frame and application document. Queries
// and fragments select app views; sibling files and same-origin paths do not.
function createTrustedSender({ getWindows, appUrlPrefixes }) {
  return (event) => {
    try {
      const sender = event?.sender;
      const frame = event?.senderFrame;
      if (!sender || !frame || sender.isDestroyed?.() || frame !== sender.mainFrame) return false;
      if (!getWindows().some((w) => w && !w.isDestroyed() && w.webContents === sender))
        return false;
      const url = new URL(frame.url);
      if (url.username || url.password) return false;
      return appUrlPrefixes().some((identity) => {
        const app = new URL(identity);
        return (
          url.protocol === app.protocol && url.host === app.host && url.pathname === app.pathname
        );
      });
    } catch {
      return false;
    }
  };
}
function appUrlPrefixes({
  DevServerManager = require("../devServerManager"),
  env = process.env,
} = {}) {
  if (env.NODE_ENV === "development") {
    const url = DevServerManager.getAppUrl(true);
    return url ? [new URL("/", url).href] : [];
  }
  const file = DevServerManager.getAppFilePath(true);
  return file?.path ? [pathToFileURL(file.path).href] : [];
}
module.exports = { createTrustedSender, appUrlPrefixes };
