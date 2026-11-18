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

// C8E: `columns={3}` on the call screen (same order, left to right), 48px high.
export default function DispositionButtons({ onSelect, disabled, columns = 2 }) {
  return (
    <div className={`grid gap-2 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`} data-testid="outcome-buttons">
      {DISPOSITIONS.map((d) => (
        <ActionButton
          key={d.key}
          variant={d.variant}
          disabled={disabled}
          onClick={() => onSelect(d.key)}
          className={`flex items-center justify-center gap-2 ${columns === 3 ? 'min-h-12 px-2' : 'min-h-[52px]'}`}
        >
          {d.hotkey && <Keycap>{d.hotkey}</Keycap>}
          {d.label}
        </ActionButton>
      ))}
    </div>
  );
}
