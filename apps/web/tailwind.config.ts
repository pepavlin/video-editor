import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#080d0b',
          raised: '#0d1511',
          hover: '#131d17',
          border: '#1a2820',
        },
        accent: {
          DEFAULT: '#00d4a0',
          hover: '#00b889',
          amber: '#f0b100',
          coral: '#ff4560',
          sky: '#38bdf8',
        },
      },
      boxShadow: {
        'glow-teal': '0 0 20px rgba(0, 212, 160, 0.4)',
        'glow-sm': '0 0 10px rgba(0, 212, 160, 0.25)',
        'panel': '0 8px 32px rgba(0, 0, 0, 0.6), inset 0 0 0 0.5px rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
