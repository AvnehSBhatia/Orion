export function MapLegend() {
  const items = [
    { label: "On track", mark: <circle cx={6} cy={6} r={5} fill="#ededed" /> },
    {
      label: "At risk",
      mark: (
        <>
          <circle cx={6} cy={6} r={4.5} fill="none" stroke="#ededed" strokeWidth={1.25} />
          <circle cx={6} cy={6} r={2} fill="#ededed" />
        </>
      ),
    },
    {
      label: "Blocked",
      mark: <circle cx={6} cy={6} r={4.5} fill="none" stroke="#ededed" strokeWidth={1.25} strokeDasharray="2 2" />,
    },
    { label: "Done", mark: <circle cx={6} cy={6} r={5} fill="#4a4a4a" /> },
  ];
  return (
    <ul className="flex flex-col gap-1.5 font-mono text-[11px] tracking-wide text-faint uppercase">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <svg width={12} height={12} aria-hidden>
            {item.mark}
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
