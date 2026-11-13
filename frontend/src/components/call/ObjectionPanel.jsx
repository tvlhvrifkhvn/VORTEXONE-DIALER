import { useEffect, useState } from 'react';
import NeuInput from '../ui/NeuInput';
import * as api from '../../lib/api';

/**
 * One-tap objection logging mid-call. Each chip is a toggle: tap logs it on
 * this call right away, tap again removes it. Nothing here touches the
 * disposition flow, so it never interrupts or blocks the call.
 *
 * Hints come from stored data only (latest AI suggestion, else a rebuttal that
 * worked before) — Groq is never called from the call screen.
 */
export default function ObjectionPanel({ callId }) {
  const [types, setTypes] = useState([]);
  const [logged, setLogged] = useState([]); // [{ objection_type_id, label, rebuttal_used }]
  const [hints, setHints] = useState({});
  const [drafts, setDrafts] = useState({}); // typeId -> text being typed
  const [pending, setPending] = useState({}); // typeId -> true while its request is in flight
  const [savedId, setSavedId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listObjectionTypes().then(({ types: t }) => setTypes(t)).catch((err) => setError(err.message));
    api.getObjectionHints().then(({ hints: h }) => setHints(h)).catch(() => {});
  }, []);

  // callId changes on redial — each call's objections stay attached to it.
  useEffect(() => {
    setLogged([]);
    setDrafts({});
    if (!callId) return;
    api
      .getCallObjections(callId)
      .then(({ objections }) => setLogged(objections))
      .catch((err) => setError(err.message));
  }, [callId]);

  const isLogged = (typeId) => logged.some((o) => o.objection_type_id === typeId);

  const handleToggle = async (typeId) => {
    if (!callId || pending[typeId]) return;
    setError(null);
    setPending((p) => ({ ...p, [typeId]: true }));
    try {
      const { objections } = isLogged(typeId)
        ? await api.removeCallObjection(callId, typeId)
        : await api.logCallObjection(callId, typeId);
      setLogged(objections);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending((p) => ({ ...p, [typeId]: false }));
    }
  };

  const handleSaveRebuttal = async (objection) => {
    const typeId = objection.objection_type_id;
    const text = drafts[typeId];
    if (text === undefined || text.trim() === (objection.rebuttal_used || '')) return;
    setError(null);
    try {
      const { objections } = await api.saveObjectionRebuttal(callId, typeId, text);
      setLogged(objections);
      setSavedId(typeId);
      setTimeout(() => setSavedId((id) => (id === typeId ? null : id)), 1500);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!callId) {
    return <p className="text-xs text-text-secondary">Objections can be logged once the call has started.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {types.map((type) => {
          const on = isLogged(type.id);
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => handleToggle(type.id)}
              disabled={!!pending[type.id]}
              aria-pressed={on}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-all duration-200 disabled:opacity-50 ${
                on ? 'font-semibold text-action-call shadow-neu-pressed' : 'text-text-primary shadow-neu-sm hover:shadow-neu'
              }`}
            >
              {type.label}
            </button>
          );
        })}
      </div>

      {logged.map((objection) => {
        const typeId = objection.objection_type_id;
        const hint = hints[typeId];
        return (
          <div key={typeId} className="space-y-1 rounded-input p-2 shadow-neu-sm">
            <p className="text-xs font-semibold text-text-primary">{objection.label}</p>
            {hint && (
              <p className="text-[11px] text-text-secondary" data-testid="objection-hint">
                <span className="font-semibold">Try: </span>
                {hint.text}
              </p>
            )}
            <NeuInput
              value={drafts[typeId] ?? objection.rebuttal_used ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [typeId]: e.target.value }))}
              onBlur={() => handleSaveRebuttal(objection)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="What did you say? (optional)"
              className="w-full text-xs"
            />
            {savedId === typeId && <p className="text-[11px] text-action-contacted">Saved</p>}
          </div>
        );
      })}

      {error && <p className="text-xs text-action-hangup">{error}</p>}
    </div>
  );
}
