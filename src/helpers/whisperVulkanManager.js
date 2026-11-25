const GpuBinaryManager = require("./gpuBinaryManager");
const { WHISPER_CPP_TAG } = require("./whisperCppRelease");

// Pinned so untested future binaries never auto-ship; bump together with the digests below
// sha256 per release tag; tags without an entry fall back to the API-reported digest
const EXPECTED_DIGESTS = {
  "0.0.10": {
    "whisper-server-linux-x64-vulkan.zip":
      "7bcd8b226cae9b0384613ce315fd8afab533fbdc5c3731343a09de8693eca203",
  },
  // Same source as 0.0.8, rebuilt alongside the Pascal CUDA kernels
  "0.0.9": {
    "whisper-server-linux-x64-vulkan.zip":
      "02ddc850715421ff92940d5b4589cce95e3dec1906a134d3d0c809065f47fb5d",
  },
  "0.0.8": {
    "whisper-server-linux-x64-vulkan.zip":
      "6e3e355dff3a1e96550d63445dc1ba4a881c2e63fe93be6a4f5ed946a204be27",
  },
};

const BIN_SUBDIR = "whisper-vulkan";

class WhisperVulkanManager extends GpuBinaryManager {
  constructor() {
    super({
      name: "Vulkan whisper",
      dirName: BIN_SUBDIR,
      releaseUrl: `https://api.github.com/repos/OpenWhispr/whisper.cpp/releases/tags/${WHISPER_CPP_TAG}`,
      expectedDigests: EXPECTED_DIGESTS[WHISPER_CPP_TAG],
      assets: {
        "linux-x64": {
          assetName: "whisper-server-linux-x64-vulkan.zip",
          binaryName: "whisper-server-linux-x64-vulkan",
          outputName: "whisper-server-linux-x64-vulkan",
        },
      },
    });
  }
}

module.exports = WhisperVulkanManager;
module.exports.BIN_SUBDIR = BIN_SUBDIR;
