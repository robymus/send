import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Tests share one Postgres database; run files sequentially.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
