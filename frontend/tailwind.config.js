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
      card: '0',
      input: '0',
      full: '9999px',
    },
    // Replaced: no shadows. The neu-* entries are TEMPORARY compat
    // (hairline rings) until R7 removes them from the markup.
    boxShadow: {
      none: 'none',
      sm: 'none',
      DEFAULT: 'none',
      md: 'none',
      lg: 'none',
      xl: 'none',
      '2xl': 'none',
      inner: 'none',
      neu: '0 0 0 1px rgb(var(--border))',
      'neu-sm': '0 0 0 1px rgb(var(--border))',
      'neu-lift': '0 0 0 1px rgb(var(--border-strong))',
      'neu-inset': 'inset 0 0 0 1px rgb(var(--border-strong))',
      'neu-pressed': 'inset 0 0 0 2px rgb(var(--foreground))',
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

        // TEMPORARY compat aliases so unconverted screens follow the new
        // palette. R7 renames the classes and deletes these. (base is under
        // backgroundColor below: as a color it would turn text-base into a
        // background-colored text.)
        surface: token('card'),
        'text-primary': token('foreground'),
        'text-secondary': token('muted-foreground'),
        highlight: token('border'),
        shadow: token('border'),
        action: {
          call: token('signal-text'),
          hangup: token('signal-text'),
          warn: token('signal-text'),
          contacted: token('foreground'),
          dnc: token('foreground'),
          neutral: token('muted-foreground'),
        },
      },
      backgroundColor: {
        base: token('background'), // TEMPORARY compat (bg-base), R7 deletes it
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
