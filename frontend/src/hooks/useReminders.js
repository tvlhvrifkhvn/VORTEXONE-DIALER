import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import { pollWhileVisible } from '../lib/poll';

// Reminders (C6A): polls GET /api/tasks/due-soon every 60 s and shows each
// task or callback as a toast at its due time (already due: at once). The
// server is told once a toast is shown (reminded today). SNOOZE 10 MIN is
// kept in localStorage. A browser notification is added only when the owner
// turned it on in Settings (permission granted) and no call is on screen.
const POLL_MS = 60000;
const SNOOZE_MS = 10 * 60 * 1000;
const SNOOZE_KEY = 'vortex.reminders.snoozed';
export const NOTIFY_KEY = 'vortex.reminders.notify';

const keyOf = (item) => `${item.kind}:${item.id}:${item.due_at}`;

function readSnoozed() {
  try {
    const all = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}');
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, until]) => until > now));
  } catch {
    return {};
  }
}

function writeSnoozed(map) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: snooze lasts until the page reloads */
  }
}

export function notificationsOn() {
  try {
    return localStorage.getItem(NOTIFY_KEY) === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

/** On a call screen the reminder is a toast only: no notification, nothing takes focus. */
const onCall = () => typeof window !== 'undefined' && /^\/call\//.test(window.location.pathname);

export function useReminders() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map()); // key → timeout id
  const shown = useRef(new Set());

  const show = useCallback((item) => {
    const key = keyOf(item);
    timers.current.delete(key);
    if (shown.current.has(key) || readSnoozed()[key]) return;
    shown.current.add(key);
    setToasts((list) => [...list.filter((t) => keyOf(t) !== key), item]);
    api.ackReminder(item).catch(() => {});
    if (notificationsOn() && !onCall()) {
      try {
        new Notification(item.kind === 'callback' ? `Callback: ${item.lead_name}` : `Task: ${item.title}`, {
          body: item.lead_name ? `${item.lead_name} · due now` : 'Due now',
          tag: key,
        });
      } catch {
        /* notifications not available here */
      }
    }
  }, []);

  const poll = useCallback(async () => {
    let res;
    try {
      res = await api.getDueSoon();
    } catch {
      return; // the next poll tries again
    }
    const snoozed = readSnoozed();
    for (const item of res.items || []) {
      const key = keyOf(item);
      if (shown.current.has(key) || snoozed[key] || timers.current.has(key)) continue;
      const wait = new Date(item.due_at).getTime() - Date.now();
      if (wait <= 0) show(item);
      else timers.current.set(key, setTimeout(() => show(item), wait));
    }
  }, [show]);

  useEffect(() => {
    poll();
    const stopPoll = pollWhileVisible(poll, POLL_MS); // C7A: due items are caught up when the tab shows again
    const pending = timers.current;
    return () => {
      stopPoll();
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, [poll]);

  const dismiss = useCallback((item) => setToasts((list) => list.filter((t) => keyOf(t) !== keyOf(item))), []);

  const snooze = useCallback(
    (item) => {
      const key = keyOf(item);
      const until = Date.now() + SNOOZE_MS;
      writeSnoozed({ ...readSnoozed(), [key]: until });
      dismiss(item);
      shown.current.delete(key);
      timers.current.set(key, setTimeout(() => {
        writeSnoozed(Object.fromEntries(Object.entries(readSnoozed()).filter(([k]) => k !== key)));
        show(item);
      }, SNOOZE_MS));
    },
    [dismiss, show]
  );

  return { toasts, dismiss, snooze };
}
