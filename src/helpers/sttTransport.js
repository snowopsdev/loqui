const egress = require("./privacy/egressGate");
const { guardMetered } = require("./privacy/gatedFetch");

// Moved unchanged from ipcHandlers.js.
function buildMultipartBody(fileBuffer, fileName, contentType, fields = {}) {
  const boundary = `----OpenWhispr${Date.now()}`;
  const parts = [];

  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  parts.push(fileBuffer);
  parts.push("\r\n");

  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item == null) continue;
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${item}\r\n`
      );
    }
  }

  parts.push(`--${boundary}--\r\n`);

  const bodyParts = parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p));
  return { body: Buffer.concat(bodyParts), boundary };
}

// Batch speech uploads (BYOK and self-hosted). The task comes from the
// handler's egress.withTask() context (dictationStt or uploadStt); correlation
// and provider come from the options, else the egress.withContext() context.
// One ticket covers the request and the body read. The request is a metered,
// tagged attempt: bytesOut is the exact multipart body length, its receipts are
// dispatched just before the transport and delivered when the response arrives,
// and sealing it mid-flight is reported as interrupted.
async function postMultipart(
  url,
  body,
  boundary,
  headers = {},
  { signal, session: fetchSession, correlationId = null, provider = null } = {}
) {
  const { net } = require("electron");
  return guardMetered(
    { target: url.toString(), payload: "audio", correlationId, provider },
    async (ticket) => {
      const send = egress.meteredFetch(ticket, (u, init) => (fetchSession ?? net).fetch(u, init), {
        tag: true,
      });
      const response = await send(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          ...headers,
        },
        body,
        useSessionCookies: false,
        signal,
      });
      const text = await response.text();
      try {
        return { statusCode: response.status, data: JSON.parse(text) };
      } catch {
        // Vercel platform errors (413 payload cap, 504 timeout) return non-JSON bodies.
        throw Object.assign(new Error(`Server error ${response.status}: ${text.slice(0, 120)}`), {
          code: "SERVER_ERROR",
          statusCode: response.status,
        });
      }
    }
  );
}

module.exports = { buildMultipartBody, postMultipart };
