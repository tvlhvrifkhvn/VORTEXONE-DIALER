import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import { useAuth } from '../hooks/useAuth';
import * as api from '../lib/api';
import { useUserSettings } from '../hooks/useUserSettings';

// Global, supervisor only (F-48): applies to new leads (created or imported).
const MAX_ATTEMPTS_KEY = 'default_max_attempts';
// The old browser-only copy of it (removed on first load; see below).
const LEGACY_MAX_ATTEMPTS_KEY = 'vortex_dialer_default_max_attempts';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_GOAL = 100;
const DEFAULT_LINES = 3;
// Matches callingHours.js's ENFORCEMENT_SETTING_KEY — server-backed (the
// settings table), not localStorage, since the backend reads it directly.
const CALLING_HOURS_KEY = 'calling_hours_enforced';
const DEFAULT_SCRIPT =
  "Hi, I'm {name} from Vortexone Agency. We offer virtual assistant services for real " +
  'estate agents — lead follow-up, appointment setting, and admin support. Do you currently ' +
  'have VA support on your team?';


function ProfileSection() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api.updateProfile(name, email);
      setMessage({ type: 'ok', text: 'Profile saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <NeuCard className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Profile</h2>
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Display name</label>
          <NeuInput value={name} onChange={(e) => setName(e.target.value)} className="w-full" required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Email</label>
          <NeuInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full"
            required
          />
        </div>
        {message && (
          <p className={`text-sm ${message.type === 'ok' ? 'text-action-contacted' : 'text-action-hangup'}`}>
            {message.text}
          </p>
        )}
        <NeuButton type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </NeuButton>
      </form>
    </NeuCard>
  );
}

function DialingDefaultsSection() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'supervisor';
  // Daily goal and default lines are this user's own (server, F-48); max
  // attempts is a global server setting only a supervisor can change.
  const { settings: mine, save: saveMine } = useUserSettings();
  const [maxAttempts, setMaxAttempts] = useState(DEFAULT_MAX_ATTEMPTS);
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_GOAL);
  const [defaultLines, setDefaultLines] = useState(DEFAULT_LINES);
  useEffect(() => {
    if (!mine) return;
    if (Number(mine.daily_goal) > 0) setDailyGoal(Number(mine.daily_goal));
    if ([1, 2, 3].includes(Number(mine.default_lines))) setDefaultLines(Number(mine.default_lines));
  }, [mine]);
  useEffect(() => {
    api
      .getSetting(MAX_ATTEMPTS_KEY)
      .then(async ({ value }) => {
        let local = null;
        try { local = localStorage.getItem(LEGACY_MAX_ATTEMPTS_KEY); } catch { /* ignore */ }
        // One-time move of the old browser-only value: only if the server has none and a supervisor is signed in.
        if (value == null && local && isSupervisor) {
          const { setting } = await api.putSetting(MAX_ATTEMPTS_KEY, String(Number(local))).catch(() => ({}));
          value = setting?.value ?? null;
        }
        if (local && (value != null || isSupervisor)) {
          try { localStorage.removeItem(LEGACY_MAX_ATTEMPTS_KEY); } catch { /* ignore */ }
        }
        if (Number(value) > 0) setMaxAttempts(Number(value));
      })
      .catch(() => {});
  }, [isSupervisor]);
  // Server-backed (settings table) since callingHours.js reads it directly —
  // unlike the fields above, this isn't a localStorage-only preference.
  // ON unless the stored value is exactly 'false' — a missing setting is ON
  // (same rule as the server). The switch saves at once and the server
  // applies it to the next dial.
  const [enforceHours, setEnforceHours] = useState(true);
  const [loadingToggle, setLoadingToggle] = useState(true);
  const [savingToggle, setSavingToggle] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getSetting(CALLING_HOURS_KEY)
      .then(({ value }) => setEnforceHours(value !== 'false'))
      .catch(() => {})
      .finally(() => setLoadingToggle(false));
  }, []);

  const handleToggleHours = async () => {
    const next = !enforceHours;
    setError(null);
    setSavingToggle(true);
    try {
      await api.putSetting(CALLING_HOURS_KEY, String(next));
      setEnforceHours(next);
    } catch (err) {
      setError(`Calling hours not changed: ${err.message}`);
    } finally {
      setSavingToggle(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await saveMine('daily_goal', dailyGoal);
      await saveMine('default_lines', defaultLines);
      // Global settings: only a supervisor can change them (the calling-hours switch saves on its own too).
      if (isSupervisor) {
        await api.putSetting(MAX_ATTEMPTS_KEY, String(maxAttempts));
        await api.putSetting(CALLING_HOURS_KEY, String(enforceHours));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <NeuCard className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Dialing defaults</h2>
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Default max attempts per lead (1–10)
          </label>
          <NeuInput
            type="number"
            min="1"
            max="10"
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(Number(e.target.value))}
            className="w-32"
            disabled={!isSupervisor}
          />
          <p className="mt-1 text-xs text-text-secondary">
            Applies to new leads (added or imported from now on). Existing leads keep their own value.
            {!isSupervisor && ' Only a supervisor can change this.'}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Default daily goal</label>
          <NeuInput
            type="number"
            min="1"
            value={dailyGoal}
            onChange={(e) => setDailyGoal(Number(e.target.value))}
            className="w-32"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Default simultaneous lines
          </label>
          <NeuInput
            as="select"
            value={defaultLines}
            onChange={(e) => setDefaultLines(Number(e.target.value))}
            className="w-32"
          >
            <option value={1}>1 line</option>
            <option value={2}>2 lines</option>
            <option value={3}>3 lines</option>
          </NeuInput>
          <p className="mt-1 text-xs text-text-secondary">
            How many leads a dialing session rings at once. Adjustable per session on the dashboard.
          </p>
        </div>
        <div
          className={`rounded-input border-2 p-3 ${enforceHours ? 'border-action-contacted' : 'border-action-hangup'}`}
          data-testid="calling-hours-state"
        >
          <p className={`mb-2 text-sm font-semibold ${enforceHours ? 'text-action-contacted' : 'text-action-hangup'}`}>
            {loadingToggle
              ? 'Calling hours: checking…'
              : enforceHours
                ? 'Calling hours are ON — leads are only dialed 8am–9pm their local time'
                : 'Calling hours are OFF — leads can be dialed at any hour'}
          </p>
          <label className="flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={enforceHours}
              onClick={handleToggleHours}
              disabled={loadingToggle || savingToggle || !isSupervisor}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${
                enforceHours ? 'bg-action-call' : 'bg-shadow/40'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                  enforceHours ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-xs font-medium text-text-secondary">Enforce calling hours (8am–9pm local)</span>
            {!isSupervisor && <span className="text-xs text-text-secondary">(only a supervisor can change this)</span>}
          </label>
          <p className="mt-1 text-xs text-text-secondary">
            On by default. Saved as soon as you flip it. When on, the dialer never calls a lead outside
            8am–9pm in any time zone the lead could be in (from the phone's area code, the address and
            the state); a lead whose time zone is unknown is not dialed until its state is set. The dial
            pad uses the number's area code.
          </p>
        </div>
        <div className="rounded-input bg-surface p-3 text-xs text-text-secondary shadow-neu-inset">
          Recordings are only saved for calls where a real conversation happened —
          voicemails, no-answers, and busy signals are never recorded. Several US states
          require verbally notifying the other party that a call may be recorded —
          consider adding this line to your pitch script.
        </div>
        {error && <p className="text-sm text-action-hangup">{error}</p>}
        {saved && <p className="text-sm text-action-contacted">Saved.</p>}
        <NeuButton type="submit">Save defaults</NeuButton>
      </form>
    </NeuCard>
  );
}

/** Reporting day: which timezone "today" uses for the dashboard counters,
 * the daily goal, reports and the PDF, and when that day starts. Both are
 * server settings (reporting_timezone, day_start_time); the server checks
 * the values. */
function ReportingDaySection() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'supervisor';
  const [timezone, setTimezone] = useState('');
  const [dayStart, setDayStart] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.getSetting('reporting_timezone'), api.getSetting('day_start_time')])
      .then(([tz, start]) => {
        setTimezone(tz.value || '');
        setDayStart(start.value || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.putSetting('reporting_timezone', timezone.trim());
      await api.putSetting('day_start_time', dayStart);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <NeuCard className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Reporting day</h2>
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary" htmlFor="reporting-timezone">
            Reporting timezone
          </label>
          <NeuInput
            id="reporting-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={loading || !isSupervisor}
            className="w-64"
          />
          <p className="mt-1 text-xs text-text-secondary">
            An IANA name, e.g. Asia/Karachi. "Today" on the dashboard, the daily goal, reports and the PDF use this timezone.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary" htmlFor="day-start-time">
            Day starts at
          </label>
          <NeuInput
            id="day-start-time"
            type="time"
            value={dayStart}
            onChange={(e) => setDayStart(e.target.value)}
            disabled={loading || !isSupervisor}
            className="w-32"
          />
          <p className="mt-1 text-xs text-text-secondary">
            A day runs from this time to the same time the next day, in the reporting timezone.
          </p>
        </div>
        {error && <p className="text-sm text-action-hangup">{error}</p>}
        {saved && <p className="text-sm text-action-contacted">Saved.</p>}
        {!isSupervisor && <p className="text-xs text-text-secondary">Only a supervisor can change the reporting day.</p>}
        <NeuButton type="submit" disabled={loading || !isSupervisor}>Save reporting day</NeuButton>
      </form>
    </NeuCard>
  );
}

function ScriptEditorSection() {
  // This user's own script (a per-user server setting, F-48).
  const { settings: mine, save: saveMine } = useUserSettings();
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (mine?.pitch_script) setScript(mine.pitch_script);
  }, [mine]);

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await saveMine('pitch_script', script);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <NeuCard className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Pitch script</h2>
      <p className="text-xs text-text-secondary">
        Customize the pitch script shown on the call screen. Use <code>{'{name}'}</code> where your name
        should appear.
      </p>
      <form onSubmit={handleSave} className="space-y-3">
        <NeuInput
          as="textarea"
          rows={5}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          className="w-full resize-none"
        />
        {error && <p className="text-sm text-action-hangup">{error}</p>}
        {saved && <p className="text-sm text-action-contacted">Saved.</p>}
        <NeuButton type="submit">Save script</NeuButton>
      </form>
    </NeuCard>
  );
}

function IntegrationsSection() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'supervisor';
  // The key is write-only (F-47): the server says only whether one is set
  // and its last 4 characters. The field is for a replacement.
  const [groqKey, setGroqKey] = useState('');
  const [status, setStatus] = useState({ configured: false, last4: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getSetting('groq-key')
      .then(({ configured, last4 }) => setStatus({ configured: Boolean(configured), last4 }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { setting } = await api.putSetting('groq-key', groqKey.trim());
      setStatus({ configured: Boolean(setting?.configured), last4: setting?.last4 ?? null });
      setGroqKey('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <NeuCard className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Integrations</h2>
      <p className="text-xs text-text-secondary">
        Configure the Groq API key used for AI CSV column mapping and the ✨ Expand note button — without it,
        those features degrade gracefully (manual mapping, notes unchanged).
      </p>
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Groq API key</label>
          <p className="mb-2 text-xs text-text-secondary" data-testid="groq-key-status">
            {loading
              ? 'Checking…'
              : status.configured
                ? `Configured ✓${status.last4 ? ` (ending ····${status.last4})` : ''}`
                : 'Not configured'}
          </p>
          <NeuInput
            type="password"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder={status.configured ? 'Paste a new key to replace it' : 'gsk_…'}
            className="w-full"
            autoComplete="off"
            disabled={!isSupervisor}
          />
          {!isSupervisor && <p className="mt-1 text-xs text-text-secondary">Only a supervisor can change this.</p>}
        </div>
        {error && <p className="text-sm text-action-hangup">{error}</p>}
        {saved && <p className="text-sm text-action-contacted">Saved.</p>}
        <NeuButton type="submit" disabled={saving || loading || !isSupervisor || !groqKey.trim()}>
          {saving ? 'Saving…' : status.configured ? 'Replace key' : 'Save key'}
        </NeuButton>
      </form>
    </NeuCard>
  );
}

/** Objection chips shown on the call screen. No delete: a deactivated type
 * leaves the call screen but keeps its history in Reports. */
function ObjectionsSection() {
  const [types, setTypes] = useState([]);
  const [labels, setLabels] = useState({}); // id -> label being edited
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    api
      .listObjectionTypes(true)
      .then(({ types: t }) => setTypes(t))
      .catch((err) => setMessage({ type: 'error', text: err.message }));
  }, []);

  const flash = (text) => {
    setMessage({ type: 'ok', text });
    setTimeout(() => setMessage(null), 2000);
  };

  const run = async (fn, okText) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (okText) flash(okText);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const replaceType = (updated) => setTypes((list) => list.map((t) => (t.id === updated.id ? updated : t)));

  const handleRename = (type) => {
    const label = labels[type.id];
    if (label === undefined || label.trim() === type.label) return;
    run(async () => {
      try {
        const { type: updated } = await api.updateObjectionType(type.id, { label });
        replaceType(updated);
      } finally {
        setLabels(({ [type.id]: _, ...rest }) => rest);
      }
    }, 'Renamed.');
  };

  const handleToggle = (type) =>
    run(async () => {
      const { type: updated } = await api.updateObjectionType(type.id, { isActive: !type.is_active });
      replaceType(updated);
    });

  const handleMove = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= types.length) return;
    const reordered = [...types];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    run(async () => {
      const { types: saved } = await api.reorderObjectionTypes(reordered.map((t) => t.id));
      setTypes(saved);
    });
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    run(async () => {
      const { type } = await api.createObjectionType(newLabel);
      setTypes((list) => [...list, type]);
      setNewLabel('');
    }, 'Objection added.');
  };

  return (
    <NeuCard className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Objections</h2>
      <p className="text-xs text-text-secondary">
        The chips shown behind the Objection button on the call screen, in this order. Switching one off hides
        it from the call screen; everything already logged stays in Reports.
      </p>
      <ul className="space-y-2">
        {types.map((type, index) => (
          <li key={type.id} className={`flex items-center gap-2 ${type.is_active ? '' : 'opacity-50'}`}>
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => handleMove(index, -1)}
                disabled={busy || index === 0}
                aria-label={`Move ${type.label} up`}
                className="px-1 text-[10px] leading-none text-text-secondary hover:text-text-primary disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => handleMove(index, 1)}
                disabled={busy || index === types.length - 1}
                aria-label={`Move ${type.label} down`}
                className="px-1 text-[10px] leading-none text-text-secondary hover:text-text-primary disabled:opacity-30"
              >
                ▼
              </button>
            </div>
            <NeuInput
              value={labels[type.id] ?? type.label}
              onChange={(e) => setLabels((l) => ({ ...l, [type.id]: e.target.value }))}
              onBlur={() => handleRename(type)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label={`Objection label: ${type.label}`}
              className="flex-1 text-sm"
            />
            <button
              type="button"
              role="switch"
              aria-checked={type.is_active}
              aria-label={`${type.is_active ? 'Deactivate' : 'Activate'} ${type.label}`}
              onClick={() => handleToggle(type)}
              disabled={busy}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${
                type.is_active ? 'bg-action-call' : 'bg-shadow/40'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                  type.is_active ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} className="flex gap-2">
        <NeuInput
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add an objection, e.g. Using a CRM already"
          className="flex-1 text-sm"
          maxLength={80}
        />
        <NeuButton type="submit" disabled={busy || !newLabel.trim()}>
          Add
        </NeuButton>
      </form>
      {message && (
        <p className={`text-sm ${message.type === 'ok' ? 'text-action-contacted' : 'text-action-hangup'}`}>
          {message.text}
        </p>
      )}
    </NeuCard>
  );
}

export default function Settings() {
  return (
    <AppShell>
      <div className="mx-auto mt-4 max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
        <ProfileSection />
        <DialingDefaultsSection />
        <ReportingDaySection />
        <ScriptEditorSection />
        <ObjectionsSection />
        <IntegrationsSection />
      </div>
    </AppShell>
  );
}
