import { useEffect, useState } from 'react';
import * as api from '../lib/api';

// The signed-in user's preferences, stored on the server (F-48) so they
// follow the user to any browser: daily goal, default lines, pitch script,
// the Reports reminder. One fetch shared by every component.
//
// One-time move from this browser: these used to live in localStorage. On
// the first load after the update, a value this browser has and the server
// doesn't is sent to the server once; a value the server already has is
// never overwritten. The local copy is removed either way, so from then on
// only the server is used.
export const LEGACY_LOCAL_KEYS = {
  daily_goal: 'vortex_dialer_daily_goal',
  default_lines: 'vortex_dialer_default_lines',
  pitch_script: 'vortex_pitch_script',
  'rebuttal-recalibration-dismissed-month': null, // was a global server setting, not local
};

let cache = null; // { settings }
let loading = null; // in-flight promise
const listeners = new Set();
const publish = () => listeners.forEach((fn) => fn(cache?.settings || null));

async function migrateLocal(settings) {
  const next = { ...settings };
  for (const [key, localKey] of Object.entries(LEGACY_LOCAL_KEYS)) {
    if (!localKey) continue;
    let local = null;
    try { local = localStorage.getItem(localKey); } catch { /* storage unavailable */ }
    if (local == null || local === '') continue;
    if (next[key] == null) {
      try {
        const res = await api.putMySetting(key, local);
        Object.assign(next, res.settings);
      } catch {
        continue; // keep the local copy; try again next load
      }
    }
    try { localStorage.removeItem(localKey); } catch { /* ignore */ }
  }
  return next;
}

function load() {
  if (!loading) {
    loading = api
      .getMySettings()
      .then(({ settings }) => migrateLocal(settings || {}))
      .then((settings) => {
        cache = { settings };
        publish();
        return settings;
      })
      .catch(() => {
        loading = null; // retry on the next mount
        return null;
      });
  }
  return loading;
}

/** Forget the cache (e.g. after logout, so the next user loads their own). */
export function resetUserSettings() {
  cache = null;
  loading = null;
}

export function useUserSettings() {
  const [settings, setSettings] = useState(cache?.settings || null);
  useEffect(() => {
    listeners.add(setSettings);
    load();
    return () => listeners.delete(setSettings);
  }, []);

  const save = async (key, value) => {
    const res = await api.putMySetting(key, value == null ? null : String(value));
    cache = { settings: res.settings };
    publish();
    return res.settings;
  };

  return { settings, loaded: settings !== null, save };
}
