import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Phone, Search } from 'lucide-react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Badge from '../ui/Badge';
import CampaignSwitcher from './CampaignSwitcher';
import SpendMeter from './SpendMeter';
import AssistantPanel from '../assistant/AssistantPanel';
import ReminderToasts from './ReminderToasts';
import Meter from '../ui/Meter';
import Menu from '../ui/Menu';
import CallingHoursChip from './CallingHoursChip';
import Segmented from '../ui/Segmented';
import StatusDot from '../ui/StatusDot';
import { useAuth } from '../../hooks/useAuth';
import { useImportJob } from '../../hooks/useImportJob';
import { getActiveSessionId } from '../../hooks/useCall';
import * as api from '../../lib/api';
import { pollWhileVisible } from '../../lib/poll';
import { useToday } from '../../hooks/useToday';

const navLinkClasses = ({ isActive }) =>
  `inline-flex min-h-10 items-center whitespace-nowrap px-2 font-mono text-xs font-medium uppercase tracking-button transition-colors duration-150 2xl:text-sm ${
    isActive ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
  }`;

const THEME_KEY = 'vortex.theme';

/** "Talha Arif" → "TA" (the user menu's button). */
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
const SEARCH_DEBOUNCE_MS = 300;

// darkMode === true means the 'ink' theme (the default); false means 'paper'.
function getInitialDarkMode() {
  try {
    return localStorage.getItem(THEME_KEY) !== 'paper';
  } catch {
    return true;
  }
}

/** Navbar search across all states — debounced, shows a results dropdown,
 * and opens the lead detail panel directly on click. C8A: 280px from 1680px
 * wide; narrower, a search icon button that opens the field under the header. */
function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false); // below 1680px only
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const { leads } = await api.searchLeads(query);
        setResults(leads);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  return (
    <div ref={containerRef} className="relative min-[1680px]:w-[280px]">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        aria-label="Search all leads"
        aria-expanded={expanded}
        className={`inline-flex min-h-10 min-w-10 items-center justify-center transition-colors duration-150 min-[1680px]:hidden ${
          expanded ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
        }`}
      >
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <div
        className={`${expanded ? 'absolute right-0 top-full z-40 mt-1 block w-[320px] border border-strong bg-card p-2' : 'hidden'} min-[1680px]:static min-[1680px]:mt-0 min-[1680px]:block min-[1680px]:w-auto min-[1680px]:border-0 min-[1680px]:bg-transparent min-[1680px]:p-0`}
      >
      <div className="relative">
        <Search
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Field
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search all leads…"
          aria-label="Search all leads"
          className="w-full pl-9 text-sm"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-40 mt-1 w-full border border-strong bg-card text-sm">
          {results.map((lead) => (
            <li key={lead.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setExpanded(false);
                  setQuery('');
                  navigate(`/leads/${lead.id}`);
                }}
                className="flex w-full flex-col px-3 py-2 text-left transition-colors duration-150 hover:bg-muted"
              >
                <span className="max-w-full truncate font-medium text-foreground" title={lead.name}>{lead.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {lead.phone} · {lead.state}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}

const SMS_POLL_MS = 30000;
const LAST_SEEN_SMS_KEY = 'vortex_last_seen_sms_at';

/** Part F3/F4 — unread-inbox badge + "new message" toast, polling the same
 * way useSessionLive above does (no separate polling module to reuse yet
 * for this kind of ambient cross-page state). */
function useSmsInboxPoll() {
  const navigate = useNavigate();
  const [unreadLeadCount, setUnreadLeadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const { leads, unmatchedUnread } = await api.getSmsInbox(1, 50);
        if (cancelled) return;
        // Unread texts from unknown numbers count too, until marked read.
        setUnreadLeadCount(leads.length + (unmatchedUnread || 0));

        const newest = leads[0];
        if (newest?.lastMessageAt) {
          const lastSeen = localStorage.getItem(LAST_SEEN_SMS_KEY);
          if (!lastSeen || new Date(newest.lastMessageAt) > new Date(lastSeen)) {
            localStorage.setItem(LAST_SEEN_SMS_KEY, newest.lastMessageAt);
            if (lastSeen) {
              const toast = document.createElement('button');
              toast.type = 'button';
              toast.textContent = `New message from ${newest.leadName}`;
              toast.className =
                'fixed bottom-4 right-4 z-50 border border-l-[3px] border-strong border-l-primary bg-card px-4 py-3 ' +
                'text-left text-sm text-foreground hover:bg-muted';
              toast.onclick = () => {
                navigate('/inbox');
                toast.remove();
              };
              document.body.appendChild(toast);
              setTimeout(() => toast.remove(), 6000);
            }
          }
        }
      } catch {
        // best-effort — a failed poll just tries again in 30s
      }
    };
    poll();
    const stop = pollWhileVisible(poll, SMS_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return unreadLeadCount;
}

/** C3B: how many callbacks and tasks are due today (overdue included), for the TODAY badge.
 * C7A: from the shared Today poll (hooks/useToday.js), which the Today page reuses. */
function useTodayDue() {
  const today = useToday();
  return today ? today.callbacks.total + today.tasks.total : 0;
}

const SESSION_POLL_MS = 2000;

/** Whether a dialing session is currently running, for the navbar's "Live"
 * badge — cheap localStorage read (see useCall.js's getActiveSessionId),
 * rechecked on navigation and on a short poll so starting/ending a session
 * on /dialer updates the badge without a page change. */
function useSessionLive() {
  const location = useLocation();
  const [live, setLive] = useState(() => !!getActiveSessionId());

  useEffect(() => {
    setLive(!!getActiveSessionId());
  }, [location.pathname]);

  useEffect(() => {
    const id = setInterval(() => setLive(!!getActiveSessionId()), SESSION_POLL_MS);
    return () => clearInterval(id);
  }, []);

  return live;
}

/** Persistent progress pill while an import runs, so leaving the Import page
 * never feels like the work was lost. Clicking it goes back to that page. */
function ImportProgressBadge() {
  const { job, isActive } = useImportJob();
  const navigate = useNavigate();

  if (!isActive) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/import')}
      title={`Importing ${job.filename || 'leads'} — ${job.phaseLabel || `${job.processedRows}/${job.totalRows} rows`}`}
      className="w-32 shrink-0 px-2 py-1 text-left transition-colors duration-150 hover:bg-muted"
    >
      <Meter
        label="Importing"
        value={job.processedRows || 0}
        max={job.totalRows || 0}
        tone="goal"
        format={(n) => Number(n).toLocaleString('en-US')}
      />
    </button>
  );
}

// C7B: the header stays fixed; from 1024px the page itself doesn't scroll:
// the main region does, or, with `framed`, the PageFrame regions inside it.
export default function AppShell({ children, framed = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);
  const sessionLive = useSessionLive();
  const unreadSmsCount = useSmsInboxPoll();
  const todayDue = useTodayDue();
  const [askOpen, setAskOpen] = useState(false); // C5B: the ASK drawer

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'ink' : 'paper';
    try {
      localStorage.setItem(THEME_KEY, darkMode ? 'ink' : 'paper');
    } catch {
      /* storage unavailable: the theme still applies for this visit */
    }
  }, [darkMode]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">
      {/* C8A: one header row, 56px: wordmark · file switcher · nav · search ·
          calling hours · spend · ASK · DIAL · user menu. No wrapping from 1180px. */}
      <header className="border-b lg:shrink-0">
        <div className="flex min-h-14 flex-wrap items-center gap-4 px-6 py-2 xl:flex-nowrap">
          <span className="hidden whitespace-nowrap text-lg font-semibold tracking-[-0.01em] text-foreground xl:inline">VORTEX ONE</span>
          {/* C1E: the FileTag is the campaign switcher. */}
          <CampaignSwitcher />

          <nav aria-label="Main" className="flex shrink-0">
            {/* C3B: section 4 order. C8A: IMPORT is on the Leads page (C8B), SETTINGS in the user menu. */}
            <NavLink to="/" end className={navLinkClasses}>
              {({ isActive }) => (
                <span className="inline-flex items-center gap-2">
                  Today
                  {todayDue > 0 && (
                    <Badge tone={isActive ? 'muted' : 'solid'} className="tabular-nums">
                      {todayDue}
                      <span className="sr-only"> due</span>
                    </Badge>
                  )}
                </span>
              )}
            </NavLink>
            <NavLink to="/pipeline" className={navLinkClasses}>
              Pipeline
            </NavLink>
            <NavLink to="/leads" className={navLinkClasses}>
              Leads
            </NavLink>
            <NavLink to="/dialer" className={navLinkClasses}>
              <span className="inline-flex items-center gap-2">
                Dialer
                {sessionLive && <StatusDot tone="live">Live</StatusDot>}
              </span>
            </NavLink>
            <NavLink to="/inbox" className={navLinkClasses}>
              {({ isActive }) => (
                <span className="inline-flex items-center gap-2">
                  Inbox
                  {unreadSmsCount > 0 && (
                    // Solid, except on the active (already solid) tab.
                    <Badge tone={isActive ? 'muted' : 'solid'} className="tabular-nums">
                      {unreadSmsCount}
                      <span className="sr-only"> unread</span>
                    </Badge>
                  )}
                </span>
              )}
            </NavLink>
            <NavLink to="/reports" className={navLinkClasses}>
              Reports
            </NavLink>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-4">
            <GlobalSearch />
            <ImportProgressBadge />
            <CallingHoursChip />
            <SpendMeter />
            <div className="flex items-center gap-2">
              <Button active={askOpen} aria-expanded={askOpen} onClick={() => setAskOpen((o) => !o)} title="Ask the assistant about your CRM data" className="px-3">
                Ask
              </Button>
              <Button onClick={() => navigate('/call/manual')} title="Dial a number" className="px-3">
                <Phone size={16} strokeWidth={1.5} aria-hidden="true" className="hidden 2xl:block" />
                Dial
              </Button>
            </div>
            <Menu
              ariaLabel={`Account${user?.name ? `: ${user.name}` : ''}`}
              title={user?.name}
              label={initials(user?.name)}
              variant="ghost"
              panelClassName="w-64"
              header={user && <p className="truncate border-b px-3 py-2 text-sm text-muted-foreground">{user.name}</p>}
              items={[
                { label: 'Settings', onSelect: () => navigate('/settings') },
                {
                  key: 'theme',
                  custom: (
                    <div className="flex min-h-10 items-center justify-between gap-4 px-3 py-2">
                      <span className="label">Theme</span>
                      <Segmented
                        label="Theme"
                        options={[
                          { value: 'ink', label: 'Ink' },
                          { value: 'paper', label: 'Paper' },
                        ]}
                        value={darkMode ? 'ink' : 'paper'}
                        onChange={(v) => setDarkMode(v === 'ink')}
                      />
                    </div>
                  ),
                },
                { label: 'Log out', onSelect: handleLogout },
              ]}
            />
          </div>
        </div>
      </header>
      <main
        className={framed ? 'lg:min-h-0 lg:flex-1 lg:overflow-hidden' : 'px-6 pb-10 lg:min-h-0 lg:flex-1 lg:overflow-y-auto'}
        data-testid="app-main"
      >
        {children}
      </main>
      {askOpen && <AssistantPanel onClose={() => setAskOpen(false)} />}
      {/* C6A: task and callback reminders. */}
      <ReminderToasts />
    </div>
  );
}
