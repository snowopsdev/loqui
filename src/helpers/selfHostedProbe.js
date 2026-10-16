const { isPrivateHost } = require("./providerConnectionTest");

// "Test" for a self-hosted server: one GET <base>/models with no headers at
// all, so no saved key can reach an address the user is still typing.
async function probeSelfHosted(baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 8000) {
  let url;
  try {
    url = new URL(String(baseUrl ?? "").trim());
  } catch {
    return { ok: false, code: "invalidUrl" };
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return { ok: false, code: "invalidUrl" };
  }
  if (url.protocol === "http:" && !isPrivateHost(url.hostname))
    return { ok: false, code: "httpsRequired" };
  const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, code: "http", status: response.status };
    const body = await response.json().catch(() => ({}));
    return { ok: true, count: Array.isArray(body?.data) ? body.data.length : 0 };
  } catch (error) {
    return { ok: false, code: error?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { probeSelfHosted };
