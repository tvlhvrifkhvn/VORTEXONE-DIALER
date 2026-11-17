// Settings → Integrations: the assistant on/off and its Groq model (C5B).
// Supervisor only; the server enforces it too (C5A settings whitelist).
import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Segmented from '../ui/Segmented';
import * as api from '../../lib/api';

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export default function AssistantSettings({ isSupervisor }) {
  const [enabled, setEnabled] = useState(true);
  const [model, setModel] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSetting('assistant_enabled').then(({ value }) => setEnabled(value !== 'false')).catch(() => {});
    api.getSetting('assistant_model').then(({ value }) => setModel(value || '')).catch(() => {});
  }, []);

  const save = async (fn) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (value) =>
    save(async () => {
      await api.putSetting('assistant_enabled', value === 'on' ? 'true' : 'false');
      setEnabled(value === 'on');
    });

  return (
    <div className="space-y-3 border-t pt-4" data-testid="assistant-settings">
      <p className="label">Assistant</p>
      <div className="flex flex-wrap items-center gap-4">
        <Segmented
          label="Assistant"
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={enabled ? 'on' : 'off'}
          onChange={(v) => isSupervisor && !saving && toggle(v)}
        />
        <p className="text-sm text-muted-foreground">The ASK drawer and the lead page's AI summary. Off: both say so.</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(() => api.putSetting('assistant_model', model.trim() || null));
        }}
      >
        <div className="min-w-64 flex-1">
          <label htmlFor="assistant-model" className="label mb-2 block">
            Model
          </label>
          <Field
            id="assistant-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_MODEL}
            className="w-full"
            disabled={!isSupervisor}
            maxLength={100}
          />
        </div>
        <Button type="submit" disabled={!isSupervisor || saving}>
          Save model
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Empty uses {DEFAULT_MODEL}. The model must support tool use on Groq.</p>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {saved && <p className="font-mono text-xs uppercase text-foreground">✓ Saved</p>}
    </div>
  );
}
