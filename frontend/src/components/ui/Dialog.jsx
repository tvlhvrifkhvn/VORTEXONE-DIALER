import { useId } from 'react';

// Dialog (DESIGN.md section 5): scrim plus a square frame. No key handlers:
// Esc already ends calls. "CLOSE ×" shows only when onClose is given.
// `inline` renders the frame without the fixed scrim (for /styleguide).
export default function Dialog({ title, onClose, children, inline = false, className = '' }) {
  const titleId = useId();
  const frame = (
    <div
      role="dialog"
      aria-modal={inline ? undefined : 'true'}
      aria-labelledby={titleId}
      className={`w-full max-w-lg border border-strong bg-card ${className}`}
    >
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2">
        <h2 id={titleId} className="font-mono text-sm font-medium uppercase tracking-button text-foreground">
          {title}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 px-2 font-mono text-sm font-medium uppercase tracking-button text-foreground hover:bg-muted"
          >
            CLOSE ×
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
  if (inline) return frame;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">{frame}</div>;
}
