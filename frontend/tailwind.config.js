/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: 'rgb(var(--color-base) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'text-primary': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
        highlight: 'rgb(var(--color-highlight) / <alpha-value>)',
        shadow: 'rgb(var(--color-shadow) / <alpha-value>)',
        action: {
          call: '#3B82F6',
          hangup: '#EF4444',
          contacted: '#10B981',
          neutral: '#6B7280',
          warn: '#F59E0B',
          dnc: '#DC2626',
        },
      },
      borderRadius: {
        card: '14px',
        input: '10px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        neu: '-6px -6px 12px rgb(var(--color-highlight)), 6px 6px 12px rgb(var(--color-shadow))',
        'neu-sm': '-3px -3px 6px rgb(var(--color-highlight)), 3px 3px 6px rgb(var(--color-shadow))',
        'neu-inset': 'inset -4px -4px 8px rgb(var(--color-highlight)), inset 4px 4px 8px rgb(var(--color-shadow))',
        'neu-pressed': 'inset -2px -2px 5px rgb(var(--color-highlight)), inset 2px 2px 5px rgb(var(--color-shadow))',
        'neu-lift': '-8px -8px 18px rgb(var(--color-highlight)), 8px 8px 18px rgb(var(--color-shadow))',
      },
    },
  },
  plugins: [],
};
