const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const modulePath = require.resolve("../../src/helpers/screenContextCapture");
const originalLoad = Module._load;

// Stands in for Electron's NativeImage: `bytesAtQuality` maps a JPEG quality to
// the encoded size that quality would produce for a given screen's content.
// The encoded stub reports that size and tags itself with the quality used, so
// tests can assert which rung of the ladder produced the payload.
function fakeImage(bytesAtQuality, { edge = 1568, resizes = [] } = {}) {
  return {
    isEmpty: () => false,
    toJPEG(quality) {
      return {
        length: bytesAtQuality(quality, edge),
        toString: () => Buffer.from(`jpeg-${quality}`).toString("base64"),
      };
    },
    resize({ width }) {
      resizes.push(width);
      return fakeImage(bytesAtQuality, { edge: width, resizes });
    },
  };
}

function loadCapture({ image, platform = "darwin", accessStatus = "granted" }) {
  delete require.cache[modulePath];
  const calls = { thumbnailSizes: [] };

  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron") {
      return {
        screen: {
          getCursorScreenPoint: () => ({ x: 0, y: 0 }),
          getDisplayNearestPoint: () => ({ id: 1, size: { width: 2560, height: 1440 } }),
        },
        desktopCapturer: {
          getSources: async ({ thumbnailSize }) => {
            calls.thumbnailSizes.push(thumbnailSize);
            return [{ display_id: "1", thumbnail: image }];
          },
        },
        systemPreferences: { getMediaAccessStatus: () => accessStatus },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return { capture: require(modulePath), calls, originalPlatform };
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  }
}

test("a typical screenshot is sent at the highest quality", async () => {
  const { capture } = loadCapture({ image: fakeImage(() => 300_000) });

  const result = await capture.captureCursorDisplay();

  assert.equal(result.mediaType, "image/jpeg");
  assert.equal(Buffer.from(result.data, "base64").toString(), "jpeg-82");
});

test("an oversized screenshot steps down the quality ladder until it fits", async () => {
  // Only the lowest quality gets under the budget.
  const { capture } = loadCapture({
    image: fakeImage((quality) => (quality === 55 ? 900_000 : 2_000_000)),
  });

  const result = await capture.captureCursorDisplay();

  assert.equal(Buffer.from(result.data, "base64").toString(), "jpeg-55");
});

test("a screenshot that no quality fits is resized before a final attempt", async () => {
  const resizes = [];
  const { capture } = loadCapture({
    // Incompressible at full size; fits once the long edge shrinks.
    image: fakeImage((_quality, edge) => (edge < 1568 ? 800_000 : 4_000_000), { resizes }),
  });

  const result = await capture.captureCursorDisplay();

  assert.deepEqual(resizes, [1024]);
  assert.equal(Buffer.from(result.data, "base64").toString(), "jpeg-55");
});

test("a screenshot that still cannot fit is dropped rather than sent oversized", async () => {
  const { capture } = loadCapture({ image: fakeImage(() => 9_000_000) });

  assert.equal(await capture.captureCursorDisplay(), null);
});

test("capture is skipped when screen recording access is not granted", async () => {
  const { capture, calls } = loadCapture({
    image: fakeImage(() => 300_000),
    accessStatus: "denied",
  });

  assert.equal(await capture.captureCursorDisplay(), null);
  assert.equal(calls.thumbnailSizes.length, 0);
});

test("the captured thumbnail is bounded to the vision-model edge", async () => {
  const { capture, calls } = loadCapture({ image: fakeImage(() => 300_000) });

  await capture.captureCursorDisplay();

  const [size] = calls.thumbnailSizes;
  assert.equal(Math.max(size.width, size.height), 1568);
});
