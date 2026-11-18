// The Block 3 page frame (C7B, docs/CRM_PLAN.md): an optional left rail
// (248px), the main column and an optional right rail (320px), separated by
// hairlines. From 1024px each region scrolls on its own inside the height
// AppShell gives it (<AppShell framed>), so the page itself doesn't scroll.
// Below 1024px the rails stack under the main column and the page scrolls.
// Each rail collapses with a small « / » button; the choice is kept per page
// in localStorage (`vortex.rails.<id>`).
import { useEffect, useState } from 'react';

const STORAGE = 'vortex.rails.';

function readCollapsed(id) {
  try {
    return JSON.parse(localStorage.getItem(STORAGE + id) || '{}');
  } catch {
    return {};
  }
}

// C8A: 32px, muted, at the top of the rail.
const toggleClass =
  'min-h-8 min-w-8 px-2 font-mono text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground';

function Rail({ side, label, collapsed, onToggle, children }) {
  const left = side === 'left';
  const width = left ? 'lg:w-[248px]' : 'lg:w-[320px]';
  if (collapsed) {
    return (
      <div className={`hidden shrink-0 lg:flex lg:flex-col ${left ? 'border-r lg:order-1' : 'border-l lg:order-3'}`}>
        <button type="button" onClick={onToggle} aria-label={`Show ${label}`} aria-expanded="false" className={toggleClass}>
          {left ? '»' : '«'}
        </button>
      </div>
    );
  }
  return (
    <aside
      aria-label={label}
      className={`order-2 border-t lg:min-h-0 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 ${width} ${left ? 'lg:order-1 lg:border-r' : 'order-3 lg:order-3 lg:border-l'}`}
    >
      <div className={`hidden lg:flex ${left ? 'justify-end' : 'justify-start'}`}>
        <button type="button" onClick={onToggle} aria-label={`Hide ${label}`} aria-expanded="true" className={toggleClass}>
          {left ? '«' : '»'}
        </button>
      </div>
      <div className="px-4 pb-6 pt-2 lg:pt-0">{children}</div>
    </aside>
  );
}

export default function PageFrame({ id, left, right, leftLabel = 'Side menu', rightLabel = 'Side panel', mainClassName = '', openRight = 0, children }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));
  // C7D: a page can open the right rail (e.g. ADD TASK on the lead page); bump openRight.
  useEffect(() => {
    if (openRight) setCollapsed((c) => (c.right ? { ...c, right: false } : c));
  }, [openRight]);
  const toggle = (side) =>
    setCollapsed((c) => {
      const next = { ...c, [side]: !c[side] };
      try {
        localStorage.setItem(STORAGE + id, JSON.stringify(next));
      } catch {
        /* the choice lasts for this visit */
      }
      return next;
    });

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0 lg:flex-row" data-testid="page-frame">
      {left && (
        <Rail side="left" label={leftLabel} collapsed={Boolean(collapsed.left)} onToggle={() => toggle('left')}>
          {left}
        </Rail>
      )}
      {/* AppShell's <main> holds the frame; this is the main column. */}
      <div className={`order-1 min-w-0 flex-1 px-6 pb-10 lg:order-2 lg:min-h-0 lg:overflow-y-auto ${mainClassName}`}>{children}</div>
      {right && (
        <Rail side="right" label={rightLabel} collapsed={Boolean(collapsed.right)} onToggle={() => toggle('right')}>
          {right}
        </Rail>
      )}
    </div>
  );
}
