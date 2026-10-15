export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <circle cx={9} cy={9} r={3} fill="#ededed" />
      <circle cx={9} cy={9} r={7.5} fill="none" stroke="#5a5a5a" />
      <circle cx={14.3} cy={3.7} r={1.4} fill="#ededed" />
    </svg>
  );
}
