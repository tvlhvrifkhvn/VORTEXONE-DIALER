// The high-contrast, solid-fill action buttons (Call, Hangup, the six
// disposition buttons). Deliberately NOT neumorphic — see CLAUDE.md →
// "Design language: neumorphism, with a critical exception".
const VARIANT_STYLES = {
  call: 'bg-action-call hover:bg-blue-600',
  hangup: 'bg-action-hangup hover:bg-red-600',
  contacted: 'bg-action-contacted hover:bg-emerald-600',
  neutral: 'bg-action-neutral hover:bg-gray-600',
  warn: 'bg-action-warn hover:bg-amber-600',
  dnc: 'bg-action-dnc hover:bg-red-700',
};

export default function ActionButton({ variant = 'neutral', children, className = '', disabled = false, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`
        ${VARIANT_STYLES[variant]} text-white font-semibold rounded-input
        px-4 py-3 shadow-md transition-colors duration-150
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-none
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}
