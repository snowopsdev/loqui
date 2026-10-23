const debugLogger = require("./debugLogger");

let dbusModule;
function getDBus() {
  if (dbusModule !== undefined) return dbusModule;
  try {
    dbusModule = require("@homebridge/dbus-native");
  } catch {
    dbusModule = null;
  }
  return dbusModule;
}

const PATH = "/org/freedesktop/Notifications";
const NAME = "org.freedesktop.Notifications";
const CALL_TIMEOUT_MS = 5000;

async function createFreedesktopClient({ getDBus: loadDBus = getDBus } = {}) {
  let bus;
  try {
    const dbus = loadDBus();
    if (!dbus) return null;
    bus = dbus.sessionBus();
  } catch {
    return null;
  }

  let alive = true;
  const pending = new Set();
  const disconnects = new Set();
  const actions = new Set();
  const closed = new Set();
  const subscriptions = [];
  const lose = (error = new Error("Notification service disconnected")) => {
    if (!alive) return;
    alive = false;
    for (const fail of [...pending]) fail(error);
    for (const cb of disconnects) cb();
  };
  // sessionBus returns before connecting. Install this before introspection,
  // otherwise its asynchronous socket error is an unhandled EventEmitter error.
  bus.connection.on("error", (error) => {
    debugLogger.debug("Notification bus error", { error: error?.message }, "meeting");
    lose(error);
  });
  bus.connection.on("end", () => lose());

  const call = (label, invoke, onLate) =>
    new Promise((resolve, reject) => {
      if (!alive) {
        reject(new Error("Notification service disconnected"));
        return;
      }
      let settled = false;
      const finish = (err, value) => {
        if (settled) {
          if (!err) onLate?.(value);
          return;
        }
        settled = true;
        clearTimeout(timer);
        pending.delete(fail);
        if (err) reject(err);
        else resolve(value);
      };
      const fail = (error) => finish(error);
      const timer = setTimeout(() => fail(new Error(`${label} timed out`)), CALL_TIMEOUT_MS);
      pending.add(fail);
      try {
        invoke(finish);
      } catch (error) {
        finish(error);
      }
    });
  // Installed dbus-native's iface.on returns before AddMatch succeeds. Use its
  // callback API and raw signal body arrays to establish readiness before Notify.
  const subscribe = async (path, name, member, callback, extra = "") => {
    const key = bus.mangle(path, name, member);
    const listener = (body) => callback(...body);
    bus.signals.on(key, listener);
    subscriptions.push([key, listener]);
    await call("AddMatch", (done) =>
      bus.addMatch(
        `type='signal',path='${path}',interface='${name}',member='${member}'${extra}`,
        done
      )
    );
  };
  try {
    await subscribe(
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "NameOwnerChanged",
      (name, oldOwner, newOwner) => {
        if (name === NAME && oldOwner && oldOwner !== newOwner) lose();
      },
      `,arg0='${NAME}'`
    );
    const iface = await call("GetInterface", (done) =>
      bus.getService(NAME).getInterface(PATH, NAME, done)
    );
    if (!iface) throw new Error("Notification interface unavailable");
    await subscribe(PATH, NAME, "ActionInvoked", (id, key) => {
      if (alive) for (const cb of actions) cb(Number(id), String(key));
    });
    await subscribe(PATH, NAME, "NotificationClosed", (id) => {
      if (alive) for (const cb of closed) cb(Number(id));
    });
    if (!alive) throw new Error("Notification service disconnected");
    const method = (name, args, onLate) => call(name, (done) => iface[name](...args, done), onLate);
    const close = (id) => method("CloseNotification", [id]);
    const hint = (key, value) => [
      key,
      typeof value === "boolean"
        ? ["b", value]
        : typeof value === "number"
          ? ["y", value]
          : ["s", value],
    ];
    return {
      capabilities: () => method("GetCapabilities", []),
      notify: ({ title, body, actions, hints }) =>
        method(
          "Notify",
          [
            "Loqui",
            0,
            "media-record",
            title,
            body,
            actions,
            Object.entries(hints).map(([k, v]) => hint(k, v)),
            0,
          ],
          (id) => {
            // A timeout can precede a successful server reply. Retire that orphan
            // even after the caller has switched to fallback or ended its session.
            if (Number.isInteger(id) && id > 0) void close(id).catch(() => {});
          }
        ),
      close,
      onAction: (cb) => {
        actions.add(cb);
      },
      onClosed: (cb) => {
        closed.add(cb);
      },
      onDisconnect: (cb) => {
        disconnects.add(cb);
        if (!alive) cb();
      },
    };
  } catch {
    lose();
    for (const [key, listener] of subscriptions) bus.signals.removeListener(key, listener);
    try {
      bus.connection.end();
    } catch {}
    return null;
  }
}

module.exports = { createFreedesktopClient };
