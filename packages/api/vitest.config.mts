import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          d1Databases: ["DB"],
          bindings: {
            ADMIN_PASSWORD: "test-password",
            CORS_ORIGIN: "*",
          },
        },
      },
    },
  },
});
