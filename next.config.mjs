/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next writes AGENTS.md and CLAUDE.md at the repo root on dev startup. They are
  // generated output, not source, and would land in the diff of every branch.
  agentRules: false,
  // The API base URL is read at build time on the server and at runtime in the
  // browser, so it is exposed explicitly rather than relied on implicitly.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
