const fs = require("fs");
const { promises: fsPromises } = require("fs");
const path = require("path");
const { net } = require("electron");
const { execFile } = require("child_process");
const { pipeline } = require("stream");
const debugLogger = require("./debugLogger");
const { runSystemTar } = require("./systemTar");
const egress = require("./privacy/egressGate");
const { hostOf, isSealedModeError } = require("./privacy/egressPolicy");

const USER_AGENT = "io.github.snowopsdev.loqui/0.1";
const PROGRESS_THROTTLE_MS = 100;
const DEFAULT_MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 30000;
const STALL_TIMEOUT_MS = 30000;
const STALE_TMP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_DOWNLOAD_INCOMPLETE",
]);

const TLS_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_UNTRUSTED",
]);

function isTlsError(error) {
  return (
    TLS_ERROR_CODES.has(error.code) ||
    (error.message && error.message.includes("unable to get local issuer certificate"))
  );
}

function isRetryable(error) {
  if (error.isAbort || error.isHttpError || isTlsError(error)) return false;
  return RETRYABLE_CODES.has(error.code);
}

function headerValue(headers, name) {
  const raw = headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function backoffDelay(attempt) {
  return Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF_MS);
}

// The retry backoff ends early when the download is cancelled or sealed, so a
// seal never waits out a 30-second backoff before the caller hears of it.
function sleep(ms, signal) {
  return new Promise((resolve) => {
    let timer = null;
    const wake = () => {
      clearTimeout(timer);
      if (signal && signal.onAbort === wake) signal.onAbort = null;
      resolve();
    };
    if (signal?.aborted) return resolve();
    timer = setTimeout(wake, ms);
    if (signal) signal.onAbort = wake;
  });
}

// A bounded ledger category for a failed attempt, never its message.
function errorClassOf(error) {
  if (error?.isTlsError || isTlsError(error ?? {})) return "TLS";
  const code = error?.code;
  if (code === "ETIMEDOUT") return "TIMEOUT";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS";
  if (["ECONNRESET", "ECONNREFUSED", "EPIPE"].includes(code)) return "CONNECTION";
  if (code === "ERR_DOWNLOAD_INCOMPLETE" || code === "ERR_STREAM_PREMATURE_CLOSE")
    return "PROTOCOL";
  return "OTHER";
}

function downloadAttempt(url, tempPath, options) {
  const { onProgress, signal, startOffset = 0, expectedSize = 0, ticket = null } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Download cancelled"), { isAbort: true }));
      return;
    }

    // One ledger row per actual request, including the redirects Chromium
    // follows inside it. Its bytes are this request's body only, so a resumed
    // or retried download never recounts what an earlier attempt received.
    const attempt = ticket ? ticket.beginAttempt(hostOf(url)) : null;
    const headers = { "User-Agent": USER_AGENT };
    if (startOffset > 0) {
      headers["Range"] = `bytes=${startOffset}-`;
    }
    // The session backstop attributes the request to this attempt and strips
    // the tag before it leaves (Task 6).
    if (attempt) headers[egress.EGRESS_TAG_HEADER] = attempt.tag;

    let request = null;
    let activeFile = null;
    let stallTimer = null;
    let downloadedSize = startOffset;
    let totalSize = 0;
    let lastProgressUpdate = 0;
    let settled = false;

    const cleanup = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      if (request) {
        request.abort();
        request = null;
      }
      if (!activeFile) return Promise.resolve();

      const file = activeFile;
      activeFile = null;
      if (file.closed) return Promise.resolve();

      // createWriteStream() opens asynchronously. Wait for close so callers
      // never unlink the temp path before a pending open can recreate it.
      return new Promise((done) => {
        file.once("close", done);
        file.destroy();
      });
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (signal) signal.onAbort = null;
      // A sealed ticket overrides this with cancelled/SEALED_MODE; an
      // unfinished body stays unknown (null), never a partial count.
      attempt?.settle(
        error.isAbort
          ? { outcome: "cancelled", errorClass: "ABORTED" }
          : error.isHttpError
            ? {}
            : { outcome: "error", errorClass: errorClassOf(error) }
      );
      cleanup().then(() => reject(error));
    };

    const onAbort = () => {
      fail(Object.assign(new Error("Download cancelled"), { isAbort: true }));
    };

    if (signal) {
      signal.onAbort = onAbort;
    }

    request = net.request({ url, method: "GET" });
    for (const [name, value] of Object.entries(headers)) {
      request.setHeader(name, value);
    }

    // Chromium follows redirects inside this request; record each hop's host.
    request.on("redirect", (_statusCode, _method, redirectUrl) => {
      attempt?.markDelivered();
      const next = hostOf(redirectUrl);
      if (next) attempt?.addHost(next);
    });

    request.on("response", (response) => {
      attempt?.noteStatus(response.statusCode);
      attempt?.markDelivered();
      if (signal?.aborted) {
        response.resume();
        fail(Object.assign(new Error("Download cancelled"), { isAbort: true }));
        return;
      }

      const statusCode = response.statusCode;

      if (statusCode === 200 && startOffset > 0) {
        // Server doesn't support Range — restart from beginning
        downloadedSize = 0;
        activeFile = fs.createWriteStream(tempPath, { flags: "w" });
        totalSize = parseInt(headerValue(response.headers, "content-length"), 10) || 0;
      } else if (statusCode === 206) {
        activeFile = fs.createWriteStream(tempPath, { flags: "a" });
        const contentRange = headerValue(response.headers, "content-range");
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)$/);
          if (match) totalSize = parseInt(match[1], 10);
        }
        if (!totalSize) {
          const contentLength = parseInt(headerValue(response.headers, "content-length"), 10) || 0;
          totalSize = startOffset + contentLength;
        }
      } else if (statusCode === 200) {
        activeFile = fs.createWriteStream(tempPath, { flags: "w" });
        totalSize = parseInt(headerValue(response.headers, "content-length"), 10) || 0;
      } else {
        response.resume();
        const err = new Error(`HTTP ${statusCode}`);
        err.isHttpError = true;
        err.statusCode = statusCode;
        fail(err);
        return;
      }

      if (attempt) attempt.openBodies++;

      // Fall back to caller-provided expected size when Content-Length is missing
      if (totalSize <= 0 && expectedSize > 0) {
        totalSize = expectedSize;
      }

      const resetStallTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          fail(
            Object.assign(new Error("Download stalled — no data received for 30s"), {
              code: "ETIMEDOUT",
            })
          );
        }, STALL_TIMEOUT_MS);
      };

      resetStallTimer();

      response.on("data", (chunk) => {
        if (signal?.aborted) {
          fail(Object.assign(new Error("Download cancelled"), { isAbort: true }));
          return;
        }
        downloadedSize += chunk.length;
        attempt?.addBytes({ in: chunk.length });
        resetStallTimer();
        emitProgress();
      });

      pipeline(response, activeFile, (err) => {
        if (settled) return;
        if (stallTimer) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
        if (signal) signal.onAbort = null;
        if (!err && attempt) {
          // The body ended: what this request received is now an exact count.
          attempt.openBodies--;
          attempt.addBytes({ in: 0 });
        }
        if (err) {
          if (signal?.aborted) {
            fail(Object.assign(new Error("Download cancelled"), { isAbort: true }));
          } else {
            fail(err);
          }
        } else if (totalSize > 0 && downloadedSize < totalSize) {
          fail(
            Object.assign(
              new Error(`Download incomplete: received ${downloadedSize} of ${totalSize} bytes`),
              { code: "ERR_DOWNLOAD_INCOMPLETE" }
            )
          );
        } else {
          settled = true;
          attempt?.settle({ outcome: "ok" });
          resolve({ downloadedSize, totalSize });
        }
      });
    });

    request.on("error", (err) => {
      if (signal?.aborted) {
        fail(Object.assign(new Error("Download cancelled"), { isAbort: true }));
      } else if (isTlsError(err)) {
        fail(
          Object.assign(new Error(`Certificate error: ${err.message}`), {
            code: "TLS_ERROR",
            isTlsError: true,
          })
        );
      } else {
        fail(err);
      }
    });

    attempt?.markDispatched();
    request.end();

    function emitProgress() {
      if (!onProgress) return;
      const now = Date.now();
      if (
        now - lastProgressUpdate >= PROGRESS_THROTTLE_MS ||
        (totalSize > 0 && downloadedSize >= totalSize)
      ) {
        lastProgressUpdate = now;
        onProgress(downloadedSize, totalSize);
      }
    }
  });
}

// Model manifests and runtime release lookups (threat model N12/N13). One
// gated ticket spans the request and the JSON read; the request is metered and
// tagged so the session backstop attributes it (and any redirect) to it.
async function fetchJson(url, options = {}) {
  const { headers, egressTask = "modelDownload", ...init } = options;
  return egress.guard({ task: egressTask, target: url }, async (ticket) => {
    const response = await egress.meteredFetch(ticket, (u, i) => net.fetch(u, i), { tag: true })(
      url,
      {
        method: "GET",
        useSessionCookies: false,
        ...init,
        headers: { "User-Agent": USER_AGENT, ...(headers || {}) },
      }
    );
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} fetching ${url}`);
      err.isHttpError = true;
      err.statusCode = response.status;
      throw err;
    }
    return response.json();
  });
}

// Every model and runtime download goes through here (threat model N12/N13).
// `egressTask` is "modelDownload" (default) or "runtimeDownload".
//
// Sealing aborts the ticket, which cancels the download through its signal
// and keeps `<dest>.tmp`, so the next unsealed run resumes it with Range. A
// user cancel still discards it. The caller hears of the seal only after the
// transport was aborted and the temp writer closed, and as interrupted: the
// server may have received the request, so it is never "nothing was sent".
async function downloadFile(url, destPath, options = {}) {
  const { egressTask = "modelDownload", ...rest } = options;
  const ticket = egress.authorize({ task: egressTask, target: url });
  const own = rest.signal ? null : createDownloadSignal();
  const signal = rest.signal ?? own.signal;
  const sealedAbort = () => ticket.signal.aborted && isSealedModeError(ticket.signal.reason);
  // downloadAttempt understands createDownloadSignal()'s { aborted, onAbort }.
  const onTicketAbort = () => {
    if (own) return own.abort();
    signal.aborted = true;
    if (typeof signal.onAbort === "function") signal.onAbort();
  };
  ticket.signal.addEventListener("abort", onTicketAbort, { once: true });
  try {
    const result = await egress.runWithTicket(ticket, () =>
      downloadFileUngated(url, destPath, {
        ...rest,
        signal,
        ticket,
        keepPartialOnAbort: sealedAbort,
      })
    );
    ticket.settle({ outcome: "ok" });
    return result;
  } catch (error) {
    if (sealedAbort()) {
      ticket.settle({ outcome: "cancelled" });
      const interrupted = ticket.signal.reason;
      if (Number.isFinite(error?.keptBytes)) interrupted.keptBytes = error.keptBytes;
      throw interrupted;
    }
    ticket.settle(
      error?.isAbort
        ? { outcome: "cancelled", errorClass: "ABORTED" }
        : { outcome: "error", errorClass: error?.isHttpError ? null : errorClassOf(error) }
    );
    throw error;
  } finally {
    ticket.signal.removeEventListener("abort", onTicketAbort);
  }
}

async function downloadFileUngated(url, destPath, options = {}) {
  const {
    onProgress,
    maxRetries = DEFAULT_MAX_RETRIES,
    signal,
    expectedSize = 0,
    ticket = null,
    keepPartialOnAbort = () => false,
  } = options;

  const tempPath = `${destPath}.tmp`;

  const remainingBytes = () =>
    fsPromises.stat(tempPath).then(
      (stats) => stats.size,
      (error) => (error.code === "ENOENT" ? 0 : null)
    );
  const discardPartial = async () => {
    try {
      await fsPromises.unlink(tempPath);
      return { keptBytes: 0, cleanupFailed: false };
    } catch (error) {
      if (error.code === "ENOENT") return { keptBytes: 0, cleanupFailed: false };
      return { keptBytes: await remainingBytes(), cleanupFailed: true };
    }
  };

  const discardCancelledDownload = async (error) => {
    // downloadAttempt rejects only after its writer closes. Never unlink earlier.
    // Sealing interrupts but keeps the partial file so the download can resume
    // with Range later; a user cancel still discards it.
    const retained = keepPartialOnAbort()
      ? { keptBytes: await remainingBytes(), cleanupFailed: false }
      : await discardPartial();
    throw Object.assign(error?.isAbort ? error : new Error("Download cancelled"), {
      isAbort: true,
      ...retained,
    });
  };

  debugLogger.info("Download starting", { url, destPath });

  let startOffset = 0;
  try {
    const stats = await fsPromises.stat(tempPath);
    if (stats.size > 0) {
      startOffset = stats.size;
      debugLogger.info("Resuming download", { startOffset });
    }
  } catch {
    // No existing temp file
  }

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      return discardCancelledDownload();
    }

    if (attempt > 0) {
      const delay = backoffDelay(attempt - 1);
      debugLogger.info("Retrying download", { attempt, delay, startOffset });
      await sleep(delay, signal);
      if (signal?.aborted) return discardCancelledDownload();

      // Update startOffset from temp file in case partial data was written
      try {
        const stats = await fsPromises.stat(tempPath);
        if (stats.size > 0) startOffset = stats.size;
      } catch {
        startOffset = 0;
      }
    }

    try {
      await downloadAttempt(url, tempPath, {
        onProgress,
        signal,
        startOffset,
        expectedSize,
        ticket,
      });

      // Atomic move to final path
      try {
        await fsPromises.rename(tempPath, destPath);
      } catch (renameError) {
        if (renameError.code === "EXDEV") {
          await fsPromises.copyFile(tempPath, destPath);
          await fsPromises.unlink(tempPath).catch(() => {});
        } else {
          throw renameError;
        }
      }

      debugLogger.info("Download complete", { destPath });
      return destPath;
    } catch (error) {
      lastError = error;

      // Stop may be acknowledged while an earlier failure awaits writer close.
      if (error.isAbort || signal?.aborted) return discardCancelledDownload(error);

      if (!isRetryable(error) || attempt >= maxRetries) {
        // Network failures preserve resumable bytes; HTTP, TLS and size failures drop them.
        if (isRetryable(error)) {
          error.keptBytes = await remainingBytes();
        } else {
          Object.assign(error, await discardPartial());
        }
        // The retained-byte stat (or discard) also yields to an accepted Stop.
        if (signal?.aborted) return discardCancelledDownload(error);
        debugLogger.error("Download failed", {
          url,
          error: error.message,
          code: error.code,
        });
        throw error;
      }

      debugLogger.warn("Download attempt failed", {
        attempt: attempt + 1,
        error: error.message,
        code: error.code,
      });
    }
  }

  debugLogger.error("Download failed after all retries", {
    url,
    error: lastError?.message,
    code: lastError?.code,
  });
  await fsPromises.unlink(tempPath).catch(() => {});
  throw lastError;
}

function createDownloadSignal() {
  const signal = { aborted: false, onAbort: null };
  return {
    signal,
    abort() {
      signal.aborted = true;
      if (typeof signal.onAbort === "function") {
        signal.onAbort();
      }
    },
  };
}

function createDownloadInProgressError(model, activeModel) {
  return Object.assign(new Error("A model is already being downloaded"), {
    code: "DOWNLOAD_IN_PROGRESS",
    details: { model, activeModel },
  });
}

async function validateFileSize(filePath, expectedSizeBytes, tolerancePercent = 10) {
  const stats = await fsPromises.stat(filePath);
  const minSize = expectedSizeBytes * (1 - tolerancePercent / 100);
  if (stats.size < minSize) {
    await fsPromises.unlink(filePath).catch(() => {});
    throw Object.assign(
      new Error(
        `Download appears corrupted: file is ${Math.round(stats.size / 1_000_000)}MB, ` +
          `expected at least ${Math.round(minSize / 1_000_000)}MB`
      ),
      { code: "ERR_FILE_TOO_SMALL" }
    );
  }
  return stats.size;
}

async function cleanupStaleDownloads(directory) {
  try {
    const entries = await fsPromises.readdir(directory);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.endsWith(".tmp") && !entry.startsWith("temp-extract-")) continue;
      const fullPath = path.join(directory, entry);
      try {
        const stats = await fsPromises.stat(fullPath);
        if (now - stats.mtimeMs > STALE_TMP_AGE_MS) {
          if (stats.isDirectory()) {
            await fsPromises.rm(fullPath, { recursive: true, force: true });
          } else {
            await fsPromises.unlink(fullPath);
          }
          debugLogger.info("Cleaned up stale download artifact", { path: fullPath });
        }
      } catch {
        // Skip files we can't stat or delete
      }
    }
  } catch {
    // Directory may not exist yet
  }
}

async function checkDiskSpace(directory, requiredBytes) {
  try {
    const stats = await fsPromises.statfs(directory);
    const availableBytes = stats.bavail * stats.bsize;
    return { ok: availableBytes >= requiredBytes, availableBytes };
  } catch {
    // statfs not supported or directory doesn't exist — skip check
    return { ok: true, availableBytes: Infinity };
  }
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

async function extractZipWindows(zipPath, destDir) {
  try {
    await runSystemTar(zipPath, destDir);
    return;
  } catch (error) {
    debugLogger.info("tar extraction failed, trying PowerShell", { error: error.message });
  }

  const command =
    `Expand-Archive -Force -LiteralPath '${escapePowerShellSingleQuoted(zipPath)}' ` +
    `-DestinationPath '${escapePowerShellSingleQuoted(destDir)}'`;

  return new Promise((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-Command", command], (psError) => {
      if (psError) reject(new Error(`Zip extraction failed: ${psError.message}`));
      else resolve();
    });
  });
}

async function extractTarGz(archivePath, destDir) {
  try {
    await runSystemTar(archivePath, destDir);
    return;
  } catch (error) {
    debugLogger.info("system tar failed, using JS extraction", { error: error.message });
  }

  const tar = require("tar");
  await tar.x({ file: archivePath, cwd: destDir });
}

function extractArchive(archivePath, destDir) {
  if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
    return extractTarGz(archivePath, destDir);
  }

  if (process.platform === "win32") {
    return extractZipWindows(archivePath, destDir);
  }

  return new Promise((resolve, reject) => {
    execFile("unzip", ["-o", archivePath, "-d", destDir], (err) => {
      if (!err) return resolve();
      debugLogger.info("system unzip failed, using JS extraction", { error: err.message });
      const unzipper = require("unzipper");
      fs.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: destDir }))
        .on("close", resolve)
        .on("error", (extractErr) =>
          reject(new Error(`Zip extraction failed: ${extractErr.message}`))
        );
    });
  });
}

async function findFile(dir, name, maxDepth = 5, depth = 0) {
  if (depth >= maxDepth) return null;
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findFile(full, name, maxDepth, depth + 1);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

async function findFiles(dir, pattern, maxDepth = 5, depth = 0) {
  if (depth >= maxDepth) return [];
  const results = [];
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFiles(full, pattern, maxDepth, depth + 1)));
    } else if (pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

module.exports = {
  downloadFile,
  fetchJson,
  createDownloadSignal,
  createDownloadInProgressError,
  validateFileSize,
  cleanupStaleDownloads,
  checkDiskSpace,
  extractArchive,
  findFile,
  findFiles,
};
