import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import '@fontsource-variable/inter-tight';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/globals.css';

// Theme before first paint: 'ink' is the default, 'paper' only when chosen.
// See docs/DESIGN.md section 1. The old key held light/dark and is dropped.
try {
  document.documentElement.dataset.theme = localStorage.getItem('vortex.theme') === 'paper' ? 'paper' : 'ink';
  localStorage.removeItem('vortex_dialer_theme');
} catch {
  document.documentElement.dataset.theme = 'ink';
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
