import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The live suite talks to the real API; run it with `npm run test:live`.
    exclude: process.env.MEIL_LIVE ? [] : ['test/live.test.ts'],
  },
});
