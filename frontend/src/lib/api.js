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
export const getLead = (id) => request(`/leads/${id}`);
export const getStateCounts = () => request('/leads/state-counts');
export const snoozeLead = (id) => request(`/leads/${id}/snooze`, { method: 'POST' });
export const getLeadHistory = (id) => request(`/leads/${id}/history`);
export const searchLeads = (q) => request(`/leads/search?q=${encodeURIComponent(q)}`);
export const batchQueueLeads = (leadIds) => request('/leads/batch-queue', { method: 'POST', body: { leadIds } });
export const updateLead = (id, fields) => request(`/leads/${id}`, { method: 'PUT', body: fields });
export const deleteLead = (id) => request(`/leads/${id}`, { method: 'DELETE' });

// calls
export const startCall = (leadId, sessionId) =>
  request('/calls', {
    method: 'POST',
    body: { ...(leadId ? { leadId } : {}), ...(sessionId ? { sessionId } : {}) },
  });
export const getCall = (id) => request(`/calls/${id}`);
export const hangupCall = (id) => request(`/calls/${id}/hangup`, { method: 'POST' });

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

// ai
export const expandNote = (note) => request('/ai/expand-note', { method: 'POST', body: { note } });

// reports
export const getTodayStats = () => request('/reports/today');
export const getPerStateReport = () => request('/reports/per-state');

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
