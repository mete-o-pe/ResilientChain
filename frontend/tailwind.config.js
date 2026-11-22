/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        surface: 'var(--color-surface)',
      },
      fontFamily: {
        sans: ['Satoshi', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
  // Mantém classes customizadas (.btn, .input, .card, .badge) no build
  safelist: [
    'btn', 'btn-primary', 'btn-ghost', 'btn-danger',
    'input', 'input-label',
    'card',
    'badge', 'badge-teal', 'badge-green', 'badge-red', 'badge-yellow',
  ],
}
