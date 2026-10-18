import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // The log of workerd shows each failed start as an uncaught exception.
      // To see the log of workerd, set WORKERD_VERBOSE=1.
      verbose: process.env.WORKERD_VERBOSE === "1",
      wrangler: { configPath: "./test/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.test.js"],
  },
});
