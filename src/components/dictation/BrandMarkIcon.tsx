import { Mic } from "../icons";

interface BrandMarkIconProps {
  size?: number;
  className?: string;
}
export function BrandMarkIcon({ size = 24, className }: BrandMarkIconProps) {
  return <Mic size={size} strokeWidth={1.9} className={className} aria-hidden="true" />;
}
