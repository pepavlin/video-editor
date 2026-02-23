import type { Metadata, Viewport } from 'next';
import './globals.css';
import FeedbackButton from '@/components/FeedbackButton';
import VersionBanner from '@/components/VersionBanner';
import ChangelogModal from '@/components/ChangelogModal';
import { ThemeProvider } from '@/contexts/ThemeContext';

export const metadata: Metadata = {
  title: 'Video Editor',
  description: 'Local fast video editor for music shorts',
  icons: {
    icon: '/icon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Inline script prevents flash of wrong theme on page load */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  try {
    var stored = localStorage.getItem('video-editor-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch(e) {}
})();
            `,
          }}
        />
      </head>
      <body style={{ height: '100dvh', overflow: 'hidden' }}>
        <ThemeProvider>
          {children}
          <VersionBanner />
          <FeedbackButton />
          <ChangelogModal />
        </ThemeProvider>
      </body>
    </html>
  );
}
