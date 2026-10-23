/**
 * Writes text to the clipboard and reports whether it really landed (R2-I3).
 * The Electron bridge must answer `{ success: true }`. A rejection, a
 * `{ success: false }`, or no bridge at all (Browser Preview supplies only a
 * subset of the API) falls back to the web Clipboard API where it exists.
 * Never reports a copy it cannot see.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text.trim()) return false;
  const bridge = globalThis.window?.electronAPI?.writeClipboard;
  if (typeof bridge === "function") {
    try {
      const result = await bridge(text);
      if (result?.success === true) return true;
    } catch {
      // Fall through to the web Clipboard API.
    }
  }
  const web = globalThis.navigator?.clipboard;
  if (typeof web?.writeText !== "function") return false;
  try {
    await web.writeText(text);
    return true;
  } catch {
    return false;
  }
}
