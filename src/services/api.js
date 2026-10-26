export const API_BACKEND = 'http://127.0.0.1:8000';

/**
 * In dev, requests go through the Vite proxy so the browser makes same-origin calls.
 * In prod builds, set VITE_API_BASE (e.g. http://127.0.0.1:8000) to call the backend directly.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? '' : API_BACKEND);
const apiPath = (p, prefix = '/api') => `${API_BASE}${prefix}${p}`;

/** Map low-level network/CORS failures to readable copy */
export function friendlyError(err) {
  if (err && err.message === 'Failed to fetch') {
    return `Cannot reach triage API at ${API_BACKEND}. Make sure the FastAPI server is running (and reachable).`;
  }
  return err?.message || 'Unexpected error';
}

async function request(path, options = {}, prefix = '/api') {
  let res;
  try {
    res = await fetch(apiPath(path, prefix), options);
  } catch {
    throw new Error('Failed to fetch'); // normalized by friendlyError()
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status} ${res.statusText}`;
    if (data?.detail) {
      if (typeof data.detail === 'string') msg += ` — ${data.detail}`;
      else if (Array.isArray(data.detail)) msg += ` — ${data.detail.map((d) => d.msg || JSON.stringify(d)).join('; ')}`;
    } else if (data?.message) {
      msg += ` — ${data.message}`;
    }
    throw new Error(msg);
  }
  return data;
}

export const rejectHumanReviewTicket = (id, reason = '') =>
  request('/triage/human_review/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: String(id), reason: String(reason) }),
  });

export const rejectAssignedTicket = (id, reason = '') =>
  request('/triage/assigned/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: String(id), reason: String(reason) }),
  });

/** Accepts `array` OR `{tickets: [...]}` / `{items: [...]}` / `{results: [...]}` response shapes */
export function toList(data, ...keys) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of [...keys, 'tickets', 'items', 'data', 'results', 'records']) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return [];
}

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== '') return v;
  }
  return null;
};

/** Confidence/candidate probabilities arrive on a 0–100 scale — just coerce to number */
export function scorePct(value) {
  const n = Number(value);
  if (value == null || value === '' || Number.isNaN(n)) return null;
  return n;
}

/** Ranked candidates: real API uses `top_predictions`, fall back to common alternates */
export function ticketCandidates(rawTicket) {
  if (!rawTicket) return [];
  return toList(
    rawTicket.top_predictions ?? rawTicket.candidates ?? rawTicket.predictions ?? null
  ).map((c) =>
    typeof c === 'string'
      ? { name: c, prob: null }
      : {
          name: c.group ?? c.name ?? c.label ?? '',
          prob: scorePct(c.probability ?? c.score ?? c.confidence ?? null),
        }
  );
}

/** Normalize a raw ticket record so the UI can rely on a single field naming */
export function normalizeTicket(raw) {
  if (!raw || typeof raw !== 'object') return { id: '', short_description: '', description: '' };
  // Backend stores one combined `text` (short + detailed concatenated) — surface both views
  const text = String(pick(raw, 'text', 'short_description', 'shortDescription', 'summary', 'title') ?? '');
  const confidence = scorePct(pick(raw, 'confidence', 'confidence_score', 'model_confidence', 'score'));
  return {
    ...raw,
    id: String(pick(raw, 'id', 'ticket_id', 'number', 'ticket_number', 'sys_id', 'key') ?? ''),
    short_description: text.length > 140 ? `${text.slice(0, 140).trimEnd()}…` : text,
    description: text,
    assignment_group: pick(raw, 'assignment_group', 'assigned_group', 'assignedGroup', 'allocated_group') ?? null,
    expected_group: pick(raw, 'expected_group', 'expectedGroup', 'true_group', 'ground_truth_group') ?? null,
    // model_prediction is the real candidate; predicted_group may be a status label ("Human Review")
    predicted_group: pick(raw, 'model_prediction', 'predicted_group', 'predicted_assignment_group') ?? null,
    confidence,
    vocabulary_coverage: scorePct(pick(raw, 'vocabulary_coverage')),
    priority: pick(raw, 'priority', 'urgency', 'severity') ?? null,
    requester: pick(raw, 'requester', 'raised_by', 'caller', 'submitted_by') ?? null,
    category: pick(raw, 'category', 'ticket_type', 'type') ?? null,
    created_at: pick(raw, 'created_at', 'createdAt', 'submitted_at', 'opened_at', 'sys_created_on', 'timestamp') ?? null,
    discrepancy_note: pick(raw, 'discrepancy_note', 'heuristic_note', 'note') ?? null,
  };
}

/** Assignment groups may come as strings or objects — normalize to a string[] */
export function normalizeGroups(data) {
  if (typeof data === 'string') return [data];
  return toList(data, 'groups', 'assignment_groups')
    .map((g) => {
      if (typeof g === 'string') return g;
      const v = pick(g ?? {}, 'name', 'group_name', 'assignment_group', 'title', 'label');
      return v == null ? '' : String(v);
    })
    .filter((g) => g.trim() !== '');
}

export const api = {
  /** Model and application metadata */
  fetchMetadata: () => request('/triage/meta_data', {}, ''),

  /** a. Submit ticket — UI collects short + detailed description, API receives concatenated string */
  submitTicket: (shortDescription, description) =>
    request('/triage/tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // concatenated as one field per spec ('{"short_description": ""}')
        short_description: [shortDescription, description].filter(Boolean).join(' '),
      }),
    }),

  /** b. Tickets submitted for human review */
  fetchHumanReviewTickets: () => request('/triage/human_review'),

  /** c. Tickets already assigned to a group */
  fetchAssignedTickets: () => request('/triage/assigned'),

  /** d. Assignment group registry */
  fetchAssignmentGroups: () => request('/triage/assignment_groups'),

  /** e. Human assigns ticket → HumanReviewAssignment { id, assignment_group } */
  assignTicket: (id, assignment_group) =>
    request('/triage/human_review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: String(id), assignment_group: String(assignment_group) }),
    }),

  rejectHumanReviewTicket,
  rejectAssignedTicket,
};
