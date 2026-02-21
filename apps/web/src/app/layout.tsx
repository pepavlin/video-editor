import type { Metadata } from 'next';
import './globals.css';
import FeedbackButton from '@/components/FeedbackButton';
import VersionBanner from '@/components/VersionBanner';

export const metadata: Metadata = {
  title: 'Video Editor',
  description: 'Local fast video editor for music shorts',
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
