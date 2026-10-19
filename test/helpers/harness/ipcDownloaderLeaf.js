const handlersModulePath = require.resolve("../../../src/helpers/ipcHandlers");

// Unrelated setup leaf: the caller retains its existing loader and teardown.
// A non-match must continue through that loader, including preimport guards.
function ipcDownloaderLeaf(request, parent) {
  if (parent?.filename !== handlersModulePath || request !== "./urlAudioDownloader")
    return undefined;
  return {
    sweepStaleTempArtifacts() {},
    download() {
      throw new Error("Fixture blocks downloads");
    },
  };
}

module.exports = { ipcDownloaderLeaf };
