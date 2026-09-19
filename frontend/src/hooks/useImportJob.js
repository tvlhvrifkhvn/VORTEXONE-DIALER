import { useEffect, useState } from 'react';
import * as api from '../lib/api';

export const IMPORT_JOB_KEY = 'vortex_dialer_import_job';
const POLL_MS = 1500;
const ACTIVE_STATUSES = ['pending', 'processing'];

// One poller shared by every component using this hook (the Import page and
// the navbar badge both do). Without this they'd poll independently and race
// each other to clear localStorage on completion.
let currentJob = null;
let pollTimer = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(currentJob));
}

function setJob(job) {
  currentJob = job;
  notify();
}

function storedJobId() {
  const raw = localStorage.getItem(IMPORT_JOB_KEY);
  return raw ? Number(raw) : null;
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollOnce() {
  const jobId = storedJobId();
  if (!jobId) {
    stopPolling();
    return;
  }

  try {
    const job = await api.getImportJobStatus(jobId);
    setJob(job);

    // Terminal state — stop polling and let go of the job so a later upload
    // starts clean. The finished job stays in state for the report UI.
    if (!ACTIVE_STATUSES.includes(job.status)) {
      localStorage.removeItem(IMPORT_JOB_KEY);
      stopPolling();
    }
  } catch {
    // A missing/failed job shouldn't leave a poller spinning forever.
    localStorage.removeItem(IMPORT_JOB_KEY);
    stopPolling();
  }
}

function startPolling() {
  if (pollTimer) return;
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_MS);
}

/** Called when a job is kicked off, so polling begins immediately. */
export function trackImportJob(jobId) {
  localStorage.setItem(IMPORT_JOB_KEY, String(jobId));
  setJob({ jobId, status: 'processing', processedRows: 0, totalRows: 0, percentage: 0 });
  startPolling();
}

/**
 * Live state of the running import. Resumes from localStorage on mount, so a
 * job started on the Import page keeps reporting progress from anywhere in
 * the app (that's what the navbar badge renders) and survives a page reload.
 */
export function useImportJob() {
  const [job, setLocalJob] = useState(currentJob);

  useEffect(() => {
    listeners.add(setLocalJob);
    // Resume an import that was already running when this mounted.
    if (storedJobId()) startPolling();

    return () => {
      listeners.delete(setLocalJob);
      // Keep polling while any other consumer is still listening.
      if (listeners.size === 0) stopPolling();
    };
  }, []);

  const cancelJob = async () => {
    const jobId = job?.jobId || storedJobId();
    if (!jobId) return;
    try {
      await api.cancelImportJob(jobId);
    } catch {
      // Status polling will surface the real outcome either way.
    }
  };

  const clearJob = () => {
    localStorage.removeItem(IMPORT_JOB_KEY);
    stopPolling();
    setJob(null);
  };

  return {
    job,
    isActive: !!job && ACTIVE_STATUSES.includes(job.status),
    cancelJob,
    clearJob,
  };
}
