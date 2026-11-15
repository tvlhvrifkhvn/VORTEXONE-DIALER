import { useId } from 'react';
import Field from '../ui/Field';

// The visible "Notes" heading is the section label around this field
// (DispositionPanel), so this label is for screen readers.
export default function NotesField({ value, onChange }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Notes
      </label>
      <Field
        id={id}
        as="textarea"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What happened on this call?"
        className="w-full resize-none"
      />
    </div>
  );
}
