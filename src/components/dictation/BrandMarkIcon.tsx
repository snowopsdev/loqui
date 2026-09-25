import { LoquiBrand } from "../LoquiBrand";

interface BrandMarkIconProps {
  size?: number;
  className?: string;
}
export function BrandMarkIcon({ size = 24, className }: BrandMarkIconProps) {
  return <LoquiBrand size={size} className={className} decorative />;
}
