/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // No rewrites needed — /api/* (except /api/config) is handled at runtime
  // by the catch-all App Router route at src/app/api/[...path]/route.ts,
  // which reads process.env.BACKEND_URL per-request instead of baking the
  // URL into routes-manifest.json at Docker build time.
};

export default nextConfig;
