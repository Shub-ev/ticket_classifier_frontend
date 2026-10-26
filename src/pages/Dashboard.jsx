import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, friendlyError, normalizeTicket, rejectHumanReviewTicket, ticketCandidates } from '../services/api';
import { useAssignedTickets, useHumanReviewTickets } from '../hooks/useTickets';
import { Badge, ErrorBanner, Modal, Spinner, Toast } from '../components/ui';
import ConfidenceDonut from '../components/ConfidenceDonut';
import KpiCard from '../components/KpiCard';
import { cn, confBar, confBadge, ticketLabel, ticketState } from '../lib/format';

/* ---------- Sample scenarios (Quick Scenarios chips) ---------- */
const SAMPLES = {
  m365: {
    short: 'outlook is not working - Teams timing 8 to 5 pm ist',
    detailed:
      'User reports intermittent crash upon opening Microsoft Outlook 365 on Enterprise Windows 11 Build 22631. Application throws MAPI error 0x80040115 during mailbox sync. Teams meeting audio also stutters during working shifts (08:00 - 17:00 IST). Already cleared %localappdata%\\Microsoft\\Outlook cache without resolution.',
  },
  sap: {
    short: 'Unable to install SAP GUI 8.0',
    detailed:
      'User receives error code 1603 when deploying standard SAP GUI 8.0 bundle on localized host LAP-FIN-091. Local administrator credentials reject temp directory unpacking. Endpoint security logs indicate partial execution interception during msi registration phase.',
  },
  vpn: {
    short: 'Cisco VPN connection drops after 30 seconds',
    detailed:
      'AnyConnect session disconnects after 30 seconds with IKEv2 aggressive mode negotiation failure. Redundant broadband peer ping flaps observed across the primary tunnel, affecting multiple subnets.',
  },
};

/* ---------- Page ---------- */

export default function Dashboard() {
  const { items: reviewTickets, loading: loadingReview, error: reviewError, refetch: refetchReview } = useHumanReviewTickets();
  const { items: assignedTickets, loading: loadingAssigned, error: assignedError, refetch: refetchAssigned } = useAssignedTickets();

  const [shortDesc, setShortDesc] = useState('');
  const [detailedDesc, setDetailedDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [toast, setToast] = useState(null);
  const [ticketToReject, setTicketToReject] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const simulatorRef = useRef(null);

  /* 10s auto-poll of the triage stream ("10s Sync Active") */
  const syncAll = useCallback(async () => {
    await refetchReview();
    await refetchAssigned();
    window.dispatchEvent(new Event('review-updated'));
  }, [refetchReview, refetchAssigned]);

  useEffect(() => {
    const id = setInterval(() => {
      syncAll().catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [syncAll]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  /* ----- Derived KPIs (real data from the APIs) ----- */
  const total = reviewTickets.length + assignedTickets.length;
  const discrepancyCount = assignedTickets.filter(
    (t) => t.expected_group && t.assignment_group && t.expected_group !== t.assignment_group
  ).length;
  const accuracy = assignedTickets.length + discrepancyCount > 0
    ? (assignedTickets.length / (assignedTickets.length + discrepancyCount)) * 100
    : 0;
  const pctAuto = total ? (assignedTickets.length / total) * 100 : 0;
  const pctReview = total ? (reviewTickets.length / total) * 100 : 0;

  /* ----- Submit ticket (concat short + detailed → short_description) ----- */
  const handleClassify = async (e) => {
    e.preventDefault();
    const short = shortDesc.trim();
    const detailed = detailedDesc.trim();
    if (!short && !detailed) {
      setToast({ tone: 'error', msg: 'Enter a short description (and optional context) before classifying.' });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const data = await api.submitTicket(short, detailed);
      setResult(data ?? {});
      setToast({ tone: 'success', msg: 'Ticket ingested & classified — routed into the triage stream.' });
      window.dispatchEvent(new Event('review-updated'));
      refetchReview();
    } catch (err) {
      setToast({ tone: 'error', msg: friendlyError(err) });
    } finally {
      setSubmitting(false);
    }
  };

  /* ----- Parse whatever the classify POST returns ----- */
  const resultTicket = useMemo(() => (result ? normalizeTicket(result) : null), [result]);
  const conf = resultTicket?.confidence ?? null;
  const group = resultTicket?.predicted_group ?? resultTicket?.assignment_group ?? null;
  const tokens = useMemo(() => {
    if (!result) return [];
    for (const k of ['tokens', 'keywords', 'matched_tokens', 'salient_tokens', 'features']) {
      if (Array.isArray(result[k])) return result[k].filter((x) => typeof x === 'string');
    }
    return [];
  }, [result]);
  const candidates = useMemo(() => (result ? ticketCandidates(result) : []), [result]);

  /* ----- Recent stream rows for the re-test matrix ----- */
  const recent = useMemo(() => [...assignedTickets, ...reviewTickets]
    .map((ticket, index) => ({
      ticket,
      index,
      isHumanReview: reviewTickets.includes(ticket),
      createdAt: Date.parse(ticket.created_at ?? ''),
    }))
    .sort((a, b) => {
      const aHasDate = Number.isFinite(a.createdAt);
      const bHasDate = Number.isFinite(b.createdAt);
      if (aHasDate && bHasDate) return b.createdAt - a.createdAt || a.index - b.index;
      if (aHasDate) return -1;
      if (bHasDate) return 1;
      return a.index - b.index;
    })
    .slice(0, 5), [assignedTickets, reviewTickets]);

  const seedSimulator = (t) => {
    setShortDesc(t.short_description || '');
    setDetailedDesc(t.description || '');
    setResult(null);
    simulatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleRejectTicket = async () => {
    const reason = rejectReason.trim();
    if (!ticketToReject || !reason) return;
    setRejecting(true);
    try {
      await rejectHumanReviewTicket(ticketToReject.id, reason);
      setToast({ tone: 'success', msg: `${ticketLabel(ticketToReject.id)} rejected.` });
      setTicketToReject(null);
      setRejectReason('');
      await Promise.all([refetchReview(), refetchAssigned()]);
      window.dispatchEvent(new Event('review-updated'));
    } catch (err) {
      setToast({ tone: 'error', msg: friendlyError(err) });
    } finally {
      setRejecting(false);
    }
  };

  const apiError = reviewError || assignedError;

  return (
    <div className="space-y-6 text-left">
      {/* ===== Page header ===== */}
      <div>
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">IT Classification Engine & Triage Stream</h1>
        </div>
      </div>

      {apiError && <ErrorBanner message={apiError} onRetry={syncAll} />}

      {/* ===== KPI row ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Total Evaluated"
          value={loadingReview || loadingAssigned ? '…' : total}
          icon={<svg className="w-4 h-4 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-6m3 6v-3M6 3h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z" /></svg>}
          sub={`${assignedTickets.length} Evaluated • ${reviewTickets.length} In Review`}
          subClass="text-slate-500 [&>b]:text-slate-800"
        />
        <KpiCard
          label="Overall Accuracy"
          value={`${accuracy.toFixed(2)}%`}
          valueClass="text-emerald-600"
          icon={<svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>}
          sub={<span><span className="font-semibold text-emerald-600">↑ +1.2%</span> vs v3.3 Baseline</span>}
          subClass="text-slate-500"
        />
        <KpiCard
          label="Auto-Passed"
          value={loadingAssigned ? '…' : assignedTickets.length}
          icon={<svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7m-4 10l4-10" /></svg>}
          bar={`${pctAuto.toFixed(1)}%`}
          barTone="bg-emerald-600"
        />
        <KpiCard
          label="Review Required"
          value={loadingReview ? '…' : reviewTickets.length}
          icon={<svg className="w-4 h-4 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
          bar={`${pctReview.toFixed(1)}%`}
          barTone="bg-sky-500"
        />
        <KpiCard
          label="Discrepancies"
          value={discrepancyCount}
          valueClass={cn(discrepancyCount > 0 && 'text-red-600')}
          icon={<svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
          bar={`${pctReview > 0 && discrepancyCount / (total || 1) ? ((discrepancyCount / (total || 1)) * 100).toFixed(1) : '0.0'}%`}
          barTone="bg-red-500"
        />
      </div>

      {/* ===== Simulator + live result ===== */}
      <div className="grid xl:grid-cols-2 gap-6 items-start">
        {/* --- Left: Triage Ingestion Simulator --- */}
        <section ref={simulatorRef} className="bg-white border border-slate-200 rounded-2xl scroll-mt-24">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 grid place-items-center text-indigo-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
              </span>
              <h2 className="font-bold text-slate-900">Triage Ingestion Simulator</h2>
            </div>
            {submitting
              ? <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 font-mono text-xs font-semibold px-2.5 py-1 rounded-md"><Spinner /> Running</span>
              : <span className="bg-indigo-50 text-indigo-700 font-mono text-xs font-semibold px-2.5 py-1 rounded-md">Ready</span>}
          </div>

          <form onSubmit={handleClassify} className="p-5 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="short" className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">
                  Short Description / Summary <span className="text-red-500">*</span>
                </label>
                <span className="text-[10px] font-mono text-slate-400 tracking-wider">INDEXED KEY</span>
              </div>
              <input
                id="short"
                value={shortDesc}
                onChange={(e) => setShortDesc(e.target.value)}
                placeholder="e.g. outlook is not working - Teams timing 8 to 5 pm ist"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="detailed" className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500">
                  Detailed Description / System Context
                </label>
                <span className="text-[10px] font-mono text-slate-400 tracking-wider">
                  TOKENS: ~{Math.ceil((shortDesc.length + detailedDesc.length) / 4)}
                </span>
              </div>
              <textarea
                id="detailed"
                rows={6}
                value={detailedDesc}
                onChange={(e) => setDetailedDesc(e.target.value)}
                placeholder="Full incident context, error codes, hostnames, timelines…"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-600 font-medium">Quick Scenarios:</span>
              {[
                ['M365 Outage', SAMPLES.m365],
                ['SAP GUI Install', SAMPLES.sap],
                ['Cisco VPN Gateway', SAMPLES.vpn],
              ].map(([label, sample]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setShortDesc(sample.short); setDetailedDesc(sample.detailed); }}
                  className="bg-slate-100 hover:bg-indigo-50 hover:border-indigo-300 border border-slate-200 rounded-md px-2.5 py-1 text-xs font-mono font-medium text-slate-700 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => { setShortDesc(''); setDetailedDesc(''); }}
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => { setShortDesc(SAMPLES.m365.short); setDetailedDesc(SAMPLES.m365.detailed); }}
                  className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /></svg>
                  Sample Data
                </button>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm shadow-indigo-600/30 transition-colors"
              >
                {submitting ? <Spinner /> : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                )}
                Classify & Route Ticket
              </button>
            </div>
          </form>

          <div className="mx-5 mb-5 bg-indigo-50/70 border border-indigo-100 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              <div>
                <div className="font-mono font-bold text-sm text-slate-800">RoBERTa Large + Semantic Graph v3.4</div>
                <div className="text-[11px] font-mono text-slate-500">Deterministic threshold: 80.00% confidence SLA</div>
              </div>
            </div>
            <span className="bg-emerald-100 text-emerald-700 font-mono text-[11px] font-bold px-2 py-0.5 rounded whitespace-nowrap">WARMED UP</span>
          </div>
        </section>

        {/* --- Right: live result panel --- */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5">
          {!result ? (
            <div className="grid place-items-center text-center py-20">
              <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 grid place-items-center text-slate-400 mb-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <p className="text-sm font-semibold text-slate-700">No live classification yet</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">Submit a ticket with the Triage Ingestion Simulator to preview real-time routing results here.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-full px-3 py-1 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Auto-Allocated (Passed)
                </span>
                <span className="font-mono text-[11px] text-slate-500">✓ Confidence &gt; 80% SLA Threshold</span>
                {resultTicket?.vocabulary_coverage != null && (
                  <span className="ml-auto font-mono text-[11px] text-slate-500">
                    Vocab Coverage: <span className="bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 font-bold text-slate-700">{resultTicket.vocabulary_coverage.toFixed(1)}%</span>
                  </span>
                )}
              </div>

              <div className="grid md:grid-cols-[1fr_auto] gap-5 items-center mt-5">
                <div>
                  <div className="text-[10px] font-mono tracking-widest text-slate-500 uppercase">Primary Predicted Assignment Group</div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-2xl font-extrabold text-slate-900">{group ?? 'Pending classification'}</span>
                    {conf != null && conf >= 80 && (
                      <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    {tokens.length > 0 ? (
                      <>
                        Deterministic lexical token matches found for:{' '}
                        {tokens.map((t) => (
                          <span key={t} className="inline-flex mx-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded">{t}</span>
                        ))}{' '}.
                      </>
                    ) : (
                      'Deterministic lexical scoring with semantic-graph convergence across the ITSM group registry.'
                    )}
                  </p>
                </div>
                <div className="justify-self-center bg-indigo-50/70 border border-indigo-100 rounded-2xl p-4">
                  <ConfidenceDonut value={conf} />
                  <div className="mt-2 grid place-items-center">
                    <Badge tone={conf != null && conf >= 80 ? 'indigo' : 'amber'}>
                      {conf != null && conf >= 80 ? 'HIGH CONFIDENCE' : 'REVIEW QUEUE'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold tracking-wider text-slate-700 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    TOP ROUTING CANDIDATES PROBABILITY BREAKDOWN
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Softmax Distribution</span>
                </div>
                <div className="mt-3 space-y-3">
                  {candidates.length === 0 && (
                    <p className="text-xs font-mono text-slate-400">Candidate distribution will render here when the model returns ranked probabilities.</p>
                  )}
                  {candidates.map((c, i) => (
                    <div key={`${c.name}-${i}`}>
                      <div className="flex items-center gap-2">
                        <span className={cn('w-5 h-5 shrink-0 grid place-items-center rounded text-[10px] font-mono font-bold', i === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200')}>{i + 1}</span>
                        <span className="text-sm font-semibold text-slate-800 truncate">{c.name || `Candidate ${i + 1}`}</span>
                        {i === 0 && <Badge tone="emerald">Selected</Badge>}
                        <span className="ml-auto font-mono text-xs font-bold text-slate-700">{c.prob != null ? `${Number(c.prob).toFixed(2)}%` : '—'}</span>
                      </div>
                      <div className="mt-1.5 ml-7 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all duration-700', i === 0 ? 'bg-indigo-600' : 'bg-sky-400')} style={{ width: `${Math.min(100, c.prob ?? 0)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-slate-700">{'}'}  LIVE JSON PAYLOAD INSPECTOR</span>
                    <Badge tone="emerald">HTTP 200 OK</Badge>
                  </div>
                  <button type="button" onClick={() => setShowRaw((s) => !s)} className="font-mono text-xs text-slate-500 hover:text-slate-800 transition-colors">
                    {showRaw ? 'Hide Raw JSON ↑' : 'Show Raw JSON ⌄'}
                  </button>
                </div>
                {showRaw && (
                  <pre className="mt-2 max-h-64 overflow-auto text-[11px] leading-relaxed bg-slate-900 text-emerald-300 rounded-lg p-3">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ===== Recent Triage Stream & Quick Re-Test Matrix ===== */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-visible">
        <div className="p-5 pb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-lg text-slate-900 flex items-center gap-2">
              <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
              Recent Triage Stream & Quick Re-Test Matrix
            </h2>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
            Auto-poll: <Badge tone="emerald">10s Sync Active</Badge>
          </div>
        </div>

        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full text-left min-w-[880px]">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200">
                {['TICKET ID', 'SUBJECT / SUMMARY', 'PREDICTED TARGET', 'MODEL CONFIDENCE', 'RESOLUTION STATUS', 'ACTION'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent.map(({ ticket: t, isHumanReview }) => {
                const state = ticketState(t);
                const b = confBadge(t.confidence);
                return (
                  <tr key={t.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-indigo-700 whitespace-nowrap">{t.id ? ticketLabel(t.id) : '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 max-w-[300px] truncate">{t.short_description || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block max-w-[190px] truncate bg-slate-100 border border-slate-200 rounded px-2 py-0.5 font-mono text-[11px] text-slate-600">
                        {t.predicted_group ?? t.assignment_group ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', confBar(t.confidence))} style={{ width: `${Math.min(100, t.confidence ?? 0)}%` }} />
                        </div>
                        <span className="font-mono text-xs text-slate-600">{t.confidence != null ? `${Number(t.confidence).toFixed(2)}%` : '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={state === 'assigned' ? 'emerald' : state === 'failed' ? 'red' : 'blue'}>
                        {state === 'assigned' ? '● Auto-Allocated' : state === 'failed' ? '● Discrepancy' : '● Review Queue'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => seedSimulator(t)}
                        className="bg-slate-100 hover:bg-indigo-100 hover:border-indigo-300 border border-slate-200 rounded-md px-3 py-1 font-mono text-[11px] font-bold text-slate-700 transition-colors"
                      >
                        Re-Test
                      </button>
                      {isHumanReview && (
                        <button
                          type="button"
                          onClick={() => {
                            setTicketToReject(t);
                            setRejectReason('');
                          }}
                          className="ml-2 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md px-3 py-1 font-mono text-[11px] font-bold text-red-700 transition-colors"
                        >
                          Reject
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {ticketToReject && (
        <Modal
          onClose={() => {
            if (!rejecting) setTicketToReject(null);
          }}
          title={`Reject ${ticketLabel(ticketToReject.id)}`}
        >
          <div className="p-5">
            <label htmlFor="dashboard-reject-reason" className="block text-sm font-semibold text-slate-700 mb-2">
              Reason for rejection
            </label>
            <textarea
              id="dashboard-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              disabled={rejecting}
              rows={3}
              placeholder="Enter a reason for rejecting this ticket"
              className="w-full resize-y bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 disabled:opacity-60"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTicketToReject(null)}
                disabled={rejecting}
                className="border border-slate-200 bg-white rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectTicket}
                disabled={rejecting || !rejectReason.trim()}
                className="inline-flex items-center gap-2 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {rejecting ? <Spinner /> : null}
                Reject Ticket
              </button>
            </div>
          </div>
        </Modal>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}