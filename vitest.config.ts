import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'dist-test'],
    testTimeout: 15000,
    // Forks pool — more stable than threads for native deps (better-sqlite3).
    // File parallelism off — keeps memory + native module pressure predictable.
    pool: 'forks',
    fileParallelism: false,
  },
});
