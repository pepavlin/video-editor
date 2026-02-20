'use client';

import dynamic from 'next/dynamic';

// Load Editor dynamically (client-only: uses WebAudio, canvas, etc.)
const Editor = dynamic(() => import('@/components/Editor'), { ssr: false });

export default function HomePage() {
  return <Editor />;
}
