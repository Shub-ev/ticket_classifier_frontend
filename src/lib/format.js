export function cn(...args) {
  return args.filter(Boolean).join(' ');
}

/** Confidence bucket → Tailwind bar color */
export function confBar(v) {
  const n = v ?? 0;
  return n >= 80 ? 'bg-emerald-500' : n >= 50 ? 'bg-sky-400' : 'bg-red-500';
}

/** Compact INC-id display: UUID ids shown as INC-ab12cd34… */
export function ticketLabel(id) {
  const s = String(id ?? '').replace(/^INC-/i, '');
  if (!s) return '—';
  return s.length > 12 ? `INC-${s.slice(0, 8)}…` : `INC-${s}`;
}

/** Confidence bucket → label + tone */
export function confBadge(v) {
  const n = v ?? 0;
  if (n >= 80) return { label: 'HIGH', tone: 'emerald', bar: 'bg-emerald-500' };
  if (n >= 50) return { label: 'MID', tone: 'blue', bar: 'bg-sky-400' };
  return { label: 'LOW', tone: 'red', bar: 'bg-red-500' };
}

/** Ticket resolution status bucket for merged views: 'assigned' | 'failed' | 'pending' */
export function ticketState(t) {
  if (t.assignment_group && t.expected_group && t.assignment_group !== t.expected_group) return 'failed';
  return t.assignment_group ? 'assigned' : 'pending';
}

/** Relative time for created_at (handles ISO strings + unix seconds/ms) */
export function timeAgo(ts) {
  if (ts == null || ts === '') return '';
  let t;
  if (typeof ts === 'number') t = ts > 1e12 ? ts : ts * 1000;
  else if (/^\d{10,13}$/.test(String(ts))) {
    const n = Number(ts);
    t = n > 1e12 ? n : n * 1000;
  } else t = new Date(ts).getTime();
  if (!t || Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? `1h ${mins % 60}m ago` : `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
