import { defineConfig } from "vitest/config";

// Engine tests are pure TypeScript and run in plain Node, so the Cloudflare plugin is not loaded here.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
