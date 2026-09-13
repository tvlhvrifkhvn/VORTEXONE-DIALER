// Design tokens mirroring tailwind.config.js, for the places JS needs the
// raw value (status badge colors, the connect-rate chart) rather than a
// utility class. See CLAUDE.md for the design language this implements.

export const COLORS = {
  background: '#E4E9F0',
  textPrimary: '#3E4C63',
  textSecondary: '#6A7A94',
  highlight: '#FFFFFF',
  shadow: '#A3B1C6',
};

// The six disposition buttons + call/hangup use solid, high-contrast fills —
// deliberately NOT neumorphic, so a rep can find them at a glance while
// dialing fast. See CLAUDE.md → "Design language" for the reasoning.
export const ACTION_COLORS = {
  call: '#3B82F6',
  hangup: '#EF4444',
  contacted: '#10B981',
  neutral: '#6B7280',
  warn: '#F59E0B',
  dnc: '#DC2626',
};

// One color per lead status, used by StatusBadge. Grouped by what the
// status means for the rep: neutral/ready, active, needs-attention, terminal.
export const STATUS_COLORS = {
  new: COLORS.textSecondary,
  in_queue: COLORS.textSecondary,
  in_progress: ACTION_COLORS.call,
  contacted: ACTION_COLORS.contacted,
  voicemail: ACTION_COLORS.neutral,
  no_answer: ACTION_COLORS.neutral,
  callback_scheduled: '#8B5CF6',
  no_contact_number: ACTION_COLORS.warn,
  no_contact_person: ACTION_COLORS.warn,
  dnc: ACTION_COLORS.dnc,
  cold: '#94A3B8',
};

export const STATUS_LABELS = {
  new: 'New',
  in_queue: 'In queue',
  in_progress: 'In progress',
  contacted: 'Contacted',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  callback_scheduled: 'Callback scheduled',
  no_contact_number: 'Bad number',
  no_contact_person: 'No contact — person',
  dnc: 'DNC',
  cold: 'Cold',
};
