import { isSealedModeError, sealedPhase } from "./sealedModeError";

// Why a calendar connect did not connect (T11-M6). A sealed refusal or
// interruption gets its own honest copy instead of the generic "failed".
export type CalendarConnectFailure =
  "cancelled" | "denied" | "failed" | "sealedRefused" | "sealedInterrupted" | "sealedNative";

type ConnectResult = { success?: boolean; error?: string; reason?: string; code?: string } | null;

export function calendarConnectFailure(
  result: ConnectResult | undefined,
  kind: "oauth" | "apple"
): CalendarConnectFailure | null {
  if (result?.success) return null;
  if (kind === "apple") {
    // Main refuses the local EventKit helper before launch while sealed.
    if (result?.reason === "sealed") return "sealedNative";
    return result?.reason === "denied" ? "denied" : "failed";
  }
  if (isSealedModeError(result))
    return sealedPhase(result) === "interrupted" ? "sealedInterrupted" : "sealedRefused";
  // access_denied means the user cancelled on the consent screen.
  if (result?.error?.includes("access_denied")) return "cancelled";
  return "failed";
}

export const SEALED_CONNECT_COPY: Record<
  Extract<CalendarConnectFailure, `sealed${string}`>,
  string
> = {
  sealedRefused: "sealedMode.calendar.connectRefused",
  sealedInterrupted: "sealedMode.calendar.connectInterrupted",
  sealedNative: "sealedMode.calendar.appleUnavailable",
};
