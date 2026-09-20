// Central API client — the frontend never talks to the database directly,
// every read/write goes through this file. See CLAUDE.md → API-first.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const TOKEN_KEY = 'vortex_dialer_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

let unauthorizedHandler = null;
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

const TOAST_AUTO_DISMISS_MS = 4000;

/** Global toast for any 500 from the API — plain DOM (no React component
 * file here), auto-dismisses itself after 4s. */
function showServerErrorToast() {
  if (typeof document === 'undefined') return;
  const toast = document.createElement('div');
  toast.textContent = 'Something went wrong, please try again.';
  toast.className =
    'fixed bottom-4 right-4 z-50 animate-fade-in-row rounded-input bg-action-hangup px-4 py-3 text-sm ' +
    'font-medium text-white shadow-lg';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), TOAST_AUTO_DISMISS_MS);
}

async function request(path, { method = 'GET', body, isFormData = false } = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    unauthorizedHandler?.();
  }

  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.blob();

  if (!res.ok) {
    if (res.status >= 500) showServerErrorToast();
    const message = (data && data.error) || res.statusText || 'Request failed';
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

// auth
export const login = (email, password) => request('/auth/login', { method: 'POST', body: { email, password } });
export const getMe = () => request('/auth/me');
export const updateProfile = (name, email) => request('/auth/profile', { method: 'PUT', body: { name, email } });

// leads
export const listLeads = (params = {}) => {
  const cleaned = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const qs = new URLSearchParams(cleaned).toString();
  return request(`/leads${qs ? `?${qs}` : ''}`);
};
export const createLead = (fields) => request('/leads', { method: 'POST', body: fields });
export const getLead = (id) => request(`/leads/${id}`);
export const getStateCounts = () => request('/leads/state-counts');
export const snoozeLead = (id) => request(`/leads/${id}/snooze`, { method: 'POST' });
export const getLeadHistory = (id) => request(`/leads/${id}/history`);
export const searchLeads = (q) => request(`/leads/search?q=${encodeURIComponent(q)}`);
export const batchQueueLeads = (leadIds) => request('/leads/batch-queue', { method: 'POST', body: { leadIds } });
export const updateLead = (id, fields) => request(`/leads/${id}`, { method: 'PUT', body: fields });
export const deleteLead = (id) => request(`/leads/${id}`, { method: 'DELETE' });
export const getLeadTimeline = (id) => request(`/leads/${id}/timeline`);

// sms
export const getSmsTemplates = () => request('/sms/templates');
export const createSmsTemplate = (fields) => request('/sms/templates', { method: 'POST', body: fields });
export const updateSmsTemplate = (id, fields) => request(`/sms/templates/${id}`, { method: 'PUT', body: fields });
export const deleteSmsTemplate = (id) => request(`/sms/templates/${id}`, { method: 'DELETE' });
export const sendSms = (payload) => request('/sms/send', { method: 'POST', body: payload });
export const sendBulkSms = (leadIds, templateId) =>
  request('/sms/bulk-send', { method: 'POST', body: { leadIds, templateId } });
export const getSmsInbox = (page = 1, limit = 20) => request(`/sms/inbox?page=${page}&limit=${limit}`);
export const markSmsRead = (leadId) => request(`/sms/mark-read/${leadId}`, { method: 'POST' });
export const optOutSms = (leadId) => request(`/sms/opt-out/${leadId}`, { method: 'POST' });

// calls
export const startCall = (leadId, sessionId) =>
  request('/calls', {
    method: 'POST',
    body: { ...(leadId ? { leadId } : {}), ...(sessionId ? { sessionId } : {}) },
  });
export const getCall = (id) => request(`/calls/${id}`);
export const hangupCall = (id) => request(`/calls/${id}/hangup`, { method: 'POST' });

// manual dial pad — an ad-hoc call to a typed-in number, not tied to a lead
export const startManualCall = (toNumber) =>
  request('/calls/manual/start', { method: 'POST', body: { toNumber } });

// multi-line dialing — live status arrives over SSE rather than polling.
// EventSource can't set an Authorization header, so the token goes in the
// query string and the /stream route verifies it there (see routes/calls.js).
export function openCallStream() {
  const token = getToken();
  if (!token) return null;
  return new EventSource(`${API_URL}/calls/stream?token=${encodeURIComponent(token)}`);
}
export const startMultiline = (sessionId, lineCount, leadIds) =>
  request('/calls/multiline/start', {
    method: 'POST',
    body: {
      sessionId: sessionId || null,
      lineCount: lineCount || undefined,
      leadIds: leadIds && leadIds.length > 0 ? leadIds : undefined,
    },
  });
export const releaseMultilineSlot = (slotNumber) =>
  request('/calls/multiline/release', { method: 'POST', body: { slotNumber } });
export const dropMultilineSlot = (slotNumber) =>
  request('/calls/multiline/drop', { method: 'POST', body: { slotNumber } });
export const takeMultilineCall = (slotNumber) =>
  request('/calls/multiline/take', { method: 'POST', body: { slotNumber } });
export const stopMultiline = () => request('/calls/multiline/stop', { method: 'POST' });

// dispositions
export const submitDisposition = (payload) => request('/dispositions', { method: 'POST', body: payload });
export const undoDisposition = (callId) => request(`/dispositions/${callId}/undo`, { method: 'POST' });

// imports
export const previewImport = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return request('/imports/preview', { method: 'POST', body: formData, isFormData: true });
};
export const commitImport = (mapping, rows, filename) =>
  request('/imports/commit', { method: 'POST', body: { mapping, rows, filename } });
export const analyzeImport = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return request('/imports/analyze', { method: 'POST', body: formData, isFormData: true });
};
export const getImportHistory = () => request('/imports/history');

// background import jobs — upload parses + records the job, process kicks off
// the work and returns immediately, status is polled for progress.
export const uploadImportFile = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return request('/imports/upload', { method: 'POST', body: formData, isFormData: true });
};
export const processImportJob = (jobId, sheets, mapping) =>
  request('/imports/process', { method: 'POST', body: { jobId, sheets, mapping } });
export const getImportJobStatus = (jobId) => request(`/imports/status/${jobId}`);
export const cancelImportJob = (jobId) => request(`/imports/cancel/${jobId}`, { method: 'POST' });

// ai
export const expandNote = (note) => request('/ai/expand-note', { method: 'POST', body: { note } });

// reports
export const getTodayStats = () => request('/reports/today');
export const getPerStateReport = () => request('/reports/per-state');
export const getManualCallsToday = () => request('/reports/manual-today');

// settings (key/value store — e.g. the Groq API key, see Settings.jsx → Integrations)
export const getSetting = (key) => request(`/settings/${encodeURIComponent(key)}`);
export const putSetting = (key, value) =>
  request(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } });

// dialing sessions
export const startSession = (mode) => request('/sessions/start', { method: 'POST', body: { mode } });
export const endSession = (sessionId) => request('/sessions/end', { method: 'POST', body: { sessionId } });

// exports — fetched as a blob (not a plain <a href>) so the auth header goes along
export async function downloadDailyPdf(date) {
  const blob = await request(`/exports/daily-pdf${date ? `?date=${date}` : ''}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vortex-dialer-${date || new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
