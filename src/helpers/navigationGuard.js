// will-navigate also fires for renderer-initiated location.reload() with the
// window's own URL (appUrl), so that URL must stay allowed.
function isAllowedAppNavigation(url, appUrl) {
  if (url.startsWith("devtools://")) return true;
  if (!appUrl) return false;

  try {
    const candidate = new URL(url);
    const app = new URL(appUrl);
    // file:// URLs all share the opaque "null" origin, so protocol and
    // pathname carry the comparison there.
    return (
      candidate.origin === app.origin &&
      candidate.protocol === app.protocol &&
      candidate.pathname === app.pathname
    );
  } catch {
    return false;
  }
}

function isExternalBrowserUrl(url) {
  return url.startsWith("http://") || url.startsWith("https://");
}

// Web and mail links leave for another app only through main's guarded opener
// (externalUrlOpener), which asks in a main-owned dialog while sealed.
function isHandoffUrl(url) {
  return isExternalBrowserUrl(url) || String(url).startsWith("mailto:");
}

// Installed on every BrowserWindow (final review I3, T11-M7, T7a-M2): no
// in-app child windows and no navigation away from the app. http(s) and
// mailto targets are handed to `openExternal` (main's guarded opener);
// anything else is dropped. Tolerates fake webContents in tests.
function guardWindowNavigation(webContents, { getAppUrl, openExternal }) {
  const route = (url) => {
    if (typeof url === "string" && isHandoffUrl(url)) openExternal(url);
  };
  webContents.on?.("will-navigate", (event, url) => {
    if (isAllowedAppNavigation(url, getAppUrl())) return;
    event.preventDefault();
    route(url);
  });
  webContents.setWindowOpenHandler?.(({ url }) => {
    route(url);
    return { action: "deny" };
  });
  webContents.on?.("did-create-window", (childWindow, details) => {
    childWindow.close();
    if (details?.url && !details.url.startsWith("devtools://")) route(details.url);
  });
}

// Chromium asks this permission before handing an external protocol (mailto:
// and the like) straight to the OS, which would skip main's sealed
// confirmation (Task 18 K1). Deny it and route web and mail links through the
// guarded opener instead; every other permission keeps Electron's default
// answer (granted).
function routeOpenExternalPermission(session, openExternal) {
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== "openExternal") return callback(true);
    callback(false);
    const url = details?.externalURL;
    if (typeof url === "string" && isHandoffUrl(url)) openExternal(url);
  });
}

module.exports = {
  isAllowedAppNavigation,
  isExternalBrowserUrl,
  isHandoffUrl,
  guardWindowNavigation,
  routeOpenExternalPermission,
};
