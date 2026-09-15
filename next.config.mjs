/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The agent core is plain TypeScript with no Next-specific imports so that the CLI
  // eval harness can import the identical runPipeline() the UI calls. Keep it that way.
};

export default nextConfig;
