import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import NeuButton from '../ui/NeuButton';
import { useAuth } from '../../hooks/useAuth';

const navLinkClasses = ({ isActive }) =>
  `rounded-input px-4 py-2 text-sm font-medium transition-shadow duration-150 ${
    isActive ? 'shadow-neu-pressed text-text-primary' : 'shadow-neu-sm hover:shadow-neu text-text-secondary'
  }`;

const THEME_KEY = 'vortex_dialer_theme';

function getInitialDarkMode() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored) return stored === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);

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
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-text-primary">Vortex Dialer</span>
          <nav className="flex gap-2">
            <NavLink to="/" end className={navLinkClasses}>
              Dashboard
            </NavLink>
            <NavLink to="/import" className={navLinkClasses}>
              Import
            </NavLink>
            <NavLink to="/reports" className={navLinkClasses}>
              Reports
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user && <span className="text-sm text-text-secondary">{user.name}</span>}
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
    </div>
  );
}
