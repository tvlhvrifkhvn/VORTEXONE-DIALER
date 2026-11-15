import ActionButton from '../ui/ActionButton';
import Keycap from '../ui/Keycap';

// The six disposition buttons (docs/DESIGN.md: same 3×2 order, secondary
// look, keycaps on the real hotkeys). Order: contacted, voicemail/no-answer,
// the two no-contact variants, then DNC.
const DISPOSITIONS = [
  { key: 'contacted', label: 'Spoke / Interested', variant: 'neutral' },
  { key: 'voicemail', label: 'Voicemail', variant: 'neutral', hotkey: 'V' },
  { key: 'no_answer', label: 'No Answer', variant: 'neutral', hotkey: 'N' },
  { key: 'no_contact_number', label: 'No Contact — Number', variant: 'warn' },
  { key: 'no_contact_person', label: 'No Contact — Person', variant: 'warn' },
  { key: 'dnc', label: '⊘ DNC', variant: 'dnc' },
];

export default function DispositionButtons({ onSelect, disabled }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {DISPOSITIONS.map((d) => (
        <ActionButton
          key={d.key}
          variant={d.variant}
          disabled={disabled}
          onClick={() => onSelect(d.key)}
          className="flex min-h-[52px] items-center justify-center gap-2"
        >
          {d.hotkey && <Keycap>{d.hotkey}</Keycap>}
          {d.label}
        </ActionButton>
      ))}
    </div>
  );
}
