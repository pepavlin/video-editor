import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Video Editor',
  description: 'Local fast video editor for music shorts',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ height: '100vh', overflow: 'hidden' }}>{children}</body>
    </html>
  );
}
