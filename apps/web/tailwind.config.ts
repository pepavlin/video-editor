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
          DEFAULT: '#0e1a2e',
          raised: '#162438',
          hover: '#1e3050',
          border: '#243a58',
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
        'glow-teal': '0 0 20px rgba(0,212,160,0.45)',
        'glow-sm':   '0 0 10px rgba(0,212,160,0.28)',
        'panel':     '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
