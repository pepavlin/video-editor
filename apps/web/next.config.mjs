/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // disabled to avoid double-mount issues with WebAudio
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/:path*`,
      },
      {
        source: '/files/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/files/:path*`,
      },
    ];
  },
};

export default nextConfig;
