import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    /**
     * One file at a time, for the same reason as the API suite: every file
     * shares one database, and a job runner picks up *every* due row, not
     * just its own suite's. Run in parallel, the import-job suite would
     * process a row the federation suite was about to assert on, and the
     * failure landed in whichever file lost the race.
     */
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
