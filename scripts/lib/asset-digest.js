const fs = require("node:fs");
const crypto = require("node:crypto");
async function assetDigest(file, kind = "archive") {
  if (kind === "archive") {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
  }
  if (kind !== "tar-contents-v1") throw Error(`Unknown digest kind: ${kind}`);
  // Gitiles regenerates tar entry timestamps on every request. Authenticate all
  // paths, types, permissions, links and file bytes before extracting anything.
  const entries = [],
    pending = [];
  await require("tar").t({
    file,
    onentry(entry) {
      if (!["File", "Directory", "SymbolicLink", "Link"].includes(entry.type))
        throw Error("Unsupported source archive entry");
      if (entry.path.startsWith("/") || entry.path.split("/").includes(".."))
        throw Error("Unsafe source archive path");
      pending.push(
        new Promise((resolve, reject) => {
          const hash = crypto.createHash("sha256");
          entry.on("data", (chunk) => hash.update(chunk));
          entry.on("error", reject);
          entry.on("end", () => {
            entries.push([
              entry.path,
              entry.type,
              entry.mode & 0o777,
              entry.linkpath || "",
              entry.type === "File" ? hash.digest("hex") : "",
            ]);
            resolve();
          });
        })
      );
    },
  });
  await Promise.all(pending);
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
module.exports = { assetDigest };
