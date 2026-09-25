const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
if (process.version !== `v${fs.readFileSync(".node-version", "utf8").trim()}`)
  throw Error(`Unexpected Node ${process.version}`);
if (!["linux-x64", "darwin-arm64"].includes(`${process.platform}-${process.arch}`))
  throw Error("Unsupported architecture");
console.log({ node: process.version, platform: process.platform, arch: process.arch });
for (const [cmd, args] of [
  ["npm", ["--version"]],
  ["clang", ["--version"]],
  ["cmake", ["--version"]],
])
  execFileSync(cmd, args, { stdio: "inherit" });
if (process.platform === "darwin") {
  const sdk = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-version"], {
    encoding: "utf8",
  }).trim();
  if (Number(sdk.split(".")[0]) < 26) throw Error(`macOS SDK 26 or newer required, found ${sdk}`);
  execFileSync("xcodebuild", ["-version"], { stdio: "inherit" });
  console.log({ sdk });
}

if (process.env.GITHUB_OUTPUT) {
  const crypto = require("node:crypto");
  const toolchain = [
    process.version,
    execFileSync("clang", ["--version"], { encoding: "utf8" }),
    execFileSync("cmake", ["--version"], { encoding: "utf8" }),
    process.env.ImageVersion || "local",
    process.platform === "darwin"
      ? execFileSync("xcrun", ["--show-sdk-version"], { encoding: "utf8" })
      : "",
  ].join("\n");
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `key=${crypto.createHash("sha256").update(toolchain).digest("hex")}\n`
  );
}
