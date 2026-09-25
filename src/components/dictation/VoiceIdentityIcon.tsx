import { cn } from "../lib/utils";
import { LoquiBrand } from "../LoquiBrand";
import { AGENT_MODE_PATH } from "./agentMark";

interface VoiceIdentityIconProps {
  size?: number;
  agentMode?: boolean;
  className?: string;
}

/** Keep both identities in one stable box; preserve the supplied artwork. */
export function VoiceIdentityIcon({
  size = 24,
  agentMode = false,
  className,
}: VoiceIdentityIconProps) {
  return (
    <span
      className={cn("voice-identity-icon relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      data-agent-mode={agentMode ? "true" : "false"}
      aria-hidden="true"
    >
      <LoquiBrand size={size} decorative className="voice-identity-listening absolute inset-0" />
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="currentColor"
        className="voice-identity-agent absolute inset-0 overflow-visible"
        aria-hidden="true"
      >
        <path className="voice-identity-final-agent" d={AGENT_MODE_PATH} />
      </svg>
    </span>
  );
}
