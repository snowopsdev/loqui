import { cn } from "../lib/utils";

function getInitial(displayName: string | null, email: string | null): string {
  return (displayName || email || "?").charAt(0).toUpperCase();
}

function getInitialColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 45%, 65%)`;
}

interface PersonAvatarProps {
  email: string | null;
  displayName: string | null;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/** Local initials only: rendering a contact never contacts an avatar service. */
export default function PersonAvatar({
  email,
  displayName,
  size = 24,
  className,
}: PersonAvatarProps) {
  return (
    <span
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.42)),
        backgroundColor: getInitialColor(email || displayName || "?"),
      }}
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center font-medium text-white",
        className
      )}
    >
      {getInitial(displayName, email)}
    </span>
  );
}
