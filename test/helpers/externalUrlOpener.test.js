const test = require("node:test");
const { afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const openerModulePath = require.resolve("../../src/helpers/externalUrlOpener");
const originalLoad = Module._load;
const originalPlatform = process.platform;

function setPlatform(platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

// Returns the helper plus the shell.openExternal calls it made.
function loadOpener() {
  delete require.cache[openerModulePath];

  const openExternalCalls = [];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron") {
      return {
        shell: {
          openExternal: (url) => {
            openExternalCalls.push(url);
            return Promise.resolve();
          },
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    const { openExternalUrl } = require(openerModulePath);
    return { openExternalUrl, openExternalCalls };
  } finally {
    Module._load = originalLoad;
  }
}

afterEach(() => {
  Module._load = originalLoad;
  setPlatform(originalPlatform);
});

test("supported platforms open web links with shell.openExternal", async () => {
  const { openExternalUrl, openExternalCalls } = loadOpener();

  for (const platform of ["darwin", "linux"]) {
    setPlatform(platform);
    await openExternalUrl("https://meet.google.com/abc-defg-hij");
  }

  assert.deepEqual(openExternalCalls, [
    "https://meet.google.com/abc-defg-hij",
    "https://meet.google.com/abc-defg-hij",
  ]);
});

test("invalid URLs reject without launching anything", async () => {
  const { openExternalUrl, openExternalCalls } = loadOpener();

  await assert.rejects(openExternalUrl("not a url"), TypeError);

  assert.equal(openExternalCalls.length, 0);
});

test("refuses schemes that could launch programs or reach shares on every platform", async () => {
  for (const platform of ["darwin", "linux"]) {
    const { openExternalUrl, openExternalCalls } = loadOpener();
    setPlatform(platform);

    for (const url of [
      "file:///etc/passwd",
      "file://attacker.example/share/payload.exe",
      "smb://attacker.example/share/payload.exe",
      "javascript:alert(1)",
      "ms-msdt:/id PCWDiagnostic",
      "zoommtg://zoom.us/join?confno=1",
      "data:text/html,<script>1</script>",
    ]) {
      await assert.rejects(openExternalUrl(url), /Blocked URL scheme/, `${platform}: ${url}`);
    }

    assert.equal(openExternalCalls.length, 0);
  }
});

test("web and mail links keep opening on every platform", async () => {
  for (const platform of ["darwin", "linux"]) {
    const { openExternalUrl, openExternalCalls } = loadOpener();
    setPlatform(platform);

    await openExternalUrl("mailto:someone@example.com");
    await openExternalUrl("https://user:pass@example.com/path?q=1#f");

    assert.deepEqual(openExternalCalls, [
      "mailto:someone@example.com",
      "https://user:pass@example.com/path?q=1#f",
    ]);
  }
});
