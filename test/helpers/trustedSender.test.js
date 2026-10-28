const assert = require("node:assert/strict");
const test = require("node:test");
const { createTrustedSender } = require("../../src/helpers/privacy/trustedSender");

const prefixes = () => [
  "file:///Applications/Loqui.app/Contents/Resources/app.asar/src/dist/index.html",
];
function windowWith(url) {
  const mainFrame = { url };
  const webContents = { mainFrame };
  return { webContents, isDestroyed: () => false };
}

test("only the main frame of a known window showing the app's own page is trusted", () => {
  const settings = windowWith(
    "file:///Applications/Loqui.app/Contents/Resources/app.asar/src/dist/index.html?panel=true"
  );
  const isTrusted = createTrustedSender({
    getWindows: () => [settings, null],
    appUrlPrefixes: prefixes,
  });
  assert.equal(
    isTrusted({ sender: settings.webContents, senderFrame: settings.webContents.mainFrame }),
    true
  );
  // A child frame inside the same window.
  assert.equal(
    isTrusted({
      sender: settings.webContents,
      senderFrame: { url: settings.webContents.mainFrame.url },
    }),
    false
  );
  // The main frame navigated somewhere else.
  const hijacked = windowWith("https://evil.example/");
  const isTrusted2 = createTrustedSender({
    getWindows: () => [hijacked],
    appUrlPrefixes: prefixes,
  });
  assert.equal(
    isTrusted2({ sender: hijacked.webContents, senderFrame: hijacked.webContents.mainFrame }),
    false
  );
  // An unknown webContents.
  const other = windowWith(settings.webContents.mainFrame.url);
  assert.equal(
    isTrusted({ sender: other.webContents, senderFrame: other.webContents.mainFrame }),
    false
  );
  assert.equal(isTrusted({}), false);
});

test("appUrlPrefixes follows the real DevServerManager contracts in both modes", () => {
  const { appUrlPrefixes } = require("../../src/helpers/privacy/trustedSender");
  const prod = {
    getAppFilePath: () => ({
      path: "/Applications/Loqui.app/Contents/Resources/app.asar/src/dist/index.html",
      query: { panel: "true" },
    }),
    getAppUrl: () => null,
  };
  assert.deepEqual(appUrlPrefixes({ DevServerManager: prod, env: {} }), [
    "file:///Applications/Loqui.app/Contents/Resources/app.asar/src/dist/index.html",
  ]);
  const dev = { getAppFilePath: () => null, getAppUrl: () => "http://localhost:5174/?panel=true" };
  assert.deepEqual(appUrlPrefixes({ DevServerManager: dev, env: { NODE_ENV: "development" } }), [
    "http://localhost:5174/",
  ]);
  // A development page is trusted only on the dev server's own origin.
  const page = windowWith("http://localhost:5174/?panel=true");
  const isTrusted = createTrustedSender({
    getWindows: () => [page],
    appUrlPrefixes: () =>
      appUrlPrefixes({ DevServerManager: dev, env: { NODE_ENV: "development" } }),
  });
  assert.equal(
    isTrusted({ sender: page.webContents, senderFrame: page.webContents.mainFrame }),
    true
  );
});

test("app identity rejects adjacent files, other paths, encoded traversal, credentials and lookalike origins", () => {
  const allowed = ["file:///app/dist/index.html", "http://localhost:5183/"];
  const page = windowWith(allowed[0]);
  const trusted = createTrustedSender({ getWindows: () => [page], appUrlPrefixes: () => allowed });
  for (const url of [
    "file:///app/dist/evil.html",
    "file:///app/dist/index.html.evil",
    "file:///app/dist/%2e%2e/evil",
    "http://localhost:5183/evil",
    "http://user@localhost:5183/",
    "http://localhost:51830/",
    "https://localhost:5183/",
  ]) {
    page.webContents.mainFrame.url = url;
    assert.equal(
      trusted({ sender: page.webContents, senderFrame: page.webContents.mainFrame }),
      false,
      url
    );
  }
});
