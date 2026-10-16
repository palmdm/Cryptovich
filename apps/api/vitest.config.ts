import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    /**
     * One database, one file at a time.
     *
     * Every suite runs against the same Postgres (see test/setup.ts), and
     * some of them assert on global state — "there is no active
     * administrator", "this author has one subscriber". Run in parallel,
     * a suite that creates an admin or a subscription makes another
     * suite's precondition false, and the failure lands in whichever file
     * happened to look at the wrong moment. Serially the whole suite still
     * runs in under a minute, which is a fair price for a test that fails
     * only when something is actually broken.
     */
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
