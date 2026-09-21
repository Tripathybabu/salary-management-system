/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base URL is read at build time on the server and at runtime in the
  // browser, so it is exposed explicitly rather than relied on implicitly.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
