import mark from "../assets/brand/mark.png";
import logoLight from "../assets/brand/logo-light.png";
import logoDark from "../assets/brand/logo-dark.png";
import { cn } from "./lib/utils";

interface LoquiBrandProps {
  variant?: "mark" | "wordmark";
  size?: number;
  decorative?: boolean;
  className?: string;
}

/** The supplied artwork, with one accessible name when it stands alone. */
export function LoquiBrand({
  variant = "mark",
  size = 32,
  decorative = false,
  className,
}: LoquiBrandProps) {
  return (
    <span
      className={cn("inline-flex shrink-0 align-middle", className)}
      style={{ width: variant === "wordmark" ? 100 : size, height: size }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Loqui"}
      aria-hidden={decorative || undefined}
    >
      {variant === "wordmark" ? (
        <>
          <img
            src={logoLight}
            alt=""
            draggable={false}
            className="block h-full w-full object-contain dark:hidden"
          />
          <img
            src={logoDark}
            alt=""
            draggable={false}
            className="hidden h-full w-full object-contain dark:block"
          />
        </>
      ) : (
        <img src={mark} alt="" draggable={false} className="block h-full w-full object-contain" />
      )}
    </span>
  );
}
