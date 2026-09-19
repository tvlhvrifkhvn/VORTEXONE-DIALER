import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Moon, Phone, Search, Sun } from 'lucide-react';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';
import { LeadDetailPanel } from '../leads/LeadRow';
import DialPad from '../call/DialPad';
import { useAuth } from '../../hooks/useAuth';
import { useImportJob } from '../../hooks/useImportJob';
import { getActiveSessionId } from '../../hooks/useCall';
import * as api from '../../lib/api';

const navLinkClasses = ({ isActive }) =>
  `rounded-input px-4 py-2 text-sm font-medium transition-shadow duration-150 ${
    isActive ? 'shadow-neu-pressed text-text-primary' : 'shadow-neu-sm hover:shadow-neu text-text-secondary'
  }`;

const THEME_KEY = 'vortex_dialer_theme';
const SEARCH_DEBOUNCE_MS = 300;

function getInitialDarkMode() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored) return stored === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
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
    <div className="hidden items-center gap-2 text-xs text-text-secondary lg:flex">
      {TIME_ZONES.map(({ label, tz }, i) => {
        const { timeStr, isLegalHours } = formatZoneTime(now, tz);
        return (
          <span key={label} className="flex items-center gap-2">
            {i > 0 && <span className="text-shadow">·</span>}
            <span className={isLegalHours ? 'font-medium text-action-contacted' : 'text-text-secondary'}>
              {label} {timeStr}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Navbar search across all states — debounced, shows a results dropdown,
 * and opens the lead detail panel directly on click. */
function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
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
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <NeuInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search all leads…"
          className="w-full py-1.5 pl-8 text-sm"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-40 mt-1 w-full space-y-1 rounded-input bg-surface p-2 text-sm shadow-neu">
          {results.map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedLead(lead);
                  setOpen(false);
                }}
                className="flex w-full flex-col rounded-input px-2 py-1.5 text-left hover:shadow-neu-sm"
              >
                <span className="font-medium text-text-primary">{lead.name}</span>
                <span className="text-xs text-text-secondary">
                  {lead.phone} · {lead.state}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedLead && (
        <LeadDetailPanel lead={selectedLead} onClose={() => setSelectedLead(null)} onSaved={() => setSelectedLead(null)} onDeleted={() => setSelectedLead(null)} />
      )}
    </div>
  );
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
      title={`Importing ${job.filename || 'leads'} — ${job.processedRows}/${job.totalRows} rows`}
      className="flex items-center gap-2 rounded-input px-3 py-1.5 text-xs font-medium text-text-primary shadow-neu-sm transition-shadow hover:shadow-neu"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-action-call" />
      Importing… {job.percentage}%
    </button>
  );
}

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);
  const [dialPadOpen, setDialPadOpen] = useState(false);
  const sessionLive = useSessionLive();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(THEME_KEY, darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-base">
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
        {/* Left zone: logo only. */}
        <span className="text-lg font-semibold text-text-primary">Vortex Dialer</span>

        {/* Center zone: nav links only. */}
        <nav className="flex gap-2">
          <NavLink to="/" end className={navLinkClasses}>
            Dashboard
          </NavLink>
          <NavLink to="/dialer" className={navLinkClasses}>
            <span className="inline-flex items-center gap-1.5">
              Dialer
              {sessionLive && (
                <span className="rounded-full bg-action-call px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Live
                </span>
              )}
            </span>
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

        {/* Right zone: search, clock, dark mode toggle, username, logout — all
            grouped flush to the right edge. */}
        <div className="flex items-center gap-4">
          <ImportProgressBadge />
          <GlobalSearch />
          <TimeZoneClock />
          {user && <span className="text-sm text-text-secondary">{user.name}</span>}
          <button
            type="button"
            onClick={() => setDialPadOpen(true)}
            title="Dial a number"
            aria-label="Dial a number"
            className="ripple flex h-9 w-9 items-center justify-center rounded-full text-action-call shadow-neu-sm transition-all duration-200 hover:shadow-neu"
          >
            <Phone size={16} />
          </button>
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="ripple flex h-9 w-9 items-center justify-center rounded-input text-text-secondary shadow-neu-sm transition-all duration-200 hover:shadow-neu hover:text-action-call"
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <NeuButton className="py-1.5 text-sm" onClick={handleLogout}>
            Log out
          </NeuButton>
        </div>
      </header>
      <main className="px-6 pb-10">{children}</main>

      {dialPadOpen && <DialPad onClose={() => setDialPadOpen(false)} />}
    </div>
  );
}
