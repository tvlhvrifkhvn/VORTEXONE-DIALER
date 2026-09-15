import { useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import { useAuth } from '../hooks/useAuth';
import * as api from '../lib/api';

const MAX_ATTEMPTS_KEY = 'vortex_dialer_default_max_attempts';
const GOAL_KEY = 'vortex_dialer_daily_goal'; // same key Dashboard.jsx's daily goal tracker reads
const SCRIPT_KEY = 'vortex_dialer_pitch_script';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_GOAL = 100;
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
  const [saved, setSaved] = useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    localStorage.setItem(MAX_ATTEMPTS_KEY, String(maxAttempts));
    localStorage.setItem(GOAL_KEY, String(dailyGoal));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
        <p className="text-xs text-text-secondary">
          Calling hours: calls outside 8am–9pm local time (based on the lead's state) are blocked
          automatically — this isn't configurable here.
        </p>
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

export default function Settings() {
  return (
    <AppShell>
      <div className="mx-auto mt-4 max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
        <ProfileSection />
        <DialingDefaultsSection />
        <ScriptEditorSection />
      </div>
    </AppShell>
  );
}
