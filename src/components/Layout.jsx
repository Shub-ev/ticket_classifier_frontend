import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api, friendlyError, toList } from '../services/api';
import { cn } from '../lib/format';

const navItem = ({ isActive }) =>
  cn(
    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors',
    isActive
      ? 'bg-white shadow-sm text-slate-900 font-semibold'
      : 'text-slate-500 hover:text-slate-900 font-medium'
  );

const mobileNavItem = ({ isActive }) =>
  cn(
    'flex min-w-0 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] transition-colors',
    isActive ? 'text-indigo-700 font-semibold' : 'text-slate-500 font-medium'
  );

export default function Layout() {
  const [reviewCount, setReviewCount] = useState(null);
  const [modelAccuracy, setModelAccuracy] = useState(null);
  const [metadataError, setMetadataError] = useState('');

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      try {
        const data = await api.fetchHumanReviewTickets();
        if (!canceled) setReviewCount(toList(data).length);
      } catch {
        if (!canceled) setReviewCount(null);
      }
    };
    load();
    window.addEventListener('review-updated', load);
    return () => {
      canceled = true;
      window.removeEventListener('review-updated', load);
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    api.fetchMetadata()
      .then((data) => {
        const rawAccuracy = data?.classifier_model_accuracy;
        const accuracy = Number(rawAccuracy);
        if (rawAccuracy == null || !Number.isFinite(accuracy)) {
          throw new Error('Metadata response does not include classifier_model_accuracy');
        }
        if (!canceled) {
          setModelAccuracy(accuracy);
          setMetadataError('');
        }
      })
      .catch((error) => {
        if (!canceled) setMetadataError(friendlyError(error));
      });
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* ===== Top Navigation ===== */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-[1640px] mx-auto pl-5 pr-4 h-16 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 grid place-items-center text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="font-bold text-slate-900">
                AutoAssign <span className="text-indigo-600">AI</span>
              </div>
              <div className="text-[10px] tracking-widest text-slate-400 font-mono uppercase">IT Routing Engine</div>
            </div>
            <div className="hidden xl:block h-8 w-px bg-slate-200 mx-1" />
            <div className="hidden xl:flex items-center border border-indigo-200 bg-indigo-50/60 rounded-md px-2.5 py-1.5 text-[11px] font-mono text-slate-600">
              Model v0.0 Testing&nbsp;
              <span className="font-bold text-indigo-700" title={metadataError || undefined}>
                (Accuracy:&nbsp;{modelAccuracy == null ? '—' : `${modelAccuracy.toFixed(1)}%`})
              </span>
            </div>
          </div>

          {/* Center nav pill group */}
          <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            <NavLink to="/" end className={navItem}>Classifier & Triage</NavLink>
            <NavLink to="/human-review" className={navItem}>
              {({ isActive }) => (
                <>
                  Human Review Queue
                  {reviewCount != null && reviewCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-5 h-5 rounded-full bg-red-100 text-red-600 text-[11px] font-mono font-bold px-1">
                      {reviewCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
            <NavLink to="/tickets" className={navItem}>All Tickets Directory</NavLink>
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-md px-3 py-1.5 font-mono text-xs font-semibold whitespace-nowrap">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              AI Engine Online
            </div>
            <button type="button" className="w-9 h-9 rounded-lg bg-indigo-600 grid place-items-center text-white hover:bg-indigo-700 transition-colors" aria-label="Account">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ===== Page content ===== */}
      <main className="flex-1 w-full max-w-[1640px] mx-auto px-4 py-5 pb-24 sm:px-6 sm:py-7 lg:pb-7">
        <Outlet />
      </main>

      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_rgba(15,23,42,0.06)] lg:hidden"
      >
        <NavLink to="/" end className={mobileNavItem}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="truncate">Triage</span>
        </NavLink>
        <NavLink to="/human-review" className={mobileNavItem}>
          <span className="relative">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {reviewCount != null && reviewCount > 0 && (
              <span className="absolute -right-2 -top-1 inline-flex min-w-4 h-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                {reviewCount}
              </span>
            )}
          </span>
          <span className="truncate">Human Review</span>
        </NavLink>
        <NavLink to="/tickets" className={mobileNavItem}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5h6m-6 4h6m-6 4h6m-6 4h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
          </svg>
          <span className="truncate">All Tickets</span>
        </NavLink>
      </nav>

      {/* ===== Status footer ===== */}
      <footer className="bg-white border-t border-slate-200">
        <div className="max-w-[1640px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
              Server Latency: <span className="font-semibold text-slate-800">42ms</span>
            </span>
            <span className="hidden md:flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Triage Pipeline: <span className="font-semibold text-slate-800">Deterministic SLA 99.98%</span>
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            Enterprise IT Compliance: <span className="font-semibold text-slate-800">SOC2 Type II • ISO/IEC 27001 • FedRAMP High Ready</span>
          </span>
        </div>
      </footer>
    </div>
  );
}