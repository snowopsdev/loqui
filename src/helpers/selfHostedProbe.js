const { isPrivateHost } = require("./providerConnectionTest");
const { isSealedModeError } = require("./privacy/egressPolicy");

// "Test" for a self-hosted server: one GET <base>/models with no headers at
// all, so no saved key can reach an address the user is still typing.
// Production passes main's gated fetch (providerCheck): while sealed only
// loopback is reached, and a refusal comes back as { code: "sealed" }.
async function probeSelfHosted(baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 8000) {
  const raw = String(baseUrl ?? "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalidUrl" };
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return { ok: false, code: "invalidUrl" };
  }
  // HTTPS validity is the executors' private-host rule, separate from locality.
  if (url.protocol === "http:" && !isPrivateHost(url.hostname))
    return { ok: false, code: "httpsRequired" };
  // Keep the address as typed, as the executors do: Sealed mode then judges
  // the same spelling the route graph does, so 127.1 is not passed off as
  // 127.0.0.1. Fetch still parses it to the same request as before.
  const endpoint = `${raw.replace(/[?#][\s\S]*$/, "").replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      // Release the unread body: the gate settles its ticket and records the
      // request only when the body ends (final review I7).
      await response.body?.cancel().catch(() => {});
      return { ok: false, code: "http", status: response.status };
    }
    // A seal that cuts the body off is not "no models".
    const body = await response.json().catch((error) => {
      if (isSealedModeError(error)) throw error;
      return {};
    });
    return { ok: true, count: Array.isArray(body?.data) ? body.data.length : 0 };
  } catch (error) {
    if (isSealedModeError(error)) return { ok: false, code: "sealed" };
    return { ok: false, code: error?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { probeSelfHosted };
