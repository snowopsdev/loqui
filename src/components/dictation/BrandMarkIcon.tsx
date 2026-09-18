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
      <path
        d="M178 87C158 54 117 48 85 72C49 99 48 145 76 172C105 200 153 188 173 155C185 135 187 107 178 87Z M151 145C173 154 169 178 189 190C202 199 215 197 226 186 M101 115V136 M124 101V149 M147 116V133"
        stroke="currentColor"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
