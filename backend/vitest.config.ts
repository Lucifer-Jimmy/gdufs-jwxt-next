import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

type TestGlobal = typeof globalThis & {
  process: { env: Record<string, string | undefined> };
};

const testGlobal = globalThis as TestGlobal;

testGlobal.process.env.SESSION_AEAD_KEY =
  "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM";
testGlobal.process.env.SESSION_AEAD_KEY_VERSION = "test-1";
testGlobal.process.env.RATE_LIMIT_HMAC_KEY_V1 =
  "BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
