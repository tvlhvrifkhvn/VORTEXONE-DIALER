import { useId } from 'react';
import NeuInput from '../ui/NeuInput';

// The visible "Notes" heading is the section label around this field
// (DispositionPanel), so this label is for screen readers.
export default function NotesField({ value, onChange }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Notes
      </label>
      <NeuInput
        id={id}
        as="textarea"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What happened on this call?"
        className="w-full resize-none"
      />
    </div>
  );
}
