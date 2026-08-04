import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // dist/ holds compiled CommonJS output. Without this exclude, a prior
    // `npm run build` leaves .js copies that vitest tries to run and fails on.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
