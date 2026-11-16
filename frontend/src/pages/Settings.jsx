import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import SectionLabel from '../components/ui/SectionLabel';
import { useAuth } from '../hooks/useAuth';
import * as api from '../lib/api';
import { useUserSettings } from '../hooks/useUserSettings';
import { useCampaign, fileLabel } from '../hooks/useCampaign';
import { refreshSpend } from '../hooks/useSpend';

// Global, supervisor only (F-48): applies to new leads (created or imported).
const MAX_ATTEMPTS_KEY = 'default_max_attempts';
// The old browser-only copy of it (removed on first load; see below).
const LEGACY_MAX_ATTEMPTS_KEY = 'vortex_dialer_default_max_attempts';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LINES = 3;
// Matches callingHours.js's ENFORCEMENT_SETTING_KEY — server-backed (the
// settings table), not localStorage, since the backend reads it directly.
const CALLING_HOURS_KEY = 'calling_hours_enforced';


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
    <Panel className="space-y-4 p-6">
      <SectionLabel index="01" title="Profile" />
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label htmlFor="profile-name" className="label mb-2 block">
            Display name
          </label>
          <Field id="profile-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full" required />
        </div>
        <div>
          <label htmlFor="profile-email" className="label mb-2 block">
            Email
          </label>
          <Field
            id="profile-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full"
            required
          />
        </div>
        {message && (
          <p role="status" className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
            {message.text}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </form>
    </Panel>
  );
}

function DialingDefaultsSection() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'supervisor';
  // Default lines are this user's own (server, F-48); max attempts is a
  // global server setting only a supervisor can change. The daily goal is
  // set per file since C1E (Settings → Files).
  const { settings: mine, save: saveMine } = useUserSettings();
  const [maxAttempts, setMaxAttempts] = useState(DEFAULT_MAX_ATTEMPTS);
  const [defaultLines, setDefaultLines] = useState(DEFAULT_LINES);
  useEffect(() => {
    if (!mine) return;
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
    <Panel className="space-y-4 p-6">
      <SectionLabel index="02" title="Dialing defaults" />
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label htmlFor="default-max-attempts" className="label mb-2 block">
            Default max attempts per lead (1–10)
          </label>
          <Field
            id="default-max-attempts"
            type="number"
            min="1"
            max="10"
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(Number(e.target.value))}
            className="w-32 font-mono tabular-nums"
            disabled={!isSupervisor}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            Applies to new leads (added or imported from now on). Existing leads keep their own value.
            {!isSupervisor && ' Only a supervisor can change this.'}
          </p>
        </div>
        <div>
          <label htmlFor="default-lines" className="label mb-2 block">
            Default simultaneous lines
          </label>
          <Field
            id="default-lines"
            as="select"
            value={defaultLines}
            onChange={(e) => setDefaultLines(Number(e.target.value))}
            className="w-32"
          >
            <option value={1}>1 line</option>
            <option value={2}>2 lines</option>
            <option value={3}>3 lines</option>
          </Field>
          <p className="mt-2 text-sm text-muted-foreground">
            How many leads a dialing session rings at once. Adjustable per session on the Leads page.
          </p>
        </div>
        <div
          className={`p-4 ${enforceHours ? 'border border-strong' : 'border-2 border-primary'}`}
          data-testid="calling-hours-state"
        >
          <p className="mb-2 text-sm font-semibold text-foreground">
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
              className={`relative h-6 w-11 shrink-0 border border-strong transition-colors duration-150 disabled:opacity-40 ${
                enforceHours ? 'bg-foreground' : 'bg-transparent'
              }`}
            >
              {/* Square switch: the knob sits right and inverts when on. */}
              <span
                aria-hidden="true"
                className={`absolute top-[3px] h-4 w-4 ${enforceHours ? 'left-[23px] bg-background' : 'left-[3px] bg-foreground'}`}
              />
            </button>
            <span className="font-mono text-xs font-medium uppercase text-foreground">
              Enforce calling hours (8am–9pm local) · {enforceHours ? 'On' : 'Off'}
            </span>
            {!isSupervisor && <span className="text-sm text-muted-foreground">(only a supervisor can change this)</span>}
          </label>
          <p className="mt-2 text-sm text-muted-foreground">
            On by default. Saved as soon as you flip it. When on, the dialer never calls a lead outside
            8am–9pm in any time zone the lead could be in (from the phone's area code, the address and
            the state); a lead whose time zone is unknown is not dialed until its state is set. The dial
            pad uses the number's area code.
          </p>
        </div>
        <div className="border bg-muted p-4 text-sm text-muted-foreground">
          Recordings are only saved for calls where a real conversation happened —
          voicemails, no-answers, and busy signals are never recorded. Several US states
          require verbally notifying the other party that a call may be recorded —
          consider adding this line to your pitch script.
        </div>
        {error && <p role="alert" className="text-sm text-signal">{error}</p>}
        {saved && <p className="font-mono text-xs uppercase text-foreground">✓ Saved</p>}
        <Button type="submit" variant="primary">Save defaults</Button>
      </form>
    </Panel>
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
    <Panel className="space-y-4 p-6">
      <SectionLabel index="03" title="Reporting day" />
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="label mb-2 block" htmlFor="reporting-timezone">
            Reporting timezone
          </label>
          <Field
            id="reporting-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={loading || !isSupervisor}
            className="w-64"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            An IANA name, e.g. Asia/Karachi. The Today page, the daily goal, reports and the PDF use this timezone.
          </p>
        </div>
        <div>
          <label className="label mb-2 block" htmlFor="day-start-time">
            Day starts at
          </label>
          <Field
            id="day-start-time"
            type="time"
            value={dayStart}
            onChange={(e) => setDayStart(e.target.value)}
            disabled={loading || !isSupervisor}
            className="w-32"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            A day runs from this time to the same time the next day, in the reporting timezone.
          </p>
        </div>
        {error && <p role="alert" className="text-sm text-signal">{error}</p>}
        {saved && <p className="font-mono text-xs uppercase text-foreground">✓ Saved</p>}
        {!isSupervisor && <p className="text-sm text-muted-foreground">Only a supervisor can change the reporting day.</p>}
        <Button type="submit" variant="primary" disabled={loading || !isSupervisor}>Save reporting day</Button>
      </form>
    </Panel>
  );
}

/** C1E: the daily goal and the pitch script are set per file. */
function FilesSection() {
  const { active } = useCampaign();
  return (
    <Panel className="space-y-4 p-6">
      <SectionLabel index="04" title="Files" meta={active ? fileLabel(active) : undefined} />
      <p className="text-sm text-muted-foreground">
        Each file has its own pitch script, daily goal, company label and AI context.
      </p>
      <Link
        to="/settings/campaigns"
        className="inline-flex min-h-10 items-center border border-strong px-4 font-mono text-sm font-medium uppercase tracking-button text-foreground transition-colors duration-150 hover:bg-foreground hover:text-background"
      >
        Manage files →
      </Link>
    </Panel>
  );
}

// C4B: the cost rates (cents, decimals allowed) and the global monthly budget
// (dollars here, cents on the server). Empty = not set. Supervisor only.
const RATE_FIELDS = [
  { key: 'rate_outbound_cents_per_min', label: 'Outbound · cents per minute', placeholder: 'e.g. 0.7' },
  { key: 'rate_recording_cents_per_min', label: 'Recording · cents per minute', placeholder: 'e.g. 0.25' },
  { key: 'rate_per_call_cents', label: 'Per call · cents', placeholder: 'e.g. 0.4' },
];

function SpendLimitsSection() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'supervisor';
  const [values, setValues] = useState({});
  const [budget, setBudget] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    Promise.all([...RATE_FIELDS.map((f) => api.getSetting(f.key)), api.getSetting('monthly_budget_cents')])
      .then((results) => {
        setValues(Object.fromEntries(RATE_FIELDS.map((f, i) => [f.key, results[i]?.value ?? ''])));
        const b = results[RATE_FIELDS.length]?.value;
        setBudget(b === null || b === undefined || b === '' ? '' : String(Number(b) / 100));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      for (const f of RATE_FIELDS) {
        const v = String(values[f.key] ?? '').trim();
        await api.putSetting(f.key, v === '' ? null : v);
      }
      const b = budget.trim();
      await api.putSetting('monthly_budget_cents', b === '' ? null : String(Math.round(Number(b) * 100)));
      await refreshSpend();
      setMessage({ type: 'ok', text: 'Spend limits saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel className="space-y-4 p-6" id="spend-limits">
      <SectionLabel index="07" title="Spend limits" />
      <p className="text-sm text-muted-foreground">
        Your phone provider's real rates. Until one is set, costs read "rates not set" and nothing is blocked. A call's
        cost is fixed when it ends. At 80 % of a budget the header warns; at 100 % dialing stops.
      </p>
      <form onSubmit={handleSave} className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-3">
          {RATE_FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`setting-${f.key}`} className="label mb-2 block">{f.label}</label>
              <Field
                id={`setting-${f.key}`}
                inputMode="decimal"
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full font-mono tabular-nums"
                disabled={loading || !isSupervisor}
              />
            </div>
          ))}
        </div>
        <div>
          <label htmlFor="setting-monthly-budget" className="label mb-2 block">Global monthly budget · USD</label>
          <Field
            id="setting-monthly-budget"
            type="number"
            min="0"
            step="0.01"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="No limit"
            className="w-40 font-mono tabular-nums"
            disabled={loading || !isSupervisor}
          />
        </div>
        {!isSupervisor && <p className="text-sm text-muted-foreground">Only a supervisor can change spend limits.</p>}
        {message && (
          <p role={message.type === 'ok' ? 'status' : 'alert'} className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
            {message.text}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={saving || loading || !isSupervisor}>
          {saving ? 'Saving…' : 'Save spend limits'}
        </Button>
      </form>
    </Panel>
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
    <Panel className="space-y-4 p-6">
      <SectionLabel index="06" title="Integrations" />
      <p className="text-sm text-muted-foreground">
        Configure the Groq API key used for AI CSV column mapping and the Expand note button — without it,
        those features degrade gracefully (manual mapping, notes unchanged).
      </p>
      <p className="text-sm text-muted-foreground">
        A key saved here lives in this app's database: it stays through restarts, but not if the Codespace is deleted or
        rebuilt. For a key that always stays, add a GitHub Codespaces secret named GROQ_API_KEY; a key saved here wins over it.
      </p>
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label htmlFor="groq-key" className="label mb-2 block">
            Groq API key
          </label>
          <p className="mb-2 font-mono text-xs uppercase text-foreground" data-testid="groq-key-status">
            {loading
              ? 'Checking…'
              : status.configured
                ? `Configured ✓${status.last4 ? ` (ending ····${status.last4})` : ''}`
                : 'Not configured'}
          </p>
          <Field
            id="groq-key"
            type="password"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder={status.configured ? 'Paste a new key to replace it' : 'gsk_…'}
            className="w-full"
            autoComplete="off"
            disabled={!isSupervisor}
          />
          {!isSupervisor && <p className="mt-2 text-sm text-muted-foreground">Only a supervisor can change this.</p>}
        </div>
        {error && <p role="alert" className="text-sm text-signal">{error}</p>}
        {saved && <p className="font-mono text-xs uppercase text-foreground">✓ Saved</p>}
        <Button type="submit" variant="primary" disabled={saving || loading || !isSupervisor || !groqKey.trim()}>
          {saving ? 'Saving…' : status.configured ? 'Replace key' : 'Save key'}
        </Button>
      </form>
    </Panel>
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
    <Panel className="space-y-4 p-6">
      <SectionLabel index="05" title="Objections" />
      <p className="text-sm text-muted-foreground">
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
                className="flex h-5 w-8 items-center justify-center text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => handleMove(index, 1)}
                disabled={busy || index === types.length - 1}
                aria-label={`Move ${type.label} down`}
                className="flex h-5 w-8 items-center justify-center text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:opacity-30"
              >
                ▼
              </button>
            </div>
            <Field
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
              className={`relative h-6 w-11 shrink-0 border border-strong transition-colors duration-150 disabled:opacity-40 ${
                type.is_active ? 'bg-foreground' : 'bg-transparent'
              }`}
            >
              {/* Square switch: the knob sits right and inverts when on. */}
              <span
                aria-hidden="true"
                className={`absolute top-[3px] h-4 w-4 ${type.is_active ? 'left-[23px] bg-background' : 'left-[3px] bg-foreground'}`}
              />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} className="flex gap-2">
        <Field
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add an objection, e.g. Using a CRM already"
          aria-label="New objection"
          className="flex-1 text-sm"
          maxLength={80}
        />
        <Button type="submit" variant="primary" disabled={busy || !newLabel.trim()}>
          Add
        </Button>
      </form>
      {message && (
        <p role="status" className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
          {message.text}
        </p>
      )}
    </Panel>
  );
}

export default function Settings() {
  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Settings</h1>
        <ProfileSection />
        <DialingDefaultsSection />
        <ReportingDaySection />
        <FilesSection />
        <ObjectionsSection />
        <IntegrationsSection />
        <SpendLimitsSection />
      </div>
    </AppShell>
  );
}
