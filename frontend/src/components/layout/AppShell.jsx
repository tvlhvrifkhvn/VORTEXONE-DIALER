import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Phone, Search } from 'lucide-react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Badge from '../ui/Badge';
import CampaignSwitcher from './CampaignSwitcher';
import Meter from '../ui/Meter';
import Segmented from '../ui/Segmented';
import StatusDot from '../ui/StatusDot';
import { useAuth } from '../../hooks/useAuth';
import { useImportJob } from '../../hooks/useImportJob';
import { getActiveSessionId } from '../../hooks/useCall';
import * as api from '../../lib/api';

const navLinkClasses = ({ isActive }) =>
  `inline-flex min-h-10 items-center px-3 font-mono text-sm font-medium uppercase tracking-button transition-colors duration-150 ${
    isActive ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
  }`;

const THEME_KEY = 'vortex.theme';
const SEARCH_DEBOUNCE_MS = 300;

// darkMode === true means the 'ink' theme (the default); false means 'paper'.
function getInitialDarkMode() {
  try {
    return localStorage.getItem(THEME_KEY) !== 'paper';
  } catch {
    return true;
  }
}

const TIME_ZONES = [
  { label: 'EST', tz: 'America/New_York' },
  { label: 'CST', tz: 'America/Chicago' },
  { label: 'MST', tz: 'America/Denver' },
  { label: 'PST', tz: 'America/Los_Angeles' },
];

function formatZoneTime(now, tz) {
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(now)
    .replace(' ', '')
    .toLowerCase();
  const hour24 = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now)
  );
  const isLegalHours = hour24 >= 8 && hour24 < 21;
  return { timeStr, isLegalHours };
}

/** Live clock for all four US time zones the dialer calls into, updated
 * every second, green when it's within 8am-9pm calling hours there. */
function TimeZoneClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="hidden items-center gap-3 font-mono text-xs uppercase tabular-nums xl:flex">
      {TIME_ZONES.map(({ label, tz }) => {
        const { timeStr, isLegalHours } = formatZoneTime(now, tz);
        return (
          <span
            key={label}
            className="flex items-center gap-1"
            title={isLegalHours ? 'Inside calling hours (8am–9pm)' : 'Outside calling hours (8am–9pm)'}
          >
            <span className="text-muted-foreground">{label}</span>
            <span className={isLegalHours ? 'font-medium text-foreground' : 'text-muted-foreground line-through'}>
              {timeStr}
            </span>
            {!isLegalHours && <span className="sr-only">(outside calling hours)</span>}
          </span>
        );
      })}
    </div>
  );
}

/** Navbar search across all states — debounced, shows a results dropdown,
 * and opens the lead detail panel directly on click. */
function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
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
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-44 lg:w-56">
      <div className="relative">
        <Search
          size={16}
          strokeWidth={1.5}
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Field
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
    const id = setInterval(poll, SMS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return unreadLeadCount;
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
      className="w-48 px-2 py-1 text-left transition-colors duration-150 hover:bg-muted"
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

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);
  const sessionLive = useSessionLive();
  const unreadSmsCount = useSmsInboxPoll();

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
    <div className="min-h-screen bg-background">
      <header className="border-b">
        {/* Row 1: wordmark and campaign file on the left, nav, then the
            account controls flush right. */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-[-0.01em] text-foreground">VORTEX ONE</span>
              <span className="font-mono text-xs font-medium uppercase tracking-label text-muted-foreground">
                Outreach
              </span>
            </span>
            {/* C1E: the FileTag is the campaign switcher. */}
            <CampaignSwitcher />
          </div>

          <nav aria-label="Main" className="flex flex-wrap">
            <NavLink to="/" end className={navLinkClasses}>
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
            <NavLink to="/import" className={navLinkClasses}>
              Import
            </NavLink>
            <NavLink to="/reports" className={navLinkClasses}>
              Reports
            </NavLink>
            <NavLink to="/settings" className={navLinkClasses}>
              Settings
            </NavLink>
          </nav>

          <div className="flex items-center gap-4">
            {user && <span className="text-sm text-muted-foreground">{user.name}</span>}
            <Button onClick={() => navigate('/call/manual')} title="Dial a number">
              <Phone size={16} strokeWidth={1.5} aria-hidden="true" />
              Dial
            </Button>
            <Segmented
              label="Theme"
              options={[
                { value: 'ink', label: 'Ink' },
                { value: 'paper', label: 'Paper' },
              ]}
              value={darkMode ? 'ink' : 'paper'}
              onChange={(v) => setDarkMode(v === 'ink')}
            />
            <Button variant="ghost" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>

        {/* Row 2: search, import progress and the four US clocks. */}
        <div className="flex flex-wrap items-center gap-6 border-t px-6 py-2">
          <GlobalSearch />
          <ImportProgressBadge />
          <div className="ml-auto">
            <TimeZoneClock />
          </div>
        </div>
      </header>
      <main className="px-6 pb-10">{children}</main>
    </div>
  );
}
