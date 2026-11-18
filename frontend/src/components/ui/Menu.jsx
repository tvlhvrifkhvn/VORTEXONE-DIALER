// Menu (C8A, DESIGN.md sections 5 and 9): a button ("⋯" or a label with ▾)
// that opens a list of actions. Keyboard: Enter, Space or ↓ on the button
// opens it on the first item; ↑ ↓ Home End move between items; Enter runs
// one; Tab leaves and closes it. Esc closes it and returns focus to the
// button, but only while focus is inside the menu: the key is stopped there,
// so it never reaches the call screen's Esc (end call). A click outside
// closes it too.
//
// `Popover` is the same frame for content that isn't a list of actions (the
// header's calling-hours zones, the user menu's theme switch).
import { useCallback, useEffect, useId, useRef, useState } from 'react';

const TRIGGER =
  'inline-flex items-center justify-center font-mono text-sm font-medium uppercase tracking-button transition-colors duration-150';
const TRIGGER_LOOK = {
  secondary: 'border border-strong text-foreground hover:bg-foreground hover:text-background',
  ghost: 'border border-transparent text-foreground hover:bg-muted',
  primary: 'border border-primary-border bg-primary text-primary-foreground hover:bg-foreground hover:text-background', // C8B: a split button's arrow
};
const TRIGGER_SIZE = {
  sm: 'min-h-8 min-w-8 gap-2 px-2',
  md: 'min-h-10 min-w-10 gap-2 px-3',
  lg: 'min-h-11 min-w-11 gap-2 px-3',
  chip: 'min-h-10 gap-1 px-2', // a header chip (calling hours)
};
const OPEN_LOOK = {
  secondary: 'border border-foreground bg-foreground text-background',
  ghost: 'border border-strong bg-muted text-foreground', // keeps muted text inside readable
  primary: 'border border-foreground bg-foreground text-background',
};

/** The shared open/close logic: outside click, Esc while focus is inside, focus back to the button. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // React's handler runs at the root, before window listeners: stopping the
  // event here keeps Esc away from the call screen's handler.
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      e.preventDefault();
      close();
    }
  };
  // Focus leaving the whole menu (Tab) closes it.
  const onBlur = (e) => {
    if (open && rootRef.current && !rootRef.current.contains(e.relatedTarget)) setOpen(false);
  };

  return { open, setOpen, close, rootRef, buttonRef, onKeyDown, onBlur };
}

function Trigger({ p, id, label, ariaLabel, title, size, variant, className, onOpenKey }) {
  return (
    <button
      ref={p.buttonRef}
      type="button"
      aria-haspopup="true"
      aria-expanded={p.open}
      aria-controls={p.open ? id : undefined}
      aria-label={ariaLabel}
      title={title}
      onClick={() => p.setOpen((o) => !o)}
      onKeyDown={onOpenKey}
      className={`${TRIGGER} ${TRIGGER_SIZE[size] || TRIGGER_SIZE.md} ${p.open ? OPEN_LOOK[variant] || OPEN_LOOK.secondary : TRIGGER_LOOK[variant] || TRIGGER_LOOK.secondary} ${className}`}
    >
      {label}
    </button>
  );
}

const PANEL = 'absolute z-40 mt-1 min-w-48 border border-strong bg-card';

/**
 * items: [{ label, onSelect, disabled, hint }] — `hint` is muted text on the right;
 *   or { key, custom } for a row of other content (e.g. the theme switch), skipped by the arrow keys.
 * label: the button's content (default "⋯"); give `ariaLabel` for an icon or "⋯" button.
 * header: optional content above the items (not focusable by the arrow keys).
 */
export default function Menu({
  items = [],
  label = '⋯',
  ariaLabel,
  title,
  header = null,
  align = 'right',
  size = 'md',
  variant = 'secondary',
  className = '',
  panelClassName = '',
}) {
  const p = usePopover();
  const id = useId();
  const listRef = useRef(null);
  const [focusFirst, setFocusFirst] = useState(null); // 'first' | 'last' | null

  const itemButtons = () => [...(listRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];

  useEffect(() => {
    if (!p.open || !focusFirst) return;
    const list = itemButtons();
    (focusFirst === 'last' ? list[list.length - 1] : list[0])?.focus();
    setFocusFirst(null);
  }, [p.open, focusFirst]);

  const onOpenKey = (e) => {
    if (['Enter', ' ', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      p.setOpen(true);
      setFocusFirst('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      p.setOpen(true);
      setFocusFirst('last');
    }
  };

  const onListKey = (e) => {
    const list = itemButtons();
    const at = list.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = list[(at + 1) % list.length];
    else if (e.key === 'ArrowUp') next = list[(at - 1 + list.length) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <div ref={p.rootRef} className="relative inline-flex" onKeyDown={p.onKeyDown} onBlur={p.onBlur}>
      <Trigger p={p} id={id} label={label} ariaLabel={ariaLabel} title={title} size={size} variant={variant} className={className} onOpenKey={onOpenKey} />
      {p.open && (
        <div id={id} className={`${PANEL} top-full ${align === 'left' ? 'left-0' : 'right-0'} ${panelClassName}`}>
          {header}
          <ul ref={listRef} role="menu" aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)} onKeyDown={onListKey}>
            {items.map((item) =>
              item.custom ? (
                <li key={item.key} role="none" className="border-b last:border-b-0">
                  {item.custom}
                </li>
              ) : (
              <li key={item.label} role="none" className="border-b last:border-b-0">
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    p.close();
                    item.onSelect?.();
                  }}
                  className="flex min-h-10 w-full items-center justify-between gap-4 whitespace-nowrap px-3 text-left font-mono text-sm font-medium uppercase tracking-button text-foreground transition-colors duration-150 hover:bg-muted focus:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {item.label}
                  {item.hint && <span className="font-mono text-xs normal-case text-muted-foreground">{item.hint}</span>}
                </button>
              </li>
              )
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A button that opens a small panel of content (same closing rules as Menu). */
export function Popover({ label, ariaLabel, title, align = 'right', size = 'md', variant = 'ghost', className = '', panelClassName = '', children }) {
  const p = usePopover();
  const id = useId();
  return (
    <div ref={p.rootRef} className="relative inline-flex" onKeyDown={p.onKeyDown} onBlur={p.onBlur}>
      <Trigger p={p} id={id} label={label} ariaLabel={ariaLabel} title={title} size={size} variant={variant} className={className} />
      {p.open && (
        <div id={id} role="dialog" aria-label={ariaLabel || title} className={`${PANEL} top-full ${align === 'left' ? 'left-0' : 'right-0'} ${panelClassName}`}>
          {typeof children === 'function' ? children({ close: p.close }) : children}
        </div>
      )}
    </div>
  );
}
