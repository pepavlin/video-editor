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
          DEFAULT: '#08081a',
          raised: '#0d0d22',
          hover: '#13132a',
          border: '#1e1e3a',
        },
        accent: {
          DEFAULT: '#7c3aed',
          hover: '#6d28d9',
          blue: '#3b82f6',
          cyan: '#06b6d4',
          pink: '#ec4899',
        },
      },
      backgroundImage: {
        'accent-gradient': 'linear-gradient(135deg, #7c3aed, #3b82f6)',
        'accent-gradient-hover': 'linear-gradient(135deg, #6d28d9, #2563eb)',
        'accent-gradient-warm': 'linear-gradient(135deg, #7c3aed, #ec4899)',
      },
      boxShadow: {
        'glow-accent': '0 0 20px rgba(124, 58, 237, 0.4)',
        'glow-blue': '0 0 20px rgba(59, 130, 246, 0.4)',
        'glow-sm': '0 0 10px rgba(124, 58, 237, 0.25)',
        'panel': '0 8px 32px rgba(0, 0, 0, 0.6), inset 0 0 0 0.5px rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
};

export default config;
