/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The agent core is plain TypeScript with no Next-specific imports so that the CLI
  // eval harness can import the identical runPipeline() the UI calls. Keep it that way.

  // Fixtures, the registry and the case set are read at runtime via paths computed from
  // process.cwd() (src/llm/cache.ts, app/deps.ts). Next traces static imports, not runtime
  // path construction, so on a serverless deploy these are silently omitted: the build goes
  // green and the first triage 500s. Trace them in explicitly.
  outputFileTracingIncludes: {
    "/**": ["./fixtures/**", "./eval/registry.json", "./eval/cases/cases.jsonl"],
  },
};

export default nextConfig;
