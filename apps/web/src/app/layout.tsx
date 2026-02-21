import type { Metadata, Viewport } from 'next';
import './globals.css';
import FeedbackButton from '@/components/FeedbackButton';
import VersionBanner from '@/components/VersionBanner';

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
      <body style={{ height: '100vh', overflow: 'hidden' }}>
        {children}
        <VersionBanner />
        <FeedbackButton />
      </body>
    </html>
  );
}
