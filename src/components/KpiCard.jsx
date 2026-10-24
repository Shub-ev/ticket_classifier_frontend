import { cn } from '../lib/format';

export default function KpiCard({ label, value, valueClass = 'text-slate-900', sub, subClass, icon, bar, barTone }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        {icon}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn('text-4xl font-extrabold tracking-tight', valueClass)}>{value}</span>
        {bar && <span className="font-mono text-xs font-bold text-slate-500">{bar}</span>}
      </div>
      {sub && <div className={cn('mt-1 font-mono text-[11px]', subClass || 'text-slate-500')}>{sub}</div>}
      {bar && (
        <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-700', barTone)}
            style={{ width: `${Math.min(100, Math.max(2, parseFloat(String(bar)) || 0))}%` }}
          />
        </div>
      )}
    </div>
  );
}
