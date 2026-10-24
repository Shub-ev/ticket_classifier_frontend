import { useEffect, useMemo, useState } from 'react';
import { api, friendlyError, ticketCandidates } from '../services/api';
import { useAssignmentGroups, useHumanReviewTickets } from '../hooks/useTickets';
import { Badge, ErrorBanner, Spinner, Toast } from '../components/ui';
import { cn, confBar, ticketLabel, timeAgo } from '../lib/format';

/* Urgency derivation: priority field if present, else from confidence */
function urgencyOf(t) {
  if (t.priority) {
    const p = String(t.priority).toUpperCase();
    if (p.includes('CRIT') || p === '1') return { label: 'CRITICAL', cls: 'text-red-600 font-bold' };
    if (p.includes('MED') || p === '2') return { label: 'MEDIUM', cls: 'text-sky-600 font-bold' };
    return { label: p, cls: 'text-red-600 font-bold' };
  }
  const c = t.confidence ?? 0;
  if (c < 50) return { label: 'CRITICAL', cls: 'text-red-600 font-bold' };
  if (c < 75) return { label: 'HIGH', cls: 'text-red-500 font-bold' };
  return { label: 'MEDIUM', cls: 'text-sky-600 font-bold' };
}

export default function HumanReview() {
  const { items: tickets, loading, error, refetch } = useHumanReviewTickets();
  const { items: groups } = useAssignmentGroups();

  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ group: '', justification: '' });
  const [assigning, setAssigning] = useState(false);
  const [batching, setBatching] = useState(false);
  const [confFilter, setConfFilter] = useState('all');
  const [sortByUrgency, setSortByUrgency] = useState(false);
  const [toast, setToast] = useState(null);

  /* Confidence filter (client-side) */
  const visible = useMemo(() => {
    let list = tickets;
    if (confFilter === 'high') list = list.filter((t) => (t.confidence ?? 0) >= 80);
    else if (confFilter === 'med') list = list.filter((t) => t.confidence != null && t.confidence >= 50 && t.confidence < 80);
    else if (confFilter === 'low') list = list.filter((t) => t.confidence == null || t.confidence < 50);
    if (sortByUrgency) list = [...list].sort((a, b) => (a.confidence ?? 100) - (b.confidence ?? 100));
    return list;
  }, [tickets, confFilter, sortByUrgency]);

  /* Auto-select first ticket; if the selected one was just assigned, fall forward */
  useEffect(() => {
    if (visible.length === 0) {
      if (tickets.length === 0) setSelectedId(null);
      return;
    }
    if (!selectedId || !tickets.some((t) => t.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [tickets, visible, selectedId]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  /* Reset the resolution form whenever the selected ticket changes */
  useEffect(() => {
    const fallback = selected?.predicted_group && groups.includes(selected.predicted_group) ? selected.predicted_group : '';
    setForm({ group: fallback, justification: '' });
  }, [selectedId, selected?.predicted_group, groups]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  /* ----- Assign current ticket ----- */
  const handleAssign = async () => {
    if (!selected) return;
    if (!form.group) {
      setToast({ tone: 'error', msg: 'Target Support Group is mandatory — pick a group from the registry.' });
      return;
    }
    setAssigning(true);
    try {
      await api.assignTicket(selected.id, form.group);
      setToast({ tone: 'success', msg: `${ticketLabel(selected.id)} assigned to "${form.group}". Queue resolved.` });
      await refetch();
      window.dispatchEvent(new Event('review-updated'));
    } catch (err) {
      setToast({ tone: 'error', msg: friendlyError(err) });
    } finally {
      setAssigning(false);
    }
  };

  /* ----- Batch auto-approve everything ≥75% to its top model candidate ----- */
  const eligible = tickets.filter((t) => (t.confidence ?? 0) >= 75 && t.predicted_group);
  const handleBatch = async () => {
    if (eligible.length === 0) {
      setToast({ tone: 'error', msg: 'No eligible tickets above 75% confidence.' });
      return;
    }
    setBatching(true);
    try {
      const results = await Promise.allSettled(eligible.map((t) => api.assignTicket(t.id, t.predicted_group)));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      setToast({ tone: ok ? 'success' : 'error', msg: failed ? `Auto-approve finished: ${ok} assigned, ${failed} failed.` : `${ok} tickets auto-approved to their top model candidates.` });
      await refetch();
      window.dispatchEvent(new Event('review-updated'));
    } catch (err) {
      setToast({ tone: 'error', msg: friendlyError(err) });
    } finally {
      setBatching(false);
    }
  };

  /* ----- Discrepancy note (API-provided or heuristically generated) ----- */
  const selectedCandidates = selected ? ticketCandidates(selected).slice(0, 3) : [];
  const discrepancyNote = (t) =>
    t.discrepancy_note ||
    `Low model certainty: "${t.short_description || 'ticket'}" spans competing routing candidates while confidence ${(t.confidence ?? 0).toFixed(2)}% sits below the 80% SLA threshold, yielding inconclusive convergence.`;

  return (
    <div className="text-left">
      {/* ===== Header band ===== */}
      <div className="flex items-center gap-2 text-[11px] font-mono">
        <span className="bg-red-50 border border-red-200 text-red-600 rounded px-2 py-0.5 font-bold tracking-wide">Triage Threshold &lt; 80%</span>
        <span className="text-slate-300">•</span>
        <span className="text-slate-500 tracking-wider uppercase">Supervised ML Discrepancy Stream</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Human Review & Exception Handling Queue</h1>
        <span className="bg-indigo-100 text-indigo-700 rounded-lg px-2.5 py-1 text-sm font-mono font-semibold">
          {tickets.length} Pending Tickets
        </span>
      </div>

      {/* Header action cluster */}
      <div className="mt-4 flex flex-wrap items-center gap-3 justify-end">
        <div className="flex items-center gap-2 border border-slate-200 bg-white rounded-lg px-3 py-2 text-sm text-slate-600">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707L14 14v5l-4 1v-6L4.293 7.293A1 1 0 014 6.586V4z" /></svg>
          <select value={confFilter} onChange={(e) => setConfFilter(e.target.value)} className="bg-transparent text-sm text-slate-700 focus:outline-none">
            <option value="all">Filter by Confidence</option>
            <option value="high">High (≥ 80%)</option>
            <option value="med">Mid (50 – 79%)</option>
            <option value="low">Low (&lt; 50%)</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => setSortByUrgency((s) => !s)}
          className={cn('flex items-center gap-2 border rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            sortByUrgency ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
          {sortByUrgency ? 'Urgency First' : 'Sort by Urgency'}
        </button>
        <button
          type="button"
          onClick={handleBatch}
          disabled={batching}
          className="inline-flex items-center gap-2 bg-indigo-100 border border-indigo-300 text-indigo-800 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-indigo-200 disabled:opacity-60 transition-colors"
        >
          {batching ? <Spinner /> : (
            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          )}
          Batch Auto-Approve (&gt;75%)
        </button>
      </div>

      {/* ===== Fallback trigger alert ===== */}
      <div className="mt-5 bg-red-50/60 border-l-4 border-red-500 border-y border-r rounded-r-xl px-4 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 shrink-0 rounded-lg bg-red-100 border border-red-200 grid place-items-center text-red-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </span>
          <div>
            <p className="font-bold text-slate-900">Automated Pipeline Fallback Triggered</p>
            <p className="text-sm text-slate-600 mt-0.5 max-w-2xl leading-relaxed">
              Tickets where AI model confidence fell below the automated routing threshold (&lt;80%) or vocabulary coverage was
              deficient are routed here for IT specialist evaluation. Every human decision actively retrains the active baseline weights.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px] font-mono text-slate-500">SLA Breach Target</div>
            <div className="text-sm font-mono font-bold text-red-600">18m remaining</div>
          </div>
          <span className="bg-indigo-100 text-indigo-700 font-mono text-xs font-bold rounded-md px-2.5 py-1.5">9/9</span>
        </div>
      </div>

      {error && <div className="mt-5"><ErrorBanner message={error} onRetry={refetch} /></div>}

      {/* ===== Work area ===== */}
      <div className="mt-5 grid lg:grid-cols-[minmax(0,420px)_1fr] gap-6 items-start">
        {/* --- Left: Triage backlog --- */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-mono font-bold tracking-widest text-slate-700 uppercase">Triage Backlog</span>
            <span className="text-[11px] font-mono text-indigo-600">{tickets.length} records demanding review</span>
          </div>

          <div className="space-y-2.5 max-h-[calc(100vh-260px)] overflow-y-auto pr-1.5">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
                <Spinner /> loading backlog…
              </div>
            )}
            {!loading && visible.length === 0 && !error && (
              <div className="border border-dashed border-slate-300 rounded-xl py-10 text-center">
                <p className="text-emerald-600 font-semibold text-sm">🎉 Queue Clear</p>
                <p className="text-xs text-slate-400 mt-1">All auto-routed tickets are allocated. Nothing awaits human evaluation.</p>
              </div>
            )}
            {visible.map((t) => {
              const active = t.id === selectedId;
              const u = urgencyOf(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={cn(
                    'w-full text-left border rounded-xl px-4 py-3.5 transition-all',
                    active ? 'bg-indigo-50 border-indigo-300 shadow-sm ring-1 ring-indigo-200' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-bold text-slate-900">{ticketLabel(t.id)}</span>
                      <Badge tone={(t.confidence ?? 0) < 60 ? 'red' : 'blue'}>{t.confidence != null ? `${t.confidence.toFixed(1)}%` : '—'}</Badge>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">{timeAgo(t.created_at) || 'just now'}</span>
                  </div>
                  <p className="text-sm text-slate-800 mt-1.5 leading-snug line-clamp-2">{t.short_description || '(no summary)'}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500 min-w-0">
                      <svg className="w-3.5 h-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                      <span className="truncate">{t.predicted_group ?? 'No model prediction'}</span>
                    </span>
                    <span className={cn('text-[10px] font-mono uppercase tracking-wider shrink-0', u.cls)}>{u.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* --- Right: evaluation panel --- */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 lg:sticky lg:top-24">
          {!selected ? (
            <div className="py-24 text-center text-sm text-slate-400">Select a ticket from the triage backlog to evaluate it.</div>
          ) : (
            <>
              {/* Panel head */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 shrink-0 rounded-lg bg-indigo-50 border border-indigo-100 grid place-items-center text-indigo-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </span>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-lg font-extrabold text-slate-900">{ticketLabel(selected.id)}</span>
                      <Badge tone="red">● Pending Human Assignment</Badge>
                    </div>
                    <p className="text-[11px] font-mono text-slate-500 mt-1">
                      Logged {timeAgo(selected.created_at) || 'recently'} via Enterprise Service Hub{selected.requester ? <> • Requester: <span className="text-slate-700">{selected.requester}</span></> : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 leading-tight">Prediction<br />Certainty</div>
                  <div className="mt-0.5 flex items-center gap-1.5 justify-end">
                    <span className="text-xl font-extrabold font-mono text-red-600">{selected.confidence != null ? `${selected.confidence.toFixed(2)}%` : '—'}</span>
                    <Badge tone="red">LOW</Badge>
                  </div>
                </div>
              </div>

              {/* Certainty bar */}
              <div className="mt-4 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-red-600 transition-all duration-500" style={{ width: `${Math.min(100, selected.confidence ?? 0)}%` }} />
              </div>

              {/* Payload */}
              <div className="mt-5 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">Short Description</span>
                    <span className="text-[10px] font-mono text-slate-400">{selected.category ? `Category: ${selected.category}` : `Vocab Coverage: ${selected.vocabulary_coverage != null ? `${selected.vocabulary_coverage.toFixed(1)}%` : '—'}`}</span>
                  </div>
                  <p className="mt-1 text-base font-semibold text-slate-900">{selected.short_description || '(no summary)'}</p>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">Unstructured Payload Body</span>
                    <span className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                      AI Token Salience Extracted
                    </span>
                  </div>
                  <div className="mt-2 bg-white border border-slate-200 rounded-lg p-3.5 text-sm text-slate-700 leading-relaxed min-h-[84px]">
                    {selected.description || '(no additional payload recorded for this ticket)'}
                  </div>
                </div>
              </div>

              {/* Model prediction breakdown */}
              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-bold text-slate-900">
                    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    Model Prediction Breakdown
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Model: <b>AutoAssign-NLP v3.4</b></span>
                </div>

                <div className="mt-3 grid md:grid-cols-2 gap-3">
                  <div className="border border-slate-200 rounded-xl p-4">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Top Model Candidate</div>
                    <div className="mt-1 text-sm font-bold text-indigo-700 leading-snug">{selected.predicted_group ?? '—'}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[11px] font-mono text-slate-500">Calculated Likelihood:</span>
                      <span className="font-mono text-xs font-bold text-red-600">{selected.confidence != null ? `${selected.confidence.toFixed(2)}%` : '—'}</span>
                    </div>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-4">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Heuristic Discrepancy Note</div>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed">{discrepancyNote(selected)}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">Candidate Probability Distribution</div>
                  <div className="mt-2 space-y-2.5">
                    {selectedCandidates.length === 0 && (
                      <p className="text-xs font-mono text-slate-400">No ranked candidates returned for this ticket.</p>
                    )}
                    {selectedCandidates.map((c, i) => (
                      <div key={`${c.name}-${i}`} className="grid grid-cols-[minmax(0,200px)_1fr_52px] items-center gap-3">
                        <span className="text-xs text-slate-600 truncate">{c.name}</span>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-600 rounded-full" style={{ width: `${Math.min(100, c.prob ?? 0)}%` }} /></div>
                        <span className="font-mono text-xs text-slate-600 text-right">{c.prob != null ? `${Number(c.prob).toFixed(1)}%` : '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Resolution zone */}
              <div className="mt-5 bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4">
                <div className="flex items-center gap-1.5 font-bold text-slate-900">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  Triage Resolution & Group Reassignment
                </div>

                <div className="mt-3 grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="target-group" className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-600">Target Support Group</label>
                      <span className="text-[10px] font-mono font-bold text-red-500">*Mandatory</span>
                    </div>
                    <div className="relative">
                      <select
                        id="target-group"
                        value={form.group}
                        onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                        className={cn('w-full appearance-none bg-white border rounded-lg px-3 py-2.5 text-sm text-slate-800 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition',
                          form.group ? 'border-slate-300 focus:border-indigo-500' : 'border-red-200')}
                      >
                        <option value="">{groups.length === 0 ? 'Loading group registry…' : '— Select assignment group —'}</option>
                        {groups.map((g) => (<option key={g} value={g}>{g}</option>))}
                      </select>
                      <svg className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="justification" className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                      Override Justification / Context
                    </label>
                    <input
                      id="justification"
                      value={form.justification}
                      onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
                      placeholder="Software deployment packaging issue"
                      className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, justification: 'Escalated to Tier 3' }))}
                    className="inline-flex items-center gap-2 bg-white border border-red-200 text-red-600 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-50 transition-colors"
                  >
                    <span className="text-base leading-none">⊛</span> Escalate to Tier 3
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selected.predicted_group) {
                        setForm((f) => ({ ...f, group: selected.predicted_group }));
                        setToast({ tone: 'success', msg: `Top model guess pre-selected: ${selected.predicted_group}` });
                      } else {
                        setToast({ tone: 'error', msg: 'No model prediction recorded for this ticket.' });
                      }
                    }}
                    className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-slate-50 transition-colors"
                  >
                    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    Accept Top Model Guess
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleAssign}
                  disabled={assigning || groups.length === 0}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg px-4 py-3 text-sm font-bold shadow-sm shadow-indigo-600/40 transition-colors"
                >
                  {assigning ? <Spinner /> : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" /></svg>
                  )}
                  Assign to Group & Resolve Queue
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}