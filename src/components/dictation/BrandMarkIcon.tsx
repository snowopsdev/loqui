interface BrandMarkIconProps {
  size?: number;
  className?: string;
}
export function BrandMarkIcon({ size = 24, className }: BrandMarkIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="120" cy="112" r="57" fill="none" stroke="currentColor" strokeWidth="22" />
      <path d="M153 145L190 184L171 201L136 160Z" fill="currentColor" />
    </svg>
  );
}
