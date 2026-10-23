// Native OS notifications requested by a renderer. Main owns them so they
// reach the user when the window is hidden, unfocused or on another Space,
// which is when an in-app toast cannot (D2).
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 400;

// Electron can garbage-collect a Notification before its click fires; hold
// each one until the OS closes it or the user clicks it.
const active = new Set();

function normalizeSystemNotification(payload) {
  if (!payload || typeof payload !== "object") return null;
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) return null;
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  return { title: title.slice(0, MAX_TITLE_LENGTH), body: body.slice(0, MAX_BODY_LENGTH) };
}

function showSystemNotification({ Notification, payload, prefs, onClick }) {
  if (prefs && prefs.notificationsEnabled === false) return { success: false, reason: "disabled" };
  if (!Notification || !Notification.isSupported())
    return { success: false, reason: "unsupported" };
  const content = normalizeSystemNotification(payload);
  if (!content) return { success: false, reason: "invalid" };
  const notification = new Notification({ title: content.title, body: content.body });
  active.add(notification);
  const release = () => active.delete(notification);
  notification.on("close", release);
  notification.on("click", () => {
    release();
    onClick?.();
  });
  notification.show();
  return { success: true };
}

module.exports = {
  MAX_TITLE_LENGTH,
  MAX_BODY_LENGTH,
  normalizeSystemNotification,
  showSystemNotification,
};
