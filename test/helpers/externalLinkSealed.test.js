// Task 11 (N21): every web, mail and OS-settings handoff to another app asks
// in a main-owned dialog while sealed. The real opener, IPC handlers and
// confirmation factory run; shell.openExternal is a recording stub, so no
// browser, mail client or settings app is ever launched.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const opened = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron")
    return {
      app: { getPath: () => require("node:os").tmpdir(), isReady: () => false, getName: () => "t" },
      shell: {
        openExternal: async (url) => {
          opened.push(url);
        },
      },
    };
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => {
  Module._load = originalLoad;
});

const {
  openExternalUrl,
  openSystemSettingsUrl,
  setExternalOpenGuard,
  attachOpenExternal,
} = require("../../src/helpers/externalUrlOpener");
const {
  createConfirmations,
  createExternalOpenGuard,
} = require("../../src/helpers/privacy/privacyBoot");

test.beforeEach(() => {
  opened.length = 0;
  setExternalOpenGuard(null);
});
test.after(() => setExternalOpenGuard(null));

// A dialog stub that records what main would show and answers with `answer`
// (the button index), or with the safe default when `answer` is undefined.
function dialogs(answer) {
  const shown = [];
  const confirm = createConfirmations({
    dialog: {
      showMessageBox: async (...args) => {
        const options = args.at(-1);
        shown.push({ parent: args.length === 2 ? args[0] : null, options });
        return { response: answer ?? options.defaultId };
      },
    },
    BrowserWindow: { fromWebContents: (sender) => (sender ? { window: sender.id } : undefined) },
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
  });
  return { shown, confirm };
}

test("a declined link never reaches the OS, and is not an error", async () => {
  const asked = [];
  setExternalOpenGuard(async (url, context) => {
    asked.push([url, context.kind]);
    return false;
  });
  assert.equal(await openExternalUrl("https://example.com/a?b=1"), false);
  assert.deepEqual(asked, [["https://example.com/a?b=1", "link"]]);
  assert.deepEqual(opened, []);
});

test("a confirmed link opens; a blocked scheme is refused before the guard is asked", async () => {
  const asked = [];
  setExternalOpenGuard(async (url) => {
    asked.push(url);
    return true;
  });
  assert.equal(await openExternalUrl("mailto:someone@example.com"), true);
  await assert.rejects(openExternalUrl("file:///etc/passwd"), /Blocked URL scheme/);
  await assert.rejects(
    openExternalUrl("x-apple.systempreferences:com.apple.preference.security"),
    /Blocked URL scheme/
  );
  assert.deepEqual(asked, ["mailto:someone@example.com"]);
  assert.deepEqual(opened, ["mailto:someone@example.com"]);
});

test("a guard that fails closes the handoff: nothing opens", async () => {
  setExternalOpenGuard(async () => {
    throw new Error("PRIVACY_CONFIRMATION_FAILED");
  });
  await assert.rejects(openExternalUrl("https://example.com"), /PRIVACY_CONFIRMATION_FAILED/);
  assert.deepEqual(opened, []);
});

test("system settings open only fixed OS-settings schemes, and ask as an outside-app handoff", async () => {
  const asked = [];
  let answer = false;
  setExternalOpenGuard(async (url, context) => {
    asked.push([url, context.kind]);
    return answer;
  });
  const mic = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  assert.equal(await openSystemSettingsUrl(mic), false);
  assert.deepEqual(opened, []);
  answer = true;
  assert.equal(await openSystemSettingsUrl("ms-settings:privacy-microphone"), true);
  assert.deepEqual(opened, ["ms-settings:privacy-microphone"]);
  for (const url of ["https://example.com", "mailto:a@b.c", "file:///", "smb://host/share"])
    await assert.rejects(openSystemSettingsUrl(url), /Blocked URL scheme/, url);
  assert.deepEqual(asked, [
    [mic, "systemSettings"],
    ["ms-settings:privacy-microphone", "systemSettings"],
  ]);
});

test("the link dialog names the host, and its default answer is don't open", async () => {
  const { shown, confirm } = dialogs();
  assert.equal(await confirm.openLink("https://meet.example.com/abc?pwd=secret"), false);
  const { options } = shown[0];
  assert.equal(options.defaultId, 0);
  assert.equal(options.cancelId, 0);
  assert.deepEqual(options.buttons, ["sealedMode.confirmLink.keep", "sealedMode.confirmLink.open"]);
  assert.equal(options.title, "sealedMode.confirmLink.title");
  assert.equal(options.message, "sealedMode.confirmLink.message");
  assert.match(options.detail, /^sealedMode\.confirmLink\.detail /);
  assert.match(options.detail, /meet\.example\.com/);
  assert.doesNotMatch(options.detail, /pwd=secret|abc/, "the host, never the full URL");
});

test("the link dialog never shows credentials, mail addresses or a spoofable host", async () => {
  const { shown, confirm } = dialogs();
  await confirm.openLink("https://user:pass@example.com:8443/x");
  await confirm.openLink("mailto:someone@private.example?subject=hi");
  await confirm.openLink("https://exämple.com/");
  await confirm.openLink("not a url");
  const details = shown.map((s) => s.options.detail);
  assert.match(details[0], /example\.com:8443/);
  assert.doesNotMatch(details[0], /user|pass/);
  assert.equal(details[1], "sealedMode.confirmLink.mailDetail");
  assert.match(details[2], /xn--exmple-cua\.com/, "IDN hosts are shown in their ASCII form");
  assert.match(details[3], /\?/);
});

test("the dialog is window-modal for a renderer sender and app-modal otherwise", async () => {
  const { shown, confirm } = dialogs(1);
  assert.equal(await confirm.openLink("https://example.com", { sender: { id: 7 } }), true);
  assert.equal(await confirm.openLink("https://example.com"), true);
  assert.deepEqual(shown[0].parent, { window: 7 });
  assert.equal(shown[1].parent, null);
});

test("the settings dialog has its own copy and a don't-open default", async () => {
  const { shown, confirm } = dialogs();
  assert.equal(await confirm.openSystemSettings(), false);
  const { options } = shown[0];
  assert.equal(options.defaultId, 0);
  assert.equal(options.cancelId, 0);
  assert.equal(options.title, "sealedMode.confirmSettings.title");
  assert.equal(options.message, "sealedMode.confirmSettings.message");
  assert.deepEqual(options.buttons, [
    "sealedMode.confirmSettings.keep",
    "sealedMode.confirmSettings.open",
  ]);
});

test("main's guard opens directly when unsealed and asks the right dialog while sealed", async () => {
  let sealed = false;
  const { shown, confirm } = dialogs();
  const guard = createExternalOpenGuard({ isSealed: () => sealed, confirm });
  assert.equal(await guard("https://example.com/x", { kind: "link" }), true);
  assert.deepEqual(shown, [], "no dialog while unsealed");
  sealed = true;
  const sender = { id: 3 };
  assert.equal(await guard("https://example.com/x", { kind: "link", event: { sender } }), false);
  assert.equal(await guard("ms-settings:sound", { kind: "systemSettings" }), false);
  assert.deepEqual(
    shown.map((s) => [s.options.title, s.parent]),
    [
      ["sealedMode.confirmLink.title", { window: 3 }],
      ["sealedMode.confirmSettings.title", null],
    ]
  );
  const unknown = createExternalOpenGuard({
    isSealed: () => {
      throw new Error("state unreadable");
    },
    confirm,
  });
  assert.equal(await unknown("https://example.com", { kind: "link" }), false);
  assert.equal(shown.length, 3, "an unreadable seal state asks rather than opens");
});

test("open-external over IPC reports a declined link as declined, not failed", async () => {
  const handlers = new Map();
  attachOpenExternal({ ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } });
  const events = [];
  setExternalOpenGuard(async (_url, { event }) => {
    events.push(event);
    return false;
  });
  const event = { sender: { id: 1 } };
  assert.deepEqual(await handlers.get("open-external")(event, "https://example.com"), {
    success: false,
    declined: true,
  });
  assert.equal(events[0], event, "the dialog is parented to the asking window");
  setExternalOpenGuard(async () => true);
  assert.deepEqual(await handlers.get("open-external")({}, "https://example.com"), {
    success: true,
  });
  assert.deepEqual(await handlers.get("open-external")({}, "file:///etc/passwd"), {
    success: false,
    error: "Blocked URL scheme: file:",
  });
  // The OS receives the serialized URL the guard saw (T11-M2).
  assert.deepEqual(opened, ["https://example.com/"]);
});

// The real ipcHandlers.js settings openers, evaluated with Electron's IPC
// boundary recorded and the real opener module.
function loadSettingsHandlers(platform) {
  const handlers = new Map();
  const module = { exports: {} };
  const inert = () =>
    new Proxy(function () {}, {
      get: (_, key) => (key === "then" ? undefined : inert()),
      apply: () => inert(),
      construct: () => inert(),
    });
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, "../../src/helpers/ipcHandlers.js"), "utf8"),
    {
      module,
      exports: module.exports,
      process: new Proxy(process, {
        get: (target, key) => (key === "platform" ? platform : Reflect.get(target, key)),
      }),
      Date,
      setTimeout,
      clearTimeout,
      AbortController,
      require: (name) => {
        if (name === "electron")
          return {
            ipcMain: { handle: (n, fn) => handlers.set(n, fn), on() {} },
            shell: {
              openExternal: async () => assert.fail("settings must open through the opener"),
            },
          };
        if (name === "./externalUrlOpener") return require("../../src/helpers/externalUrlOpener");
        if (name === "./privacy/egressPolicy")
          return require("../../src/helpers/privacy/egressPolicy");
        return inert();
      },
    }
  );
  const context = new Proxy({}, { get: (target, key) => (key in target ? target[key] : inert()) });
  module.exports.prototype.setupHandlers.call(context);
  return handlers;
}

test("OS-settings handlers keep their fixed URLs and ask before handing off while sealed", async () => {
  const handlers = loadSettingsHandlers("darwin");
  const asked = [];
  let answer = false;
  setExternalOpenGuard(async (url, { kind, event }) => {
    asked.push([url, kind, event?.sender?.id ?? null]);
    return answer;
  });
  const event = { sender: { id: 9 } };
  // The renderer supplies no URL: an argument is ignored.
  // Results come from the handler's VM realm: compare plain copies.
  assert.deepEqual(
    { ...(await handlers.get("open-microphone-settings")(event, "https://evil.test")) },
    { success: false, declined: true }
  );
  answer = true;
  assert.deepEqual(
    { ...(await handlers.get("open-calendar-privacy-settings")(event)) },
    {
      success: true,
    }
  );
  assert.deepEqual(asked, [
    [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      "systemSettings",
      9,
    ],
    [
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
      "systemSettings",
      9,
    ],
  ]);
  assert.deepEqual(opened, [
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
  ]);
});

test("all eleven locales render the link and settings dialogs through the real factory", async () => {
  const i18next = require("i18next");
  for (const locale of ["ar", "de", "en", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"]) {
    const translation = require(`../../src/locales/${locale}/translation.json`);
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: false,
      interpolation: { escapeValue: false },
      resources: { [locale]: { translation } },
    });
    const { link, settings } = {
      link: translation.sealedMode.confirmLink,
      settings: translation.sealedMode.confirmSettings,
    };
    assert.deepEqual(Object.keys(link), [
      "title",
      "message",
      "detail",
      "mailDetail",
      "keep",
      "open",
    ]);
    assert.deepEqual(Object.keys(settings), ["title", "message", "keep", "open"]);
    for (const [key, value] of [...Object.entries(link), ...Object.entries(settings)]) {
      assert.ok(typeof value === "string" && value.trim(), `${locale}/${key}`);
      // Honest copy: nothing claims the other app is covered or isolated.
      assert.doesNotMatch(value, /verified|isolat|0 bytes|nothing leaves/i, `${locale}/${key}`);
    }
    assert.deepEqual(link.detail.match(/{{.*?}}/g), ["{{host}}"], locale);
    for (const key of ["title", "message", "mailDetail", "keep", "open"])
      assert.equal(/{{/.test(link[key]), false, `${locale}/${key}`);
    if (locale !== "en") {
      const en = require("../../src/locales/en/translation.json").sealedMode;
      assert.notEqual(link.message, en.confirmLink.message, `${locale} is translated`);
      assert.notEqual(settings.message, en.confirmSettings.message, `${locale} is translated`);
    }
    const shown = [];
    const confirm = createConfirmations({
      dialog: {
        showMessageBox: async (options) => {
          shown.push(options);
          return { response: 0 };
        },
      },
      BrowserWindow: { fromWebContents: () => undefined },
      t: (key, params) => i18n.t(key, params),
    });
    await confirm.openLink("https://meet.example.com/j/1?pwd=x");
    await confirm.openLink("mailto:a@example.com");
    await confirm.openSystemSettings();
    assert.ok(shown[0].detail.includes("⁨meet.example.com⁩"), locale);
    assert.equal(shown[1].detail, link.mailDetail);
    assert.deepEqual(shown[2].buttons, [settings.keep, settings.open]);
    for (const options of shown)
      for (const text of [options.title, options.message, options.detail ?? ""])
        assert.doesNotMatch(text, /{{|sealedMode\./, locale);
  }
});

// T11-M2: the OS receives exactly the serialized URL the guard (and its
// dialog) saw, never the raw caller string.
test("the OS gets the same serialized URL the confirmation was asked about", async () => {
  const asked = [];
  setExternalOpenGuard(async (url) => {
    asked.push(url);
    return true;
  });
  assert.equal(await openExternalUrl("HTTPS://EXAMPLE.com/a b?q=1"), true);
  assert.equal(await openExternalUrl("mailto:Someone@Example.com"), true);
  assert.deepEqual(opened, asked);
  assert.deepEqual(opened, ["https://example.com/a%20b?q=1", "mailto:Someone@Example.com"]);
});
