/** @type {import('next').NextConfig} */

// Generate a unique build ID at build time — changes automatically on every
// `next build` so clients can detect when a new deploy is available.
const buildId = Date.now().toString();

const nextConfig = {
  reactStrictMode: false, // disabled to avoid double-mount issues with WebAudio
  generateBuildId: async () => buildId,
  env: {
    // Exposed to server-side code only (not inlined into client bundles).
    // The /app-version route handler reads this and returns it to the client
    // for polling-based new-deploy detection.
    NEXT_BUILD_ID: buildId,
  },
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
