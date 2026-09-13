import NeuInput from '../ui/NeuInput';

export default function NotesField({ value, onChange }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-secondary">Notes</label>
      <NeuInput
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
