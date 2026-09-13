import ActionButton from '../ui/ActionButton';

// The six disposition buttons — see CLAUDE.md for the color table. Order
// matches the brief: contacted, voicemail/no-answer, the two no-contact
// variants, then DNC.
const DISPOSITIONS = [
  { key: 'contacted', label: 'Spoke / Interested', variant: 'contacted' },
  { key: 'voicemail', label: 'Voicemail', variant: 'neutral' },
  { key: 'no_answer', label: 'No Answer', variant: 'neutral' },
  { key: 'no_contact_number', label: 'No Contact — Number', variant: 'warn' },
  { key: 'no_contact_person', label: 'No Contact — Person', variant: 'warn' },
  { key: 'dnc', label: 'DNC', variant: 'dnc' },
];

export default function DispositionButtons({ onSelect, disabled }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {DISPOSITIONS.map((d) => (
        <ActionButton key={d.key} variant={d.variant} disabled={disabled} onClick={() => onSelect(d.key)}>
          {d.label}
        </ActionButton>
      ))}
    </div>
  );
}
