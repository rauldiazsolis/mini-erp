import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PostgreSQL: arma la base plantilla que clonan los tests (test/helpers/test-db.ts)
    globalSetup: ['test/helpers/pg-global-setup.ts'],
  },
});
