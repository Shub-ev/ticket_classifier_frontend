import { cn } from '../lib/format';

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export function Badge({ tone = 'slate', className = '', children }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-mono font-bold whitespace-nowrap', TONES[tone] || TONES.slate, className)}>
      {children}
    </span>
  );
}

export function Spinner({ className = '' }) {
  return (
    <svg className={cn('animate-spin h-4 w-4', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
      <div className="flex items-start gap-2.5">
        <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span className="font-medium">{message}</span>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 border border-red-300 bg-white rounded-md px-3 py-1.5 text-xs font-mono font-semibold hover:bg-red-100 transition-colors">
          Retry
        </button>
      )}
    </div>
  );
}

/** Small confirm/inspect modal shell */
export function Modal({ onClose, title, badges, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn('relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-h-[85vh] overflow-y-auto', wide ? 'max-w-3xl' : 'max-w-xl')}>
        <div className="sticky top-0 bg-white flex items-center gap-3 px-5 py-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-900 truncate">{title}</h3>
          {badges}
          <button type="button" onClick={onClose} className="ml-auto shrink-0 text-slate-400 hover:text-slate-700 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bottom-right transient toast */
export function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className={cn(
      'fixed bottom-6 right-6 z-[60] max-w-sm flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg bg-white',
      toast.tone === 'error' ? 'border-red-200 text-red-700' : 'border-emerald-200 text-emerald-700'
    )}>
      <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {toast.tone === 'error'
          ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />}
      </svg>
      <span className="font-medium">{toast.msg}</span>
      <button type="button" onClick={onDismiss} className="ml-auto text-slate-300 hover:text-slate-500" aria-label="Dismiss">✕</button>
    </div>
  );
}
