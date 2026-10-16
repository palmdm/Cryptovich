import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The same `@/` alias tsconfig.json and Next use.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  esbuild: { jsx: "automatic" },
  test: {
    // Non-React units — the middleware's CSP in particular, whose failure
    // mode is a page that returns 200 and does nothing — and components
    // rendered to static markup where the markup itself is the contract.
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
