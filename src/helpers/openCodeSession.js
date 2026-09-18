const { randomUUID } = require("node:crypto");
function openCodeSessionHeaders(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "opencode.ai" || host.endsWith(".opencode.ai")
      ? { "x-opencode-session": randomUUID() }
      : {};
  } catch {
    return {};
  }
}
module.exports = { openCodeSessionHeaders };
