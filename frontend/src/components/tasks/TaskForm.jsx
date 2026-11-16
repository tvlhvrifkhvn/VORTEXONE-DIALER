// The task fields (C3A), shared by the lead page panel and the call screen's
// ADD TASK dialog: title, type, due (local date and time). Calls onSubmit
// with { title, type, dueAt (ISO) }.
import { useId, useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';

export const TASK_TYPES = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'text', label: 'Text' },
  { value: 'other', label: 'Other' },
];

/** "YYYY-MM-DDTHH:MM" in local time, for a datetime-local input. */
export function localInputValue(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Tomorrow at 10:00 local: a sensible default due time. */
export function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return localInputValue(d);
}

export default function TaskForm({ onSubmit, submitLabel = 'Add task', busy = false, initialTitle = '' }) {
  const id = useId();
  const [title, setTitle] = useState(initialTitle);
  const [type, setType] = useState('call');
  const [due, setDue] = useState(defaultDue);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !due) return;
    const ok = await onSubmit({ title: title.trim(), type, dueAt: new Date(due).toISOString() });
    if (ok !== false) {
      setTitle('');
      setDue(defaultDue());
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] flex-1">
        <label htmlFor={`${id}-title`} className="label mb-2 block">Task</label>
        <Field id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Send the pricing sheet" className="w-full" />
      </div>
      <div>
        <label htmlFor={`${id}-type`} className="label mb-2 block">Type</label>
        <Field as="select" id={`${id}-type`} value={type} onChange={(e) => setType(e.target.value)} className="w-28">
          {TASK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </Field>
      </div>
      <div>
        <label htmlFor={`${id}-due`} className="label mb-2 block">Due</label>
        <Field id={`${id}-due`} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="font-mono text-sm" />
      </div>
      <Button type="submit" variant="primary" disabled={busy || !title.trim() || !due}>
        {submitLabel}
      </Button>
    </form>
  );
}
