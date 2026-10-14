import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // maintainOrg trains a small model; it runs about 5s on a laptop, right at the default timeout.
    testTimeout: 30_000,
  },
});
