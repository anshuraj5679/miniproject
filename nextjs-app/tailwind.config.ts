import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        winter: {
          'primary': '#6366F1',
          'primary-content': '#ffffff',
          'secondary': '#818CF8',
          'accent': '#10B981',
          'neutral': '#1E293B',
          'base-100': '#ffffff',
          'base-200': '#F1F5F9',
          'base-300': '#E2E8F0',
          'base-content': '#0F172A',
          'info': '#818CF8',
          'success': '#10B981',
          'warning': '#F59E0B',
          'error': '#F43F5E',
        },
      },
      {
        night: {
          'primary': '#818CF8',
          'primary-content': '#ffffff',
          'secondary': '#6366F1',
          'accent': '#10B981',
          'neutral': '#1E293B',
          'base-100': '#0F172A',
          'base-200': '#1E293B',
          'base-300': '#334155',
          'base-content': '#E2E8F0',
          'info': '#818CF8',
          'success': '#10B981',
          'warning': '#F59E0B',
          'error': '#F43F5E',
        },
      },
    ],
    darkTheme: 'night',
  },
}
export default config
