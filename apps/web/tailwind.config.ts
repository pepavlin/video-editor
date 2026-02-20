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
          DEFAULT: '#1a1a1a',
          raised: '#242424',
          hover: '#2d2d2d',
          border: '#333333',
        },
        accent: {
          DEFAULT: '#6c63ff',
          hover: '#5a52d5',
        },
      },
    },
  },
  plugins: [],
};

export default config;
