import { useEffect, useMemo, useState } from 'react';
import { api, friendlyError, ticketCandidates } from '../services/api';
import { useAssignedTickets, useHumanReviewTickets, useAssignmentGroups } from '../hooks/useTickets';
import { Badge, ErrorBanner, Modal, Spinner, Toast } from '../components/ui';
import { cn, confBar, confBadge, ticketLabel, timeAgo } from '../lib/format';

const PAGE_SIZE = 10;

const STATUS_PILL = {
  assigned: { tone: 'emerald', label: '✓ Passed' },
  failed: { tone: 'red', label: '✗ Failed' },
  pending: { tone: 'blue', label: '● Pending Triage' },
};

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function FilterChip({ icon, label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-2 border border-slate-200 bg-white rounded-lg px-2.5 py-2 text-sm">
      {icon}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-slate-700 font-medium focus:outline-none pr-1 max-w-[150px]"
      >
        {options.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
      </select>
      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
    </div>
  );
}

export default function AllTickets() {
  const { items: assigned, loading: lA, error: eA, refetch: rfA } = useAssignedTickets();
  const { items: review, loading: lR, error: eR, refetch: rfR } = useHumanReviewTickets();
  const { items: registry, loading: lG, error: eG } = useAssignmentGroups();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [confFilter, setConfFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [inspect, setInspect] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [modalGroup, setModalGroup] = useState('');
  const [toast, setToast] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  /* merged dataset: assigned first (state: assigned/failed), then pending review tickets */
  const dataset = useMemo(() => {
    const assignedRows = assigned.map((t) => ({
      ...t,
      state: t.expected_group && t.assignment_group && t.assignment_group !== t.expected_group ? 'failed' : 'assigned',
    }));
    const pendingRows = review.map((t) => ({ ...t, state: 'pending' }));
    return [...assignedRows, ...pendingRows];
  }, [assigned, review]);

  const groupOptions = useMemo(
    () => Array.from(new Set(dataset.map((t) => t.assignment_group).filter(Boolean))).sort(),
    [dataset]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dataset.filter((t) => {
      if (q) {
        const hay = `${t.id} ${t.short_description} ${t.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'all' && t.state !== statusFilter) return false;
      if (groupFilter !== 'all' && t.assignment_group !== groupFilter) return false;
      if (confFilter === 'high' && !((t.confidence ?? 0) >= 90)) return false;
      if (confFilter === 'mid' && !(t.confidence != null && t.confidence >= 70 && t.confidence < 90)) return false;
      if (confFilter === 'low' && !(t.confidence == null || t.confidence < 70)) return false;
      return true;
    });
  }, [dataset, query, statusFilter, groupFilter, confFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [query, statusFilter, groupFilter, confFilter]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const error = eA || eR || eG;
  const loading = lA || lR;

  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.all([rfA(), rfR()]);
    window.dispatchEvent(new Event('review-updated'));
    setRefreshing(false);
  };

  /* ----- KPI derivation ----- */
  const total = dataset.length;
  const passed = dataset.filter((t) => t.state === 'assigned').length;
  const pending = dataset.filter((t) => t.state === 'pending').length;
  const failed = dataset.filter((t) => t.state === 'failed').length;
  const pct = (n) => (total ? `${((n / total) * 100).toFixed(1)}%` : '0.0%');
  const benchmarkAccuracy = passed + failed > 0 ? (passed / (passed + failed)) * 100 : 0;

  const clearFilters = () => { setQuery(''); setStatusFilter('all'); setGroupFilter('all'); setConfFilter('all'); };

  const handleExportJSON = () => {
    download('triage_tickets.json', JSON.stringify(dataset, null, 2), 'application/json');
  };
  const handleExportCSV = () => {
    const headers = ['id', 'short_description', 'description', 'expected_group', 'assignment_group', 'confidence', 'created_at', 'status'];
    const rows = dataset.map((t) => [t.id, t.short_description, t.description, t.expected_group, t.assignment_group, t.confidence, t.created_at, t.state]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
    download('triage_tickets.csv', csv, 'text/csv');
  };

  /* ----- Inspect modal assign ----- */
  const modalTicket = inspect ? dataset.find((t) => t.id === inspect) : null;
  useEffect(() => { setModalGroup(''); }, [inspect]);

  const handleModalAssign = async () => {
    if (!modalTicket || !modalGroup) return;
    setAssigning(true);
    try {
      await api.assignTicket(modalTicket.id, modalGroup);
      setToast({ tone: 'success', msg: `INC-${modalTicket.id} assigned to "${modalGroup}".` });
      setInspect(null);
      await Promise.all([rfA(), rfR()]);
      window.dispatchEvent(new Event('review-updated'));
    } catch (err) {
      setToast({ tone: 'error', msg: friendlyError(err) });
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="text-left space-y-5">
      {/* ===== Header ===== */}
      <div>
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span className="bg-slate-100 border border-slate-200 text-slate-600 rounded px-2 py-0.5 font-bold tracking-wide uppercase">Telemetry & Audit</span>
          <span className="text-slate-400">Batch No: <b className="text-slate-700">BD-FINAL-2026-0387-BC</b></span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">All Tickets Directory & AI Performance Audit</h1>
            <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
              Comprehensive directory of <b className="text-slate-700">{total} tickets</b> ({passed} Auto-Allocated, {pending} Human Reviewed,{' '}
              {failed} Failed) with full prediction probabilities, confidence metrics, and assignment status.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button type="button" onClick={handleExportJSON} className="inline-flex items-center gap-1.5 border border-slate-200 bg-white rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5m-5 5V3" /></svg>
              Export JSON
            </button>
            <button type="button" onClick={handleExportCSV} className="inline-flex items-center gap-1.5 border border-slate-200 bg-white rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5m-5 5V3" /></svg>
              Export CSV
            </button>
            <button type="button" onClick={refreshAll} disabled={refreshing} className="inline-flex items-center gap-1.5 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded-lg px-3.5 py-2 text-sm font-semibold hover:bg-indigo-100 disabled:opacity-60 transition-colors">
              {refreshing ? <Spinner className="w-4 h-4 text-indigo-600" /> : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              )}
              Return Evaluation Batch
            </button>
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={refreshAll} />}

      {/* ===== KPI row ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard label="Total Processed" value={loading ? '…' : total} icon={<IconMonitor className="text-slate-500" />} sub={<span><b className="text-slate-800 text-xs">{total}</b> Indexed Records</span>} />
        <KpiCard label="Auto-Allocated (Passed)" value={passed} icon={<IconChart className="text-emerald-600" />} bar={pct(passed)} barTone="bg-emerald-600" />
        <KpiCard label="Human Review Queue" value={pending} icon={<IconClipboard className="text-slate-500" />} bar={pct(pending)} barTone="bg-sky-500" />
        <KpiCard label="Misclassifications" value={failed} valueClass={cn(failed > 0 && 'text-red-600')} icon={<IconWarn className="text-red-500" />} bar={pct(failed)} barTone="bg-red-500" />
        <KpiCard label="Benchmark Accuracy" value={`${benchmarkAccuracy.toFixed(2)}%`} valueClass="text-emerald-600" icon={<IconCheck className="text-emerald-600" />} sub={<span><span className="text-emerald-600 font-semibold">↑ +1.2%</span> vs v3.3 Baseline</span>} />
      </div>

      {/* ===== Filter bar ===== */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex-1 min-w-[260px] relative">
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ticket id, ID, e.g. INC-2041, software, keywords..."
            className="w-full border border-slate-200 bg-white rounded-lg pl-9 pr-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition"
          />
        </div>
        <FilterChip
          icon={<svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707L14 14v5l-4 1v-6L4.293 7.293A1 1 0 014 6.586V4z" /></svg>}
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[['all', `Status: All (${total})`], ['assigned', 'Auto-Allocated'], ['pending', 'Pending Triage'], ['failed', 'Failed']]}
        />
        <FilterChip
          icon={<svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}
          label="Group"
          value={groupFilter}
          onChange={setGroupFilter}
          options={[['all', 'Assigned: All Groups'], ...groupOptions.map((g) => [g, g])]}
        />
        <FilterChip
          icon={<svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12v.01M12 6v.01M12 18v.01M4 12h.01M20 12h.01M6.3 6.3h.01M17.7 6.3h.01M6.3 17.7h.01M17.7 17.7h.01" /></svg>}
          label="Confidence"
          value={confFilter}
          onChange={setConfFilter}
          options={[['all', 'Confidence: All'], ['high', 'High ≥ 90%'], ['mid', 'Mid 70–90%'], ['low', 'Low < 70%']]}
        />
        <button type="button" onClick={clearFilters} className="text-sm font-medium text-slate-500 hover:text-indigo-600 px-2 py-2 transition-colors">Clear</button>
      </div>

      {/* ===== Meta line ===== */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500 px-0.5">
        <span className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
          Showing <b className="text-slate-800">{pageItems.length}</b> of <b className="text-slate-800">{filtered.length}</b> records · Interspersed AI Confidence audit data
        </span>
        <span className="flex items-center gap-1.5 text-indigo-600 font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" /> LIVE AUDIT FEED SYNCHRONIZED
        </span>
      </div>

      {/* ===== Directory table ===== */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden" style={{ height: '610px', overflowY: 'auto' }}>
        <table className="w-full text-left min-w-[1150px]">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
            <tr>
              {['TICKET ID & SUBJECT', 'EXPECTED GROUP', 'ALLOCATED GROUP', 'CONFIDENCE SCORE', 'TOP 3 POSSIBILITIES', 'ROUTE TYPE', 'STATUS', 'ACTION'].map((h) => (
                <th key={h} className="px-4 py-3 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-slate-400"><span className="inline-flex items-center gap-2"><Spinner /> loading directory…</span></td></tr>
            )}
            {!loading && pageItems.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-16 text-center text-sm text-slate-400">{total === 0 ? 'No tickets found — submit one from the Classifier & Triage dashboard.' : 'No tickets match the current filters.'}</td></tr>
            )}
            {!loading && pageItems.map((t) => {
              const b = confBadge(t.confidence);
              const badge = STATUS_PILL[t.state];
              const candidates = ticketCandidates(t);
              return (
                <tr key={`${t.id}-${t.state}`} className="hover:bg-slate-50/70 transition-colors align-top">
                  <td className="px-4 py-3.5">
                    <div className="font-mono text-xs font-bold text-indigo-700">{t.id ? ticketLabel(t.id) : '—'}</div>
                    <div className="text-xs text-slate-500 mt-0.5 max-w-[240px] truncate" title={t.short_description}>{t.short_description || '—'}</div>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-slate-600 max-w-[130px]">{t.expected_group ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3.5 text-xs max-w-[130px]">
                    {t.state === 'pending'
                      ? <span className="text-slate-400 italic">Pending Triage</span>
                      : <span className={cn(t.state === 'failed' && 'text-red-600 font-semibold', 'text-slate-700')}>{t.assignment_group ?? <span className="text-slate-300">—</span>}</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0">
                        <div className={cn('h-full rounded-full', confBar(t.confidence))} style={{ width: `${Math.min(100, t.confidence ?? 0)}%` }} />
                      </div>
                      <span className="font-mono text-xs font-bold text-slate-700">{t.confidence != null ? `${t.confidence.toFixed(1)}` : '—'}</span>
                      {t.confidence != null && <Badge tone={b.tone} className="ml-0.5">{b.label}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="space-y-1">
                      <Row1 candidates={candidates} predicted={t.predicted_group} />
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {t.state === 'pending'
                      ? <Badge tone="blue">⤳ Manual Review</Badge>
                      : <span className="font-mono text-[11px] text-slate-600 flex items-center gap-1"><svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Auto</span>}
                  </td>
                  <td className="px-4 py-3.5"><Badge tone={badge.tone}>{badge.label}</Badge></td>
                  <td className="px-4 py-3.5">
                    <button type="button" onClick={() => setInspect(t.id)} className="font-mono text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline transition-colors">
                      ◎ Inspect
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ===== Pagination ===== */}
      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
        <span>Showing <b className="text-slate-800">{pageItems.length}</b> of <b className="text-slate-800">{filtered.length}</b> records in viewport</span>
        <div className="flex items-center gap-2 font-sans">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="border border-slate-200 bg-white rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">Prev</button>
          <span className="bg-indigo-600 text-white rounded-md px-2.5 py-1.5 text-xs font-semibold min-w-8 text-center">{page}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="border border-slate-200 bg-white rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">Next</button>
        </div>
      </div>

      {/* ===== Inspect modal ===== */}
      {modalTicket && (
        <Modal
          wide
          onClose={() => setInspect(null)}
          title={`INC-${modalTicket.id} — Ticket Inspector`}
          badges={<Badge tone={STATUS_PILL[modalTicket.state].tone}>{STATUS_PILL[modalTicket.state].label}</Badge>}
        >
          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Field label="Short Description" value={modalTicket.short_description} className="sm:col-span-2" />
              <Field label="Detailed Description / Payload" value={modalTicket.description} className="sm:col-span-2" multiline />
              <Field label="Expected Group" value={modalTicket.expected_group ?? '—'} />
              <Field label="Allocated Group" value={modalTicket.assignment_group ?? '— pending review —'} />
              <Field label="Model Confidence" value={modalTicket.confidence != null ? `${modalTicket.confidence.toFixed(2)}%` : '—'} />
              <Field label="Created" value={modalTicket.created_at ? timeAgo(modalTicket.created_at) : '—'} />
            </div>

            <details>
              <summary className="font-mono text-[11px] font-bold text-slate-500 uppercase tracking-widest cursor-pointer select-none">Raw ticket JSON</summary>
              <pre className="mt-2 max-h-56 overflow-auto text-[11px] leading-relaxed bg-slate-900 text-emerald-300 rounded-lg p-3">{JSON.stringify(modalTicket, null, 2)}</pre>
            </details>

            {modalTicket.state === 'pending' && (
              <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4">
                <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600 mb-2">Quick Assignment</div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <select
                      value={modalGroup}
                      onChange={(e) => setModalGroup(e.target.value)}
                      disabled={lG || registry.length === 0}
                      className="appearance-none bg-white border border-slate-300 rounded-lg px-3 py-2 pr-8 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 disabled:opacity-60"
                    >
                      <option value="">{lG ? 'Loading groups…' : registry.length === 0 ? 'No groups available' : '— Select group —'}</option>
                      {registry.map((g) => (<option key={g} value={g}>{g}</option>))}
                    </select>
                    <svg className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                  <button
                    type="button"
                    onClick={handleModalAssign}
                    disabled={assigning || !modalGroup}
                    className="inline-flex items-center gap-2 bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {assigning ? <Spinner /> : null}
                    Assign to Group
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function Row1({ candidates, predicted }) {
  if (candidates.length === 0) {
    // API may not expose candidate distribution — fall back to the primary prediction
    return (
      <span className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 font-mono text-slate-500 max-w-[150px] truncate inline-block">
        {predicted ?? '—'}
      </span>
    );
  }
  return candidates.slice(0, 3).map((c, i) => (
    <div key={`${c.name}-${i}`} className="flex items-center gap-1.5 max-w-[170px]">
      <span className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 font-mono text-slate-600 truncate flex-1">{c.name || `#${i + 1}`}</span>
      {c.prob != null && <span className="text-[9px] font-mono text-slate-400">{Number(c.prob).toFixed(1)}</span>}
    </div>
  ));
}

function Field({ label, value, multiline = false, className = '' }) {
  return (
    <div className={className}>
      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <div className={cn('mt-1 text-sm text-slate-700 leading-relaxed', multiline && 'font-mono text-xs whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded-lg p-3')}>{value || '—'}</div>
    </div>
  );
}

function KpiCard({ label, value, valueClass = 'text-slate-900', sub, icon, bar, barTone }) {
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
      {sub && <div className="mt-1 font-mono text-[11px] text-slate-500">{sub}</div>}
      {bar && (
        <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all duration-700', barTone)} style={{ width: bar }} />
        </div>
      )}
    </div>
  );
}

function IconMonitor({ className = '' }) {
  return <svg className={cn('w-4 h-4', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V9m3 8V5m3 12v-5m4 5H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2z" /></svg>;
}
function IconChart({ className = '' }) {
  return <svg className={cn('w-4 h-4', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconClipboard({ className = '' }) {
  return <svg className={cn('w-4 h-4', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
}
function IconWarn({ className = '' }) {
  return <svg className={cn('w-4 h-4', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
}
function IconCheck({ className = '' }) {
  return <svg className={cn('w-4 h-4', className)} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>;
}