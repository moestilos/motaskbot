/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,ts,jsx,tsx,md,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0a0a0b',
          raised: '#111113',
          elevated: '#17171a',
        },
        border: {
          DEFAULT: '#26262b',
          subtle: '#1c1c20',
        },
        fg: {
          DEFAULT: '#e6e6e8',
          muted: '#8a8a94',
          dim: '#5a5a62',
        },
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#6b4aef',
        },
        status: {
          pending: '#6a6a72',
          running: '#e3b341',
          completed: '#3fb950',
          failed: '#f85149',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
