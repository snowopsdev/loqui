import type { TFunction } from "i18next";
import { sealedFailureMessage } from "./sealedModeError";

// The message a failed model, runtime or support download shows. A sealed
// failure is translated copy by phase (final review I6); main's text, with its
// [SEALED_MODE…] marker, never reaches "Download failed: …".
export function getDownloadErrorMessage(
  t: TFunction | ((key: string, params?: Record<string, unknown>) => string),
  error: string,
  code?: string,
  phase?: string
): string {
  const tr = t as (key: string, params?: Record<string, unknown>) => string;
  const sealed = sealedFailureMessage({ error, code, phase }, tr);
  if (sealed) return sealed;
  if (code === "EXTRACTION_FAILED" || error.includes("installation failed")) {
    return tr("hooks.modelDownload.errors.extractionFailed");
  }
  if (code === "TLS_ERROR" || error.includes("certificate") || error.includes("issuer")) {
    return tr("hooks.modelDownload.errors.tlsError");
  }
  if (code === "ETIMEDOUT" || error.includes("timeout") || error.includes("stalled")) {
    return tr("hooks.modelDownload.errors.timeout");
  }
  if (code === "ENOTFOUND" || error.includes("ENOTFOUND")) {
    return tr("hooks.modelDownload.errors.notFound");
  }
  if (error.includes("disk space")) return error;
  if (error.includes("corrupted") || error.includes("incomplete") || error.includes("too small")) {
    return tr("hooks.modelDownload.errors.corrupted");
  }
  if (error.includes("HTTP 429") || error.includes("rate limit")) {
    return tr("hooks.modelDownload.errors.rateLimited");
  }
  if (error.includes("HTTP 4") || error.includes("HTTP 5")) {
    return tr("hooks.modelDownload.errors.server", { error });
  }
  return tr("hooks.modelDownload.errors.generic", { error });
}
