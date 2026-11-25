const { shell } = require("electron");

// shell.openExternal hands the URL to the OS protocol handler, so file:, smb:,
// custom app schemes and the like can launch programs or reach network shares.
// Callers pass values that originate outside the app (calendar invites,
// renderer window.open), so the scheme gate lives here and covers every path.
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

async function openExternalUrl(url) {
  const { protocol } = new URL(url);
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) {
    throw new Error(`Blocked URL scheme: ${protocol}`);
  }
  return shell.openExternal(url);
}

module.exports = { openExternalUrl };
