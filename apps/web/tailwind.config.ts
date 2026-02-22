import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#f0f4f8',
          raised: '#ffffff',
          hover: '#e8eef6',
          border: '#e2e8f0',
        },
        accent: {
          DEFAULT: '#0d9488',
          hover: '#0f766e',
          amber: '#d97706',
          coral: '#ef4444',
          sky: '#0ea5e9',
        },
      },
      boxShadow: {
        'glow-teal': '0 0 16px rgba(13,148,136,0.30)',
        'glow-sm':   '0 0 8px rgba(13,148,136,0.18)',
        'panel':     '0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
