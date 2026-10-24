export default function ConfidenceDonut({ value }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="relative w-36 h-36">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="45" fill="none" stroke="#e2e8f0" strokeWidth="9" />
        <circle
          cx="50" cy="50" r="45" fill="none" stroke="#4f46e5" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={282.74}
          strokeDashoffset={282.74 * (1 - pct / 100)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[22px] leading-6 font-extrabold font-mono text-slate-900">{value != null ? `${Number(value).toFixed(2)}%` : '—'}</div>
          <div className="text-[9px] font-mono tracking-widest text-slate-500 mt-0.5">CONFIDENCE</div>
        </div>
      </div>
    </div>
  );
}
