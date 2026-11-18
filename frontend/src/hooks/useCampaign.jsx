// The active campaign ("file") for the whole app (docs/CRM_PLAN.md, C1E).
// lib/campaign.js remembers the id per browser and lib/api.js sends it as
// X-Campaign-Id; this context loads the list, exposes the active campaign
// and switchTo(id). Switching changes `version`, which App.jsx uses as the
// routes' key, so every page remounts and refetches for the new file.
// Switching is refused during a call and while a dial session runs.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as api from '../lib/api';
import { getCampaignId, setCampaignId, DEFAULT_CAMPAIGN_ID } from '../lib/campaign';
import { getActiveSessionId } from './useCall';
import { useAuth } from './useAuth';

const CampaignContext = createContext(null);

/** "FILE 02 · ROOFING" — the same label the backend uses. */
export function fileLabel(campaign) {
  if (!campaign) return '';
  return `FILE ${String(campaign.file_number).padStart(2, '0')} · ${String(campaign.name).toUpperCase()}`;
}

const TOAST_MS = 5000;

/** The app's toast (DESIGN.md section 5): plain DOM, like lib/api.js's. */
export function showToast(text) {
  if (typeof document === 'undefined') return;
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.textContent = text;
  toast.className =
    'fixed bottom-4 right-4 z-50 border border-l-[3px] border-strong border-l-primary bg-card px-4 py-3 ' +
    'text-sm text-foreground';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), TOAST_MS);
}

export function CampaignProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [campaigns, setCampaigns] = useState([]);
  const [activeId, setActiveId] = useState(() => getCampaignId());
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { campaigns: list } = await api.listCampaigns();
      setCampaigns(list || []);
      setLoaded(true);
      return list || [];
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) refresh();
  }, [isAuthenticated, refresh]);

  // A stored file that no longer exists or was archived falls back to File 01
  // (or the first file that is not archived).
  useEffect(() => {
    if (!loaded || campaigns.length === 0) return;
    const usable = campaigns.filter((c) => c.status !== 'archived');
    if (usable.some((c) => String(c.id) === String(activeId))) return;
    const fallback = usable.find((c) => String(c.id) === DEFAULT_CAMPAIGN_ID) || usable[0];
    if (!fallback) return;
    setCampaignId(fallback.id);
    setActiveId(String(fallback.id));
    setVersion((v) => v + 1);
  }, [loaded, campaigns, activeId]);

  const onCall = location.pathname.startsWith('/call/');
  const [sessionLive, setSessionLive] = useState(() => !!getActiveSessionId());
  useEffect(() => {
    setSessionLive(!!getActiveSessionId());
    const id = setInterval(() => setSessionLive(!!getActiveSessionId()), 2000);
    return () => clearInterval(id);
  }, [location.pathname]);
  const switchBlockedReason = onCall
    ? 'Finish the call before switching files.'
    : sessionLive
      ? 'End the dial session before switching files.'
      : null;

  /** Makes `id` the active file and remounts the pages. Returns false when
   * switching is blocked (a call or a dial session) unless `force` is set. */
  const switchTo = useCallback(
    (id, { force = false } = {}) => {
      if (String(id) === String(activeId)) return true;
      if (switchBlockedReason && !force) return false;
      setCampaignId(id);
      setActiveId(String(id));
      setVersion((v) => v + 1);
      return true;
    },
    [activeId, switchBlockedReason]
  );

  const value = useMemo(() => {
    const active = campaigns.find((c) => String(c.id) === String(activeId)) || null;
    return {
      campaigns,
      usable: campaigns.filter((c) => c.status !== 'archived'),
      active,
      activeId,
      loaded,
      version,
      switchTo,
      switchBlockedReason,
      refresh,
    };
  }, [campaigns, activeId, loaded, version, switchTo, switchBlockedReason, refresh]);

  return <CampaignContext.Provider value={value}>{children}</CampaignContext.Provider>;
}

export function useCampaign() {
  const ctx = useContext(CampaignContext);
  if (!ctx) throw new Error('useCampaign must be used within CampaignProvider');
  return ctx;
}
