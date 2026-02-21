// This endpoint is polled by the client to detect when a new deploy is live.
// It returns the build ID that was baked in at `next build` time.
// Note: must NOT be under /api/* — that prefix is rewritten to the backend API.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ buildId: process.env.NEXT_BUILD_ID ?? 'dev' });
}
