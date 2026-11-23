export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#c6ff3d" />
      <g fill="#0a0d02">
        <rect x="12" y="26" width="5" height="12" rx="2.5" />
        <rect x="20.5" y="18" width="5" height="28" rx="2.5" />
        <rect x="29.5" y="11" width="5" height="42" rx="2.5" />
        <rect x="38.5" y="20" width="5" height="24" rx="2.5" />
        <rect x="47" y="27" width="5" height="10" rx="2.5" />
      </g>
    </svg>
  );
}
