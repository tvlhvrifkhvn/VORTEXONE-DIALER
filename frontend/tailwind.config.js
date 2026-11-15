/** @type {import('tailwindcss').Config} */
// Neo-Swiss tokens: docs/DESIGN.md. Colors come from CSS variables in
// src/styles/globals.css, so the ink and paper themes switch without
// dark: classes.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // Replaced, not extended: radius 0 everywhere except dots.
    borderRadius: {
      none: '0',
      sm: '0',
      DEFAULT: '0',
      md: '0',
      lg: '0',
      xl: '0',
      '2xl': '0',
      '3xl': '0',
      full: '9999px',
    },
    // Replaced: no shadows.
    boxShadow: {
      none: 'none',
      sm: 'none',
      DEFAULT: 'none',
      md: 'none',
      lg: 'none',
      xl: 'none',
      '2xl': 'none',
      inner: 'none',
    },
    fontFamily: {
      sans: ['"Inter Tight Variable"', 'system-ui', 'sans-serif'],
      mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
    },
    fontSize: {
      xs: ['12px', '16px'],
      sm: ['13px', '18px'],
      base: ['14px', '20px'],
      lg: ['16px', '24px'],
      xl: ['20px', '28px'],
      '2xl': ['28px', '32px'],
      display: ['56px', '56px'],
    },
    extend: {
      colors: {
        background: token('background'),
        card: token('card'),
        muted: token('muted'),
        foreground: token('foreground'),
        'muted-foreground': token('muted-foreground'),
        border: token('border'),
        strong: token('border-strong'),
        primary: {
          DEFAULT: token('primary'),
          foreground: token('primary-foreground'),
          border: token('primary-border'),
        },
        signal: token('signal-text'),
        live: token('live'),
        'meter-track': token('meter-track'),
        scrim: 'rgb(14 14 14 / 0.8)',
      },
      borderColor: {
        DEFAULT: 'rgb(var(--border))',
      },
      letterSpacing: {
        label: '0.08em',
        button: '0.06em',
      },
    },
  },
  plugins: [],
};
