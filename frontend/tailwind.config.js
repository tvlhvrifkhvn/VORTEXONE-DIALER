/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        base: '#E4E9F0',
        surface: '#E4E9F0',
        'text-primary': '#3E4C63',
        'text-secondary': '#6A7A94',
        highlight: '#FFFFFF',
        shadow: '#A3B1C6',
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
        neu: '-6px -6px 12px #FFFFFF, 6px 6px 12px #A3B1C6',
        'neu-sm': '-3px -3px 6px #FFFFFF, 3px 3px 6px #A3B1C6',
        'neu-inset': 'inset -4px -4px 8px #FFFFFF, inset 4px 4px 8px #A3B1C6',
        'neu-pressed': 'inset -2px -2px 5px #FFFFFF, inset 2px 2px 5px #A3B1C6',
      },
    },
  },
  plugins: [],
};
