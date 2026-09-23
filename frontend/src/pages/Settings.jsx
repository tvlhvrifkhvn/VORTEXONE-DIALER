import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import { useAuth } from '../hooks/useAuth';
import * as api from '../lib/api';

const MAX_ATTEMPTS_KEY = 'vortex_dialer_default_max_attempts';
const GOAL_KEY = 'vortex_dialer_daily_goal'; // same key Dashboard.jsx's daily goal tracker reads
const SCRIPT_KEY = 'vortex_pitch_script'; // matches CallScreen.jsx's read key exactly
const DEFAULT_LINES_KEY = 'vortex_dialer_default_lines'; // Dashboard's line selector starts from this

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

function readLocalNumber(key, fallback) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

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
  const [maxAttempts, setMaxAttempts] = useState(() => readLocalNumber(MAX_ATTEMPTS_KEY, DEFAULT_MAX_ATTEMPTS));
  const [dailyGoal, setDailyGoal] = useState(() => readLocalNumber(GOAL_KEY, DEFAULT_GOAL));
  const [defaultLines, setDefaultLines] = useState(() => readLocalNumber(DEFAULT_LINES_KEY, DEFAULT_LINES));
  // Server-backed (settings table) since callingHours.js reads it directly —
  // unlike the fields above, this isn't a localStorage-only preference.
  const [enforceHours, setEnforceHours] = useState(false);
  const [loadingToggle, setLoadingToggle] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getSetting(CALLING_HOURS_KEY)
      .then(({ value }) => setEnforceHours(value === 'true'))
      .catch(() => {})
      .finally(() => setLoadingToggle(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    localStorage.setItem(MAX_ATTEMPTS_KEY, String(maxAttempts));
    localStorage.setItem(GOAL_KEY, String(dailyGoal));
    localStorage.setItem(DEFAULT_LINES_KEY, String(defaultLines));
    try {
      await api.putSetting(CALLING_HOURS_KEY, String(enforceHours));
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
          />
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
        <div>
          <label className="flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={enforceHours}
              onClick={() => setEnforceHours((v) => !v)}
              disabled={loadingToggle}
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
          </label>
          <p className="mt-1 text-xs text-text-secondary">
            Testing phase: off by default so leads can be dialed at any time. Turn on to block calls
            outside 8am–9pm local time for the lead's state.
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

function ScriptEditorSection() {
  const [script, setScript] = useState(() => localStorage.getItem(SCRIPT_KEY) || DEFAULT_SCRIPT);
  const [saved, setSaved] = useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    localStorage.setItem(SCRIPT_KEY, script);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
        {saved && <p className="text-sm text-action-contacted">Saved.</p>}
        <NeuButton type="submit">Save script</NeuButton>
      </form>
    </NeuCard>
  );
}

function IntegrationsSection() {
  const [groqKey, setGroqKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getSetting('groq-key')
      .then(({ value }) => setGroqKey(value || ''))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.putSetting('groq-key', groqKey);
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
          <NeuInput
            type="password"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder={loading ? 'Loading…' : 'gsk_…'}
            className="w-full"
            autoComplete="off"
          />
        </div>
        {error && <p className="text-sm text-action-hangup">{error}</p>}
        {saved && <p className="text-sm text-action-contacted">Saved.</p>}
        <NeuButton type="submit" disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save key'}
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
        <ScriptEditorSection />
        <ObjectionsSection />
        <IntegrationsSection />
      </div>
    </AppShell>
  );
}
