// will-navigate also fires for renderer-initiated location.reload() with the
// window's own URL (appUrl), so that URL must stay allowed. devtools:// is
// allowed only in an unpackaged build (`allowDevtools`, Task 18 T18R-06).
function isAllowedAppNavigation(url, appUrl, { allowDevtools = false } = {}) {
  if (url.startsWith("devtools://")) return allowDevtools === true;
  if (!appUrl) return false;

  try {
    const candidate = new URL(url);
    const app = new URL(appUrl);
    // A file: URL that names a host other than localhost is a network fetch
    // (SMB/UNC on Windows), never the app (T18R-06). The URL parser already
    // empties a "localhost" file host.
    if (candidate.protocol === "file:" && !["", "localhost"].includes(candidate.hostname))
      return false;
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
function guardWindowNavigation(webContents, { getAppUrl, openExternal, allowDevtools = false }) {
  const route = (url) => {
    if (typeof url === "string" && isHandoffUrl(url)) openExternal(url);
  };
  webContents.on?.("will-navigate", (event, url) => {
    if (isAllowedAppNavigation(url, getAppUrl(), { allowDevtools })) return;
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

// The permissions Loqui's renderers use (Task 18 T18R-04): the microphone
// (getUserMedia), meeting system audio (getDisplayMedia) and the clipboard
// (navigator.clipboard read and write). Everything else is denied, sealed or
// not: geolocation always (Chromium's network location provider fetches
// outside session.webRequest, and Loqui never asks for a location), and any
// permission unknown today or added by a later Chromium.
const GRANTED_PERMISSIONS = new Set([
  "media",
  "display-capture",
  "clipboard-read",
  "clipboard-sanitized-write",
]);
// Chromium asks the openExternal permission before handing an external
// protocol (mailto: and the like) straight to the OS, which would skip main's
// sealed confirmation (Task 18 K1). It is denied, and web and mail links go
// through the guarded opener instead. The check handler gives the same answers.
function installPermissionHandlers(session, openExternal) {
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== "openExternal") return callback(GRANTED_PERMISSIONS.has(permission));
    callback(false);
    const url = details?.externalURL;
    if (typeof url === "string" && isHandoffUrl(url)) openExternal(url);
  });
  session.setPermissionCheckHandler?.((_webContents, permission) =>
    GRANTED_PERMISSIONS.has(permission)
  );
}

module.exports = {
  isAllowedAppNavigation,
  isExternalBrowserUrl,
  isHandoffUrl,
  guardWindowNavigation,
  installPermissionHandlers,
  GRANTED_PERMISSIONS,
};
